# Despliegue de DowntimeOS en DigitalOcean

Este documento define la ruta de despliegue en el Droplet existente. **No
significa que ya esté publicado.** El MVP todavía no tiene URL productiva,
dominio ni HTTPS. El proyecto Supabase de producción está confirmado y su
esquema ya fue sincronizado; no se despliega en Vercel ni en Azure.

## Arquitectura y límites

- Droplet Ubuntu, Docker Engine y Compose. La aplicación corre como usuario no
  root, sin capacidades Linux, con filesystem de solo lectura y reinicio
  automático.
- Compose usa una imagen inmutable GHCR identificada por SHA y publica el puerto
  de la app solo en `127.0.0.1:3000`. El proxy HTTPS termina TLS cuando exista
  un dominio. No publiques directamente el puerto de la app.
- Supabase remoto dedicado a producción para Auth, PostgreSQL y Storage. No uses
  Supabase Local ni copies el `.env.local` de desarrollo.
- Secretos de runtime en `/etc/downtimeos/production.env`, propiedad de root y
  modo `0600`; no están en GitHub, imagen, historial de shell ni repositorio.
- GitHub Actions prueba, construye y publica en GHCR al integrar a `main`.
  Producción solo se actualiza con `workflow_dispatch` y aprobación del
  environment protegido `production`.

## Estado del Droplet (11 oct 2026)

El propietario aprobó y aplicó el plan de **1 vCPU, 2 GB RAM y 50 GB SSD
(USD 12/mes)**. Se verificaron 1.9 GiB de memoria visible, Docker 29.9.0,
Compose v5.6.0 y firewall UFW activo. SSH acepta llaves, deshabilita el acceso
directo de `root` y la autenticación por contraseña. El host ya tiene el
repositorio en `main` (`c0de9ea`) y el comando de despliegue root-owned.

La aplicación todavía **no está desplegada**: no existe
`/etc/downtimeos/production.env`, no hay contenedores en ejecución y el paquete
GHCR es privado. El workflow de CD solicita `packages: read` a `GITHUB_TOKEN` y
entrega ese token por stdin sobre SSH; el script lo guarda solo en un directorio
temporal bajo `/run` y lo elimina al finalizar. Tampoco hay dominio configurado.
La composición de producción reserva 768 MiB al contenedor y limita el heap de Node a 512 MiB, dejando
memoria disponible para Ubuntu y Docker. No se crea infraestructura adicional
ni se modifica el gasto sin autorización.

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
   configurar firewall. Los puertos de la aplicación no se exponen a Internet;
   Docker puede alterar el comportamiento de UFW, así que se validan también
   las reglas de iptables/nftables.
3. **Entorno de datos y secretos (30–45%)** — Supabase de producción confirmado,
   respaldado antes de la migración, esquema sincronizado y backfill aprobado.
   Falta configurar variables mínimas del servidor en archivo root-only. No
   activar IA/WhatsApp.
4. **Imagen y CI (45–60%)** — workflows de CI e imagen verificados; GHCR publica
   imagen por SHA. El CD ya usa un token efímero de lectura durante el pull.
   Falta configurar los secretos SSH del environment protegido `production`.
5. **Runtime y proxy (60–75%)** — preparar Compose, healthcheck, límites y logs;
   configurar proxy TLS cuando el owner proporcione dominio/DNS. HTTP por IP no
   se considera acceso final seguro para cuentas y cookies.
6. **CD restringido y rollback (75–85%)** — crear comando root-owned que acepte
   un commit SHA completo y un digest `sha256:<64 hex>`, haga pull de la imagen validada,
   actualice Compose, espere healthcheck y revierta a la versión previa si
   falla. `downtimeos` no recibirá acceso genérico a Docker ni `sudo` sin
   restricciones. Actions usará una llave SSH dedicada y `known_hosts` fijado;
   nunca la contraseña personal de sudo.
7. **Validación y entrega (85–100%)** — smoke HTTPS, registro/confirmación,
   recuperación, invitaciones, roles, piloto, suscripción, aislamiento de
   empresas, operación y backup/restore. Solo después compartir URL y guía clara
   para testers; registrar procedimiento de despliegue, rollback y soporte.

## Preparación de GitHub

El repositorio `h3l10-hu3rt4/downtimeOS` es público, pero la imagen GHCR es
privada. El workflow solicita `packages: read` para su `GITHUB_TOKEN`, lo envía
por stdin a través de SSH y el comando root-owned lo usa con `--password-stdin`
desde un `DOCKER_CONFIG` temporal en `/run`; el directorio se elimina tanto al
terminar como al fallar o hacer rollback. No se guarda un PAT permanente en el
Droplet, Actions ni `.env.local`. La imagen no debe contener secretos ni datos
de clientes. No hagas público el paquete: cambiarlo a público no se puede
revertir a privado ([documentación de visibilidad](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility)).

Crea un environment llamado `production`, con aprobadores requeridos y secretos
protegidos. Cuando el acceso remoto esté listo, define:

- `DO_DEPLOY_HOST`: IP o host SSH del Droplet.
- `DO_DEPLOY_USER`: cuenta dedicada sin login root.
- `DO_DEPLOY_SSH_KEY`: llave exclusiva de Actions, no la llave personal.
- `DO_DEPLOY_KNOWN_HOSTS`: clave de host verificada por un canal independiente;
  no uses `ssh-keyscan` como única comprobación de identidad.

El workflow se ejecuta desde el commit actual de `main` y exige el commit SHA
completo junto con el digest `sha256:<64 hex>` publicado en GHCR; no acepta
`latest`. El paso final llama a
`sudo /usr/local/sbin/downtimeos-deploy <commit> <digest>`. El comando fuente
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
- SMTP en Supabase Auth y URLs de confirmación/recuperación/invitación apuntando
  al host final. Las variables `RESEND_*` usadas para avisos programados no
  configuran automáticamente SMTP de Auth.
- `CRON_SECRET` solo si se habilitan tareas programadas.
- Integraciones de IA/WhatsApp apagadas hasta validar costos, límites,
  consentimiento y secretos de producción.

**No copiar el `.env.local` completo.** Las claves de Supabase, Resend y
proveedores que se hayan mostrado o compartido durante desarrollo deben rotarse
antes de uso productivo.

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
