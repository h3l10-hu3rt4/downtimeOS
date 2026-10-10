# Despliegue planeado en Azure Container Apps

Este documento prepara el despliegue del MVP empaquetado con Docker. **No
significa que ya esté publicado.** Al 10-oct-2026, la cuenta Azure del owner
está pendiente de revisión/aprobación; hasta que haya una suscripción activa no
se crean recursos ni se comparte una URL. No desplegar en Vercel.

## Arquitectura objetivo

- Aplicación Next.js: Azure Container Apps, construida con el `Dockerfile` del
  repo y expuesta por HTTPS/ingress de Azure.
- Datos, Auth y Storage: proyecto Supabase remoto exclusivo para el ambiente
  (staging o producción). Nunca Supabase Local, el proyecto personal activo ni
  las claves guardadas en `.env.local`.
- Correo: SMTP configurado en Supabase Auth con un proveedor y remitente
  verificados. Mailpit de localhost no es accesible desde Azure.
- Secretos: Azure Container Apps Secrets/Key Vault; nunca Dockerfile, GitHub,
  argumentos visibles de terminal ni archivos versionados.

Para las primeras pruebas del equipo, crear un entorno **staging** aislado con
datos ficticios, un proyecto Supabase independiente y un remitente de pruebas.
No usar datos ni usuarios reales. Elegimos Container Apps porque recibe la imagen
Docker existente; el `docker-compose.yml` local con Supabase y Mailpit es para
desarrollo, no se despliega como una aplicación compuesta en Azure.

## Antes de empezar

1. Microsoft aprueba la cuenta y hay una suscripción activa. Confirma la
   suscripción y límites/cuotas visibles en Azure Portal antes de crear recursos.
2. Instala Azure CLI, Docker y Git; inicia sesión con `az login`.
3. Prepara un proyecto Supabase **nuevo y desechable para staging**. Confirma su
   project ref antes de aplicar migraciones; revisa
   [`supabase/ORDEN-DE-EJECUCION.md`](supabase/ORDEN-DE-EJECUCION.md) y la cadena
   vigente `supabase/migrations`. No hagas `db push` a ciegas a una base con datos.
4. Configura Supabase Auth con el dominio HTTPS final de Azure en Site URL y en
   Redirect URLs (`/activar`, `/recuperar` y las rutas de callback necesarias).
5. Elige proveedor SMTP, verifica dominio/remitente y prueba confirmación,
   invitación, recuperación y los avisos antes de invitar testers.

## Crear los recursos (Azure CLI / PowerShell)

Selecciona nombres globalmente únicos para el ACR. Los nombres de grupo,
Container App e identidad pueden ser distintos; guarda los mismos valores para
el procedimiento de actualización.

```powershell
az login
az account list --output table
az account set --subscription "ID_O_NOMBRE_DE_LA_SUSCRIPCION"
az account show --output table

$rg = "rg-downtimeos-staging"
$region = "canadacentral"
$acr = "ACR_GLOBALMENTE_UNICO"
$environment = "cae-downtimeos-staging"
$app = "downtimeos-staging"
$identity = "id-downtimeos-staging-pull"

az group create --name $rg --location $region
az acr create --resource-group $rg --name $acr --sku Basic --admin-enabled false
az acr config authentication-as-arm update --registry $acr --status enabled
az identity create --resource-group $rg --name $identity --location $region

$acrId = az acr show --resource-group $rg --name $acr --query id --output tsv
$identityId = az identity show --resource-group $rg --name $identity --query id --output tsv
$principalId = az identity show --resource-group $rg --name $identity --query principalId --output tsv
az role assignment create --assignee-object-id $principalId --assignee-principal-type ServicePrincipal --role AcrPull --scope $acrId

az containerapp env create --name $environment --resource-group $rg --location $region
```

