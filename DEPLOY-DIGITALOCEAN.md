# Despliegue de DowntimeOS en DigitalOcean

Este documento registra el despliegue de DowntimeOS en el Droplet existente.
**Estado: publicado por HTTPS; Auth remoto validado técnicamente, piloto
controlado aún pendiente.**
`https://downtimeos.tech` quedó configurado como dominio canónico de la app;
`www` redirige al raíz y `app.downtimeos.tech` permanece como alias compatible.
Nginx sirve el raíz con certificado TLS válido y redirige HTTP a HTTPS; enruta la aplicación al contenedor, que
sigue enlazado solo a `127.0.0.1:3000`. Verificado desde fuera: `/`, `/acceso`,
`/registro`, `/recuperar` y `/api/health` responden 200; los puertos 3000,
5432 y 2375 no son accesibles públicamente. El dominio `downtimeos.tech` está
verificado en Resend, envío habilitado, y Supabase Auth guardó la configuración
SMTP. Se verificaron en producción los callbacks de confirmación, recuperación
de contraseña e invitación de Supabase Auth con cuentas sintéticas eliminadas
al terminar; falta confirmar recepción en un buzón personal autorizado, probar
respaldo/restauración y revisar avisos de seguridad. UFW ya limita SSH a la IPv4 actual de esta máquina
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
  `downtimeos.tech` y `www.downtimeos.tech`; la app se sirve en el raíz y `www`
  redirige al dominio canónico. No publiques directamente el puerto de la app.
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
continúan diferidos por phased updates y el kernel está vigente. La imagen que
está corriendo se identificó directamente en Docker: revisión
`25df02a47d07e65df67e55df7e57e2bae5a09ffb`, digest
`sha256:cdf73abf9306e514f6633729a4cfa0346b63a6b4f241002bd709e7d021e18d64`.
El commit actual de `main` es `1297271783d20c48c047d5f17f570232406af066`;
verificación MVP, disponibilidad e imagen CI terminaron correctamente para
ese SHA. Solo contiene documentación y no requiere un rollout de runtime. El
contenedor actual está healthy, corre como
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
La inspección del contenedor confirma que el runtime aún usa
`SUPABASE_SERVICE_ROLE_KEY` (compatibilidad legacy), no la nueva
`SUPABASE_SECRET_KEY`. El archivo de entorno no contiene un dump PostgreSQL;
la búsqueda de backups no encontró exportación de base ni archivo comprimido.
No confundir migraciones SQL versionadas con copias de seguridad.

La aplicación está publicada en `https://downtimeos.tech`. El paquete GHCR
es privado. El workflow de CD
solicita `packages: read` a `GITHUB_TOKEN` y
entrega ese token por stdin sobre SSH; el script lo guarda solo en un directorio
temporal bajo `/run` y lo elimina al finalizar. El 11 oct 2026 se cambiaron en
Get.tech los registros web: A `@` → `165.227.53.165` y CNAME `www` →
`app.downtimeos.tech`. Se sirve la aplicación en el raíz y `www` redirige al
raíz. En la última comprobación, DNS público estaba en propagación: Cloudflare y
un nameserver autoritativo ya devolvían `165.227.53.165`, pero Google y tres
nameservers autoritativos aún respondían `216.198.79.1`; el CNAME `www` seguía
apuntando a `app.downtimeos.tech`. No cambiar Supabase Auth `Site URL` a la raíz
hasta confirmar propagación y actualizar `www` al dominio canónico. No se
modificaron MX/TXT ni CNAME de Resend o Google Workspace. Certbot emitió `/etc/letsencrypt/live/downtimeos-web/` para
raíz y www, con renovación automática. Nginx aplica HTTP-01, sirve la app en el
raíz y redirige `www` al raíz; la configuración fuente está en
`deploy/digitalocean/nginx-web-redirect.conf`. El certificado anterior de
`app.downtimeos.tech` permanece separado. El environment `production` tiene una llave SSH dedicada,
host/user y `known_hosts` fijado a la huella previamente confiable; la llave
no permite forwarding ni PTY. La composición reserva 768
MiB al contenedor y limita el heap de Node a 512 MiB. Nginx/Certbot no añaden un
servicio mensual.

