# Despliegue de DowntimeOS en DigitalOcean

Este documento registra el despliegue de DowntimeOS en el Droplet existente.
**Avance estimado: 80%.** `app.downtimeos.tech` ya resuelve y tiene certificado
TLS emitido. La imagen inmutable `25df02a` está desplegada y `/api/health`
responde 200 desde el host; se mantiene accesible solo por `127.0.0.1:3000`.
HTTPS público sigue cerrado hasta rotar la llave expuesta de Resend y validar
Auth/correos. El
proyecto Supabase de producción está confirmado y su esquema ya fue
sincronizado; no se despliega en Vercel ni en Azure.

## Arquitectura y límites

- Droplet Ubuntu, Docker Engine y Compose. La aplicación corre como usuario no
  root, sin capacidades Linux, con filesystem de solo lectura y reinicio
  automático.
- Compose usa una imagen inmutable GHCR identificada por SHA y publica el puerto
  de la app solo en `127.0.0.1:3000`. Nginx termina TLS para
  `app.downtimeos.tech`; no publiques directamente el puerto de la app.
- Supabase remoto dedicado a producción para Auth, PostgreSQL y Storage. No uses
  Supabase Local ni copies el `.env.local` de desarrollo.
- Secretos de runtime en `/etc/downtimeos/production.env`, propiedad de root y
  modo `0600`; no están en GitHub, imagen, historial de shell ni repositorio.
- GitHub Actions prueba, construye y publica en GHCR al integrar a `main`.
  Producción solo se actualiza con `workflow_dispatch`, revisión manual y los
  secretos SSH del environment `production`.

## Estado del Droplet (11 oct 2026)

El propietario aprobó y aplicó el plan de **1 vCPU, 2 GB RAM y 50 GB SSD
(USD 12/mes)**. Se verificaron 1.9 GiB de memoria visible, Docker 29.9.0,
Compose v5.6.0 y firewall UFW activo. SSH acepta llaves, deshabilita el acceso
directo de `root` y la autenticación por contraseña. UFW tiene entrada denegada
por defecto y solo permite 22/80/443, desde cualquier IP en IPv4 e IPv6; SSH
aún no está restringido por origen y el firewall de DigitalOcean no se pudo
confirmar desde el host. Nginx y Certbot están instalados; Nginx está activo,
pasa `nginx -t`, y el timer de renovación está activo. Se emitió el certificado
para `app.downtimeos.tech` con HTTP-01; el listener 443 y el proxy de la app
siguen deshabilitados hasta rotar la llave de correo y validar Auth/correos.
`unattended-upgrades` está enabled y
active. Se aplicó `sosreport` sin reiniciar servicios; dos paquetes Ubuntu
continúan diferidos por phased updates y el kernel está vigente. El host tiene
`main` en el momento de la inspección previa era `25df02a`; tras publicar la
actualización documental, `main` avanza a `49ff172`. El comando de despliegue
root-owned está actualizado.
La nueva plantilla de Nginx para HTTPS se validó con Nginx 1.24. En `d65fda4`
se eliminó el `chown -R` del filesystem
de runtime: los archivos son root-owned y de solo lectura para `nextjs`, con
`/tmp` y la caché como los únicos mounts escribibles. La imagen candidata local
bajó de 1.44 GB a 883 MB (559 MB menos); PDFKit se importa y la página/config
pública responden 200 con los límites y restricciones de Compose. En el
despliegue privado, `/api/health` respondió 200 con Supabase. La plantilla
HTTPS está instalada en el Droplet como
`/etc/nginx/sites-available/downtimeos-app.conf` (`root:root`, `0644`), pero
permanece deshabilitada; se comparó el hash con el archivo versionado y
`nginx -t` pasó. El certificado está en `/etc/letsencrypt/live/app.downtimeos.tech/`.
`/etc/downtimeos/production.env` existe con permisos `root:root 0600` y
`/etc/downtimeos/image.env` apunta al digest inmutable desplegado desde CI/CD.

