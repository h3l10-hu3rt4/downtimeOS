# Staging del MVP para testers

Staging es el entorno remoto de pruebas del **producto DowntimeOS**, no la demo
DowntimeCO ni el Supabase local de una computadora. Se prepara en Azure
Container Apps cuando Microsoft autorice la suscripción. Al 10-oct-2026, esa
autorización sigue pendiente: no hay URL Azure disponible y todavía no se debe
invitar al equipo a probar desde Internet.

## Arquitectura objetivo

| Componente | Ubicación | Regla de aislamiento |
| :--- | :--- | :--- |
| App Next.js | Azure Container Apps, imagen del `Dockerfile` | HTTPS público solo después de la revisión |
| Auth, datos y Storage | Proyecto Supabase remoto dedicado a staging | Nunca reutilizar producción ni Supabase Local |
| Correo Auth | SMTP configurado en Supabase Auth | Remitente verificado y entrega probada antes de invitar testers |
| Secretos de app | Container Apps Secrets o Key Vault | No versionar, imprimir ni ponerlos en la imagen |

El correo local sigue en Mailpit (`http://localhost:54324`) y no llega a Azure.
El sistema no enviará invitaciones reales hasta que se configure y valide SMTP
para el Supabase de staging. WhatsApp e IA deben empezar desactivados para evitar
mensajes reales y consumo de créditos.

## Preparación pendiente

1. Aprobación de Azure y una suscripción activa con cuotas revisadas.
2. Recurso Azure Container Apps, registro ACR e identidad administrada para
   obtener la imagen sin credenciales de registry incrustadas.
3. Proyecto Supabase **exclusivo de staging**, con la cadena versionada en
   `supabase/migrations` aplicada después de revisar el proyecto y su historial.
4. Site URL y Redirect URLs de Supabase Auth con el dominio HTTPS final.
5. SMTP para confirmación, invitaciones y recuperación; pruebas reales de los
   cuatro flujos antes de abrirlo al equipo.
6. Secretos y variables configurados en Azure, revisión de logs, health check y
   pruebas de permisos/aislamiento.

Consulta el procedimiento paso a paso en [`DEPLOY-AZURE.md`](../DEPLOY-AZURE.md).
No se requiere ni se hará un despliegue a Vercel para este proceso.

## Criterio para compartir con testers

No compartir el dominio hasta que todas estas condiciones se cumplan:

- La app está disponible por HTTPS y `/api/health` responde correctamente.
- Registro, confirmación, login, recuperación e invitaciones llegan al correo de
  prueba y sus enlaces regresan al dominio Azure correcto.
- Se recorrieron piloto de 14 días, configuración de planta, suscripción,
  permisos por rol y operación de paros con datos ficticios.
- Dos organizaciones no pueden leer ni modificar datos una de otra; las APIs
  operativas rechazan solicitudes anónimas.
- La administración interna usa credenciales separadas que no se entregan a
  testers; WhatsApp/IA siguen apagados si no se acordó expresamente probarlos.
- Existe una guía de tester que corresponde exactamente a la URL y versión
  desplegadas.

## Durante la espera

El equipo puede probar en local con la guía
[`GUIA-PRUEBAS-USUARIO.md`](GUIA-PRUEBAS-USUARIO.md), Docker, Supabase Local y
Mailpit. Cada persona tendrá su propia base y sus propios datos; no se deben
abrir puertos de Supabase de una PC ni compartir `.env.local`. No apuntar la app
local a la base remota ni ejecutar migraciones en un proyecto remoto hasta
confirmar explícitamente que es el Supabase de staging.