**Estado de correo:** Resend marca el dominio como verificado, DKIM y los dos
CNAME de envío como verificados, y el envío está habilitado. La credencial de
envío vigente se configuró en el SMTP personalizado de Supabase Auth; el panel
confirmó que los cambios se guardaron. La clave guardada en el entorno privado
del servidor respondió HTTP 200 al endpoint de lectura de dominios de Resend, y
el contenedor recibe `RESEND_API_KEY` y `DowntimeOS <no-reply@downtimeos.tech>`.
Un único envío de prueba a `delivered@resend.dev`, el simulador oficial de
Resend, fue aceptado con HTTP 200; no se envió a ninguna bandeja personal.
También se probó registro de Supabase Auth con una cuenta sintética temporal:
se completó el callback de confirmación y el inicio de sesión posterior. También
se completaron recuperación de contraseña (incluido login con la nueva clave)
e invitación, siguiendo enlaces de Resend en el dominio productivo. Las tres
cuentas sintéticas se eliminaron y se verificó su ausencia. Esto no sustituye
la aceptación de invitación de equipo (`planta_invitaciones`) desde la interfaz.
Falta confirmar recepción en un buzón personal autorizado. No se imprime ni se
versiona ninguna clave.
La prueba SMTP directa desde el Droplet no completó
por timeout de salida; esto no demuestra un fallo del SMTP de Supabase, ya que
Auth envía desde la infraestructura gestionada de Supabase.

**Identidad visual del correo (11 oct 2026):** las plantillas alojadas en
Supabase Auth para confirmación, invitación, enlace mágico/OTP, cambio de correo,
recuperación y reautenticación se actualizaron en el dashboard. Usan paleta
carbón/ámbar, lockup DowntimeOS en HTML compatible con clientes de correo y
mantienen los placeholders de confirmación o código correspondientes. La
plantilla directa de avisos de vencimiento de suscripción se implementó en
`lib/correo-marca.js`, con tablas y estilos inline, escape de datos, CTA HTTPS y
alternativa de texto plano. Falta promover esta revisión por el CD de
DigitalOcean y validar entrega a un buzón autorizado.

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
   `production.env` está creado como archivo root-only. Se creó una clave
   `sb_secret_` dedicada pero aún no se pudo recuperar del panel de forma segura
   para hacer el cambio atómico; la clave actual sigue funcionando y debe
   conservarse hasta validar el reemplazo. Las exportaciones
   disponibles fueron parciales y no constituyen un respaldo completo; falta
   obtener la credencial de base de datos por canal seguro, configurar backup
   lógico cifrado y probar restauración. La llave de envío está configurada en
   SMTP Auth; falta confirmar recepción en un buzón autorizado. No activar
   IA/WhatsApp.
4. **Imagen y CI (45–60%)** — workflows de CI e imagen verificados; GHCR publica
   imagen por SHA. El CD ya usa un token efímero de lectura durante el pull.
   Se verificó el build de `main` y la imagen inmutable; los cuatro secretos
   SSH están en el environment `production`.
5. **Runtime y proxy (60–75%)** — Compose, healthcheck, límites y logs están
   preparados; Nginx y Certbot están instalados. DNS/certificado listos, proxy
   HTTPS activo y rutas públicas verificadas desde fuera; puertos internos
   siguen cerrados. Auth remoto pasó con cuentas sintéticas; quedan recepción
   en buzón propio y aceptación de invitación de equipo.
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
   Healthcheck, rutas públicas y callbacks de confirmación, recuperación e
   invitación pasan por HTTPS. Faltan buzón real autorizado, respaldo/restore,
   firewall externo, invitación de equipo y aceptación funcional del equipo.

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
   habilitado. SMTP Auth guardó la credencial. Confirmación, recuperación e
   invitación Auth pasaron con cuentas sintéticas y callbacks productivos; falta
   confirmar recepción en un buzón personal autorizado.
3. Supabase Auth tiene `Site URL` `https://downtimeos.tech` y redirects
   productivos para `/activar` y `/recuperar`, además del redirect local de
   recuperación. Los callbacks productivos se verificaron.
4. GitHub tiene el environment `production`, sus cuatro secretos y aprobación
   requerida. CI e imagen GHCR pasaron para `836970c`; la publicación sigue
   siendo manual mediante `workflow_dispatch`. La imagen desplegada es la
   revisión `25df02a47d07e65df67e55df7e57e2bae5a09ffb`; el `main` actual es
   `1297271783d20c48c047d5f17f570232406af066` y pasó CI. Cualquier cambio de
   runtime se promueve por digest tras aprobar el workflow.
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
- Confirmación, recuperación e invitación Auth completan callbacks productivos
  con cuentas sintéticas; la aceptación de invitación de equipo requiere una
  prueba funcional separada.
- Flujos críticos probados en un proyecto remoto dedicado con datos ficticios,
  sin llamadas involuntarias a proveedores pagos.
- Procedimiento de respaldo y restauración probado; rollback de imagen ensayado.
- No se comunica “producción lista” solo por tener la página respondiendo.

No ejecutes migraciones a ciegas, `docker compose down -v`, `docker system prune`
ni limpiezas destructivas en el host. Documenta y respalda cualquier dato que
deba conservarse antes de tocar el servidor.
