# Despliegue de DowntimeOS en DigitalOcean

Este documento registra el despliegue de DowntimeOS en el Droplet existente.
**Estado: publicado por HTTPS; piloto controlado pendiente.**
`https://app.downtimeos.tech` resuelve al Droplet y presenta certificado TLS
válido. Nginx redirige HTTP a HTTPS y enruta la aplicación al contenedor, que
sigue enlazado solo a `127.0.0.1:3000`. Verificado desde fuera: `/`, `/acceso`,
`/registro`, `/recuperar` y `/api/health` responden 200; los puertos 3000,
5432 y 2375 no son accesibles públicamente. El dominio `downtimeos.tech` está
verificado en Resend, envío habilitado, y Supabase Auth guardó la configuración
SMTP con la clave vigente. Aún falta probar una entrega real y los flujos Auth
remotos, obtener y probar un respaldo integral, revisar avisos de seguridad y
validar recuperación. UFW ya limita SSH a la IPv4 actual de esta máquina
(regla /32); la IP no se publica aquí porque puede cambiar. El firewall externo
de DigitalOcean aún no se pudo verificar. No anunciar el MVP como 100% ni
invitar testers hasta completar las comprobaciones pendientes. No se despliega
en Vercel ni en Azure.

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
- `.github/workflows/uptime-production.yml` consulta el endpoint HTTPS de salud
  cada 15 minutos, en cada push a `main` y bajo ejecución manual, sin usar
  secretos ni cambiar estado. Un fallo queda registrado en GitHub Actions; las
  notificaciones personales dependen de las preferencias de GitHub.

## Estado del Droplet (11 oct 2026)

El propietario aprobó y aplicó el plan de **1 vCPU, 2 GB RAM y 50 GB SSD
(USD 12/mes)**. Se verificaron 1.9 GiB de memoria visible, Docker 29.9.0,
Compose v5.6.0 y firewall UFW activo. SSH acepta llaves, deshabilita el acceso
directo de `root` y la autenticación por contraseña. UFW tiene entrada denegada
por defecto: SSH (22/tcp) solo permite la IPv4 actual de esta máquina (/32),
mientras HTTP/HTTPS (80/443) permanecen públicos en IPv4 e IPv6. Se probó una
segunda conexión SSH desde esa misma máquina. El firewall externo de
DigitalOcean no se pudo confirmar desde el host. Nginx y Certbot están
instalados; Nginx está activo, pasa `nginx -t`, y el timer de renovación está
activo. Se emitió el certificado
para `app.downtimeos.tech` con HTTP-01; el listener 443 y el proxy HTTPS están
activos y se validaron externamente.
`unattended-upgrades` está enabled y
active. Se aplicó `sosreport` sin reiniciar servicios; dos paquetes Ubuntu
continúan diferidos por phased updates y el kernel está vigente. La imagen de
aplicación desplegada corresponde a `25df02a`; el workflow de CI,
imagen y disponibilidad pasó para `main` en `4d54143134d30c065d4dd055cd9c2a5892fd9da4`.
Ese commit posterior contiene documentación/monitoreo, no cambios de runtime
que requieran otro despliegue. El contenedor actual está healthy, corre como
`nextjs`, usa digest inmutable, reinicio `unless-stopped` y límite de memoria de
768 MiB.
La nueva plantilla de Nginx para HTTPS se validó con Nginx 1.24. En `d65fda4`
se eliminó el `chown -R` del filesystem
de runtime: los archivos son root-owned y de solo lectura para `nextjs`, con
`/tmp` y la caché como los únicos mounts escribibles. La imagen candidata local
bajó de 1.44 GB a 883 MB (559 MB menos); PDFKit se importa y la página/config
publica responden 200 con los límites y restricciones de Compose. El endpoint
`/api/health` responde 200 con Supabase, tanto desde el host como a través del
proxy público. La configuración HTTPS está activa como
`/etc/nginx/sites-enabled/downtimeos-app.conf`; `nginx -t` pasó y Nginx se
recargó correctamente. El certificado está en
`/etc/letsencrypt/live/app.downtimeos.tech/`.
`/etc/downtimeos/production.env` existe con permisos `root:root 0600` y
`/etc/downtimeos/image.env` apunta al digest inmutable desplegado desde CI/CD.

La aplicación está publicada en `https://app.downtimeos.tech`. El paquete GHCR
es privado. El workflow de CD
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

**Estado de correo:** Resend marca el dominio como verificado, DKIM y los dos
CNAME de envío como verificados, y el envío está habilitado. La credencial de
envío vigente se configuró en el SMTP personalizado de Supabase Auth; el panel
confirmó que los cambios se guardaron. No se imprime ni se versiona la clave.
Falta comprobar entrega en una bandeja autorizada y el circuito completo de
confirmación/recuperación. La prueba SMTP directa desde el Droplet no completó
por timeout de salida; esto no demuestra un fallo del SMTP de Supabase, ya que
Auth envía desde la infraestructura gestionada de Supabase.