La aplicación está desplegada en el host, pero todavía **no está publicada en
Internet**: responde `/api/health` con 200 desde el servidor y el puerto
`127.0.0.1:3000` no es accesible externamente; 443 sigue cerrado y el vhost
HTTPS de Nginx permanece deshabilitado. El paquete GHCR es privado. El workflow de CD
solicita `packages: read` a `GITHUB_TOKEN` y
entrega ese token por stdin sobre SSH; el script lo guarda solo en un directorio
temporal bajo `/run` y lo elimina al finalizar. `downtimeos.tech` y `www` siguen
apuntando al alojamiento histórico Vercel; no se cambiarán. El subdominio
`app.downtimeos.tech` resuelve al Droplet (`165.227.53.165`). El certificado
TLS ya está emitido. El environment `production` tiene una llave SSH dedicada,
host/user y `known_hosts` fijado a la huella previamente confiable; la llave
no permite forwarding ni PTY. La composición reserva 768
MiB al contenedor y limita el heap de Node a 512 MiB. Nginx/Certbot no añaden un
servicio mensual.

**Bloqueo de salida:** la API key de Resend que estaba en el archivo runtime
apareció codificada en el registro de herramientas durante una comprobación.
Debe revocarse y reemplazarse; no se habilitará el acceso público ni se harán
envíos de producción con ella. También falta actualizar el SMTP de Supabase si
usa esa misma key. La configuración SMTP aparece activa, pero no se confirmó
una entrega real. El sitio de Nginx permanece deshabilitado.

La base de producción recibió el esquema de las migraciones y el backfill
autorizado de propietario/membresía; el historial remoto registra las 55
migraciones locales. Los respaldos disponibles cubren únicamente el esquema y
los datos de `public`; no se ha probado una restauración. El catálogo `planes`
está vacío por decisión de no cambiar importes, y no se crearon pagos ni
suscripciones.

## Etapas 0–100

1. **Inventario y seguridad del host (0–15%)** — confirmar Droplet, Ubuntu,
   acceso `downtimeos` por llave, `PermitRootLogin no`, reglas de firewall y
   recuperación. No bloquear SSH ni cambiar reglas sin una sesión de respaldo.
2. **Capacidad y Docker (15–30%)** — acordar tamaño/costo, instalar Docker y
   Compose desde repositorio oficial, habilitar actualizaciones de seguridad y
   configurar firewall. Hecho salvo confirmar el firewall externo de
   DigitalOcean y restringir SSH por origen. Los puertos de la aplicación no se
   exponen a Internet; Docker puede alterar el comportamiento de UFW, así que
   se validan también las reglas de iptables/nftables.
3. **Entorno de datos y secretos (30–45%)** — Supabase de producción confirmado,
   historial de esquema sincronizado (55 migraciones) y backfill autorizado.
   `production.env` está creado como archivo root-only. El respaldo cubre
   esquema y datos de `public`, pero falta probar restauración y rotar la llave
   de Resend expuesta. No activar IA/WhatsApp.
4. **Imagen y CI (45–60%)** — workflows de CI e imagen verificados; GHCR publica
   imagen por SHA. El CD ya usa un token efímero de lectura durante el pull.
   Se verificó el build de `main` y la imagen inmutable; los cuatro secretos
   SSH están en el environment `production`.
5. **Runtime y proxy (60–75%)** — Compose, healthcheck, límites y logs están
   preparados; Nginx y Certbot están instalados. DNS y certificado ya están
   listos; el contenedor quedó healthy con `/api/health` 200 desde el host y
   el puerto solo escucha en loopback. Falta activar el proxy tras rotar la
   llave y verificar Auth/correo. HTTP por IP no se considera acceso final
   seguro para cuentas y cookies.
6. **CD restringido y rollback (75–85%)** — crear comando root-owned que acepte
   un commit SHA completo y un digest `sha256:<64 hex>`, haga pull de la imagen validada,
   actualice Compose, espere healthcheck y revierta a la versión previa si
   falla. Comando root-owned, regla sudo restringida, llave exclusiva de
   Actions, `known_hosts` fijado y environment manual están configurados.
   Nunca se usa la contraseña personal de sudo.
