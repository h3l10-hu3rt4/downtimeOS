# Despliegue de DowntimeOS en DigitalOcean

Este documento define la ruta de despliegue en el Droplet existente. **No
significa que ya esté publicado.** El MVP todavía no tiene una URL productiva,
dominio, HTTPS ni entorno de datos remoto confirmado. No se despliega en Vercel
ni en Azure.

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

El Droplet reportado tiene 1 vCPU, 512 MB de RAM, 10 GB de disco y no tiene
swap. Esa capacidad no es suficiente para asumir una carga productiva confiable
de Next.js, Docker y proxy. Antes de desplegar debe revisarse el uso y aprobarse
el costo de ampliarlo; no se cambia el tamaño ni se crea infraestructura de
pago sin confirmar precio y autorización.

## Etapas 0–100

1. **Inventario y seguridad del host (0–15%)** — confirmar Droplet, Ubuntu,
   acceso `downtimeos` por llave, `PermitRootLogin no`, reglas de firewall y
   recuperación. No bloquear SSH ni cambiar reglas sin una sesión de respaldo.
2. **Capacidad y Docker (15–30%)** — acordar tamaño/costo, instalar Docker y
   Compose desde repositorio oficial, habilitar actualizaciones de seguridad y
   configurar firewall. Los puertos de la aplicación no se exponen a Internet;
   Docker puede alterar el comportamiento de UFW, así que se validan también
   las reglas de iptables/nftables.
3. **Entorno de datos y secretos (30–45%)** — confirmar/crear Supabase dedicado,
   verificar su project ref, respaldar antes de migraciones, revisar la cadena
   versionada y aplicar migraciones solo con aprobación. Configurar variables
   mínimas de servidor en archivo root-only. No activar IA/WhatsApp ni usar
   credenciales del `.env.local` por defecto.
4. **Imagen y CI (45–60%)** — integrar los workflows, validar test/build/smoke y
   auditoría; publicar imagen GHCR por SHA. Configurar acceso de lectura a GHCR
   solo en el host y environment protegido en GitHub.
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

El workflow `container.yml` necesita permisos de escritura en Packages para
publicar la imagen del repositorio en GHCR. Comprueba en GitHub que el paquete
sea privado si el código o la imagen no deben ser públicos. El servidor requiere
un token de lectura de paquetes configurado localmente como `docker login
ghcr.io`; nunca uses ese token en el workflow.

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
`sudo /usr/local/sbin/downtimeos-deploy <commit> <digest>`; ese comando debe instalarse y
auditarse en el Droplet antes de habilitar el environment. No guardes claves de
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