La base de producción recibió el esquema de las migraciones y el backfill
autorizado de propietario/membresía; el historial remoto registra 57
migraciones versionadas. La migración `20261011093307` fijó `search_path` en
ocho funciones y quitó a `anon`/`authenticated` ejecución directa de las cuatro
funciones de costo; `service_role` conserva el acceso. Se volvió a consultar el
advisor: esas ocho alertas ya no aparecen. La migración `20261011093741` movió
`btree_gist` a `extensions` y se comprobó que la restricción GIST de periodos
sigue instalada. Quedan 14 avisos INFO de RLS sin políticas. La verificación
de grants mostró que 12 de esas tablas no son accesibles por roles cliente; dos
conservan `SELECT` para `authenticated`, pero RLS sin política bloquea sus
filas. Hay que revocar esos grants redundantes en una migración controlada.
El advisor mantiene una alerta de protección contra contraseñas filtradas
deshabilitada. La documentación oficial indica que esa función requiere Supabase
Pro o superior; el proyecto actual es Free, y no se actualizará el plan ni se
generarán cargos para quitar esa alerta. También hay alertas de performance del
advisor que deben revisarse tras obtener un respaldo. La
organización Supabase está en plan Free, que no incluye respaldos automáticos;
las exportaciones parciales observadas cubrían esquema y datos de `public`, no
hay dump completo ni restauración probada. Para cumplir continuidad sin subir
de plan, falta obtener el password de base de datos por un canal seguro y
configurar exportación lógica cifrada fuera del Droplet, con prueba de restore.
No se ampliaron servicios ni se incurrió en cargos. El catálogo `planes`
está vacío por decisión de no cambiar importes, y no se crearon pagos ni
suscripciones.

## Etapas 0–100

1. **Inventario y seguridad del host (0–15%)** — confirmar Droplet, Ubuntu,
   acceso `downtimeos` por llave, `PermitRootLogin no`, reglas de firewall y
   recuperación. SSH por llave se validó tras restringir UFW a la IP actual;
   conservar la consola de DigitalOcean para recuperación si cambia esa IP.
2. **Capacidad y Docker (15–30%)** — acordar tamaño/costo, instalar Docker y
   Compose desde repositorio oficial, habilitar actualizaciones de seguridad y
   configurar firewall. Hecho en el host; queda confirmar el firewall externo
   de DigitalOcean. Los puertos de la aplicación no se exponen a Internet;
   Docker puede alterar el comportamiento de UFW, así que
   se validan también las reglas de iptables/nftables.
3. **Entorno de datos y secretos (30–45%)** — Supabase de producción confirmado,
   historial de esquema sincronizado (57 migraciones) y backfill autorizado.
   `production.env` está creado como archivo root-only. Las exportaciones
   disponibles fueron parciales y no constituyen un respaldo completo; falta
   obtener la credencial de base de datos por canal seguro, configurar backup
   lógico cifrado y probar restauración. La llave de envío recién creada está
   configurada en SMTP Auth; falta una entrega E2E autorizada. No activar
   IA/WhatsApp.
4. **Imagen y CI (45–60%)** — workflows de CI e imagen verificados; GHCR publica
   imagen por SHA. El CD ya usa un token efímero de lectura durante el pull.
   Se verificó el build de `main` y la imagen inmutable; los cuatro secretos
   SSH están en el environment `production`.
5. **Runtime y proxy (60–75%)** — Compose, healthcheck, límites y logs están
   preparados; Nginx y Certbot están instalados. DNS/certificado listos, proxy
   HTTPS activo y rutas públicas verificadas desde fuera; puertos internos
   siguen cerrados. Falta verificar Auth/correo de extremo a extremo.
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
   Healthcheck y rutas públicas pasan por HTTPS. Correo/Auth E2E, backup/restore
   y aceptación remota siguen pendientes.

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
   HTTPS ya fue emitido y verificado externamente. Falta configurar un contacto
   operativo de Certbot para notificaciones de renovación.
2. Resend verifica `downtimeos.tech`, DKIM y ambos CNAME de envío; envío está
   habilitado. SMTP Auth guardó la credencial vigente. Falta una prueba de
   confirmación/recuperación que confirme entrega en un buzón autorizado.
3. Verificar en Supabase Auth `Site URL` y `Redirect URLs` para
   `https://app.downtimeos.tech`, y ejecutar el E2E de Auth sin generar cuentas
   o envíos a terceros no autorizados.
4. GitHub tiene el environment `production`, sus cuatro secretos y aprobación
   requerida. CI e imagen GHCR pasaron para `836970c`; la publicación sigue
   siendo manual mediante `workflow_dispatch`. La imagen actual desplegada es
   `25df02a`; cualquier cambio se promueve por digest tras aprobar el workflow.
5. Falta un respaldo integral con cifrado y una restauración ensayada. Supabase
   Free no incluye backup automático; obtener la credencial de DB por canal
   seguro, sin pegarla en el chat ni guardarla en Git, antes de preparar el job.
6. El healthcheck público periódico corre desde GitHub Actions; completar
   alertas operativas con notificación confirmada y seguimiento de disco/memoria.

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