7. **Validación y entrega (85–100%)** — smoke HTTPS, registro/confirmación,
   recuperación, invitaciones, roles, piloto, suscripción, aislamiento de
   empresas, operación y backup/restore. Solo después compartir URL y guía clara
   para testers; registrar procedimiento de despliegue, rollback y soporte.
   La prueba local de healthcheck pasó; los flujos autenticados y de correo aún
   no se han probado en producción.

## Preparación de GitHub

El repositorio `h3l10-hu3rt4/downtimeOS` es público, pero la imagen GHCR es
privada. El workflow solicita `packages: read` para su `GITHUB_TOKEN`, lo envía
por stdin a través de SSH y el comando root-owned lo usa con `--password-stdin`
desde un `DOCKER_CONFIG` temporal en `/run`; el directorio se elimina tanto al
terminar como al fallar o hacer rollback. No se guarda un PAT permanente en el
Droplet, Actions ni `.env.local`. La imagen no debe contener secretos ni datos
de clientes. No hagas público el paquete: cambiarlo a público no se puede
revertir a privado ([documentación de visibilidad](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility)).

El environment `production` ya está creado con revisión requerida y los secretos
protegidos siguientes:

- `DO_DEPLOY_HOST`: IP o host SSH del Droplet.
- `DO_DEPLOY_USER`: cuenta dedicada sin login root.
- `DO_DEPLOY_SSH_KEY`: llave exclusiva de Actions, no la llave personal. La
  llave no permite forwarding ni PTY.
- `DO_DEPLOY_KNOWN_HOSTS`: clave de host verificada por un canal independiente;
  no uses `ssh-keyscan` como única comprobación de identidad.

El workflow se ejecuta desde el commit actual de `main` y exige el commit SHA
completo junto con el digest `sha256:<64 hex>` publicado en GHCR; no acepta
`latest`. El paso final entrega el token temporal GHCR por stdin y llama a
`sudo -n /usr/local/sbin/downtimeos-deploy <commit> <digest> <usuario-ghcr>`.
El comando fuente
`deploy/digitalocean/downtimeos-deploy` valida que el label OCI de la imagen
coincida con el commit aprobado, evita ejecuciones simultáneas, espera el
healthcheck y restaura la imagen anterior ante error. Debe instalarse como
`root:root` no modificable por `downtimeos` y auditarse en el Droplet antes de
habilitar el environment. No guardes claves de
Supabase, contraseñas del panel, SMTP, IA o Meta en Actions: pertenecen al
archivo privado del host. No habilites un despliegue automático por cada push.

## Variables de entorno

`docker-compose.production.yml` lee exclusivamente
`/etc/downtimeos/production.env`; `DOWNTIMEOS_IMAGE` debe apuntar al digest
inmutable `ghcr.io/<paquete>@sha256:<digest>`. Compose limita recursos desde
`DOWNTIMEOS_MEMORY_LIMIT` y `DOWNTIMEOS_CPU_LIMIT` y rota logs; calibra esos
límites al tamaño aprobado. Crea el archivo en el servidor con propietario `root:root`
y permisos `0600`. Define únicamente el conjunto que el código realmente
requiere; el preflight privado debe verificar las variables requeridas por
`lib/entorno.js` y `lib/supabase.js`. Como mínimo, valida para producción:

- `APP_ENV=production`, `APP_URL`, `PUBLIC_APP_URL` y `NEXT_PUBLIC_SITE_URL`
  con el origen HTTPS definitivo.
- `SUPABASE_URL` y `SUPABASE_SECRET_KEY` del proyecto dedicado para el servidor;
  la clave secreta nunca se expone al browser. `NEXT_PUBLIC_SUPABASE_URL` y la
  clave publicable (`NEXT_PUBLIC_SUPABASE_ANON_KEY` o
  `SUPABASE_PUBLISHABLE_KEY`) son valores públicos.