La identidad administrada y `AcrPull` evitan guardar credenciales de ACR dentro
del Container App. Microsoft documenta este flujo en [autenticación de Azure
Container Registry con managed identity](https://learn.microsoft.com/azure/container-apps/managed-identity-image-pull).

## Construir y publicar la imagen

Desde la raíz del repositorio y con `Angel_Dev` integrado en `main`, construye
la imagen en ACR con una etiqueta identificable (no uses `latest` para releases):

```powershell
$tag = (git rev-parse --short HEAD)
az acr build --registry $acr --image "downtimeos:$tag" .
```

## Crear la Container App

```powershell
$image = "$acr.azurecr.io/downtimeos:$tag"
az containerapp create `
  --name $app `
  --resource-group $rg `
  --environment $environment `
  --image $image `
  --user-assigned $identityId `
  --registry-identity $identityId `
  --registry-server "$acr.azurecr.io" `
  --target-port 3000 `
  --ingress external `
  --cpu 0.5 `
  --memory 1Gi `
  --min-replicas 1 `
  --max-replicas 2
```

Agrega las variables **no secretas** y referencias a Container App Secrets desde
Azure Portal (Container App → Secrets; luego Revisions and replicas → Create new
revision → Environment variables). No pegues sus valores en una sesión grabada,
issue, chat ni commit. Azure permite referenciar cada secreto como
`secretref:nombre-del-secreto`; consulta [secrets y variables de entorno de
Container Apps](https://learn.microsoft.com/azure/container-apps/manage-secrets)
y [variables de entorno](https://learn.microsoft.com/azure/container-apps/environment-variables).

### Configuración de la aplicación

Como mínimo, determina los valores correctos para el ambiente y guarda los
secretos en Azure:

| Variable | Tipo | Uso |
| :--- | :--- | :--- |
| `APP_ENV=production` | normal | Reglas de URL y entorno |
| `APP_URL` | normal | Origen público HTTPS final; callbacks y enlaces |
| `PUBLIC_APP_URL` | normal | Enlaces de integraciones |
| `NEXT_PUBLIC_SITE_URL` | normal | Origen de la aplicación |
| `SUPABASE_URL` | normal | URL del Supabase dedicado |
| `NEXT_PUBLIC_SUPABASE_URL` | normal | URL pública usada por Auth en navegador |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | normal | Clave publicable; jamás usar una secret/service-role |
| `SUPABASE_SECRET_KEY` | **secreto** | Acceso de servidor; se omite RLS, nunca se expone al navegador |
| `DASHBOARD_ADMIN_EMAIL` | normal/privado | Cuenta del panel interno de esta instalación |
| `DASHBOARD_ADMIN_PASSWORD` | **secreto** | Contraseña exclusiva del panel interno |
| `CRON_SECRET` | **secreto** | Protege la ruta de avisos programados |
| `RESEND_API_KEY` | **secreto, opcional** | Solo si se habilitan avisos mediante Resend |
| `RESEND_FROM_EMAIL` | normal, opcional | Remitente verificado para avisos mediante Resend |

Empieza con `REGLA_B2B_ACTIVA=true`, `WHATSAPP_ALERTAS_ACTIVAS=false`,
`WHATSAPP_APROBACIONES_ACTIVAS=false` y sin claves de IA/WhatsApp. Activa una
integración solo tras pruebas explícitas y confirmación de sus costos y envíos.
El SMTP de confirmación/invitaciones/recuperación se configura en **Supabase
Auth**, no con las variables `RESEND_*` de la app.

Para que `NEXT_PUBLIC_*` esté disponible en cliente cuando se compile dentro del
Dockerfile, confirma primero el flujo con una imagen de staging. La ruta
`/api/config` sirve la configuración pública en runtime como respaldo, pero el
smoke debe verificar tanto las pantallas de Auth como `GET /api/config`.

## Validar antes de compartir

1. Configura la URL pública y redirects de Auth; confirma que el correo recibido
   enlaza a esa URL, nunca a localhost ni al dominio de Vercel.
2. Aplica las migraciones exclusivamente al Supabase de staging revisado y
   confirma su historial antes de registrar datos.
3. Revisa el estado y logs de la revisión en Azure Portal. Obtén la URL:

   ```powershell
   az containerapp show --name $app --resource-group $rg --query properties.configuration.ingress.fqdn --output tsv
   ```

4. Comprueba `https://<fqdn>/api/health`, rutas públicas, registro/correo,
   recuperación, invitaciones, piloto, aislamiento entre dos organizaciones,
   permisos y operación. Asegúrate de que APIs operativas respondan 401 sin
   sesión. La salud HTTP sola no certifica el MVP.
5. Solo entonces comparte la URL, la guía de testers y las cuentas de prueba.
   No compartas secretos ni acceso al panel administrativo interno.

## Actualizaciones y costos

Cada actualización debe construir una nueva imagen con etiqueta de commit y
crear una revisión nueva del Container App. Conserva la revisión anterior hasta
validar la nueva y usa el mecanismo de rollback de Azure si falla. Revisa el
costo estimado de Container Apps, ACR, Log Analytics, transferencia y cualquier
servicio de correo antes de dejar recursos activos; los precios y cuotas
dependen de la región, consumo y oferta de la suscripción.

No borres el grupo de recursos completo para “limpiar” sin revisar antes su
contenido: esa operación elimina todos los recursos que cuelgan de él.