- Credenciales exclusivas del panel administrativo, si se habilita.
- Configurar un dominio de envío verificado en Resend y usar sus registros DNS
  exactos (SPF/DKIM; no inventarlos). Para separar reputación, el remitente
  recomendado es `no-reply@auth.downtimeos.tech`. En Supabase Auth, SMTP usa
  `smtp.resend.com`, puerto `465` (SSL), usuario `resend` y la API key de Resend
  como contraseña. Site URL y Redirect URLs deben usar
  `https://app.downtimeos.tech`. Las variables `RESEND_*` de la app no configuran
  automáticamente SMTP de Auth.
- `CRON_SECRET` solo si se habilitan tareas programadas.
- Integraciones de IA/WhatsApp apagadas hasta validar costos, límites,
  consentimiento y secretos de producción.

**No copiar el `.env.local` completo.** Las claves de Supabase, Resend y
proveedores que se hayan mostrado o compartido durante desarrollo deben rotarse
antes de uso productivo.

## Dependencias externas pendientes

1. El DNS `A app 165.227.53.165` ya propaga públicamente y el certificado
   HTTPS ya fue emitido. Falta asignar un correo operativo a Certbot para
   notificaciones de vencimiento/renovación.
2. El panel de Resend mostró `downtimeos.tech` como verificado, pero una
   comprobación desde el Droplet recibió HTTP 403 de Cloudflare y no envió
   correo. Crear una llave nueva de envío y revocar la llave expuesta; revisar
   SPF/DKIM y cambiar el SMTP de Supabase si utiliza la llave anterior.
3. En Supabase Auth, verificar Site URL y Redirect URLs con
   `https://app.downtimeos.tech`; la pantalla SMTP debe probar una entrega
   real después de rotar la llave.
4. GitHub tiene el environment `production` y los cuatro secretos de despliegue
   configurados. La publicación continúa siendo manual mediante
   `workflow_dispatch` y revisión del environment. El despliegue del digest de
   `25df02a` terminó correctamente y su healthcheck remoto pasó.

Cuando la llave de Resend se haya rotado, SMTP y URLs de Auth estén verificados,
y las pruebas de correo hayan pasado, activa el proxy final desde el checkout
actualizado del servidor (el certificado y el endpoint local ya están listos):

```sh
sudo install -o root -g root -m 0644 \
  /opt/downtimeos/deploy/digitalocean/nginx-app-https.conf \
  /etc/nginx/sites-available/downtimeos-app.conf
sudo nginx -t
sudo ln -sfn /etc/nginx/sites-available/downtimeos-app.conf \
  /etc/nginx/sites-enabled/downtimeos-app.conf
sudo nginx -t && sudo systemctl reload nginx
```

La plantilla redirige HTTP a HTTPS, responde `444` para hosts desconocidos y
proxya exclusivamente a `127.0.0.1:3000`. El sitio temporal `downtimeos-acme`
se conserva como servidor HTTP por defecto para los desafíos ACME; no publiques
el puerto 3000.

## Criterio de aceptación

- `npm test`, `npm run build`, `npm run smoke` y `npm audit --omit=dev` verdes en
  el commit exacto.
- GHCR contiene la imagen del commit exacto y el host la descarga por digest con
  credencial de lectura.
- `docker compose -f docker-compose.production.yml config` funciona sin revelar
  valores secretos; contenedor healthy, no root, puerto solo localhost.
- HTTPS y callbacks de Supabase/Auth corresponden al dominio real.
- Flujos críticos probados en un proyecto remoto dedicado con datos ficticios,
  sin llamadas involuntarias a proveedores pagos.
- Procedimiento de respaldo y restauración probado; rollback de imagen ensayado.
- No se comunica “producción lista” solo por tener la página respondiendo.

No ejecutes migraciones a ciegas, `docker compose down -v`, `docker system prune`
ni limpiezas destructivas en el host. Documenta y respalda cualquier dato que
deba conservarse antes de tocar el servidor.
