# Despliegue de DowntimeOS en DigitalOcean

Este documento registra el despliegue de DowntimeOS en el Droplet existente.
Estado (12 oct 2026): runtime desplegado en
`https://downtimeos.tech` y `https://app.downtimeos.tech`, con `www` redirigido
al raíz. El commit `357c2a860dbfc0e48d2d3fbdcec915649c7d1b72` pasó CI, build,
smoke, auditoría y publicación de imagen; el CD protegido lo desplegó por el
digest `sha256:13cab5fb0245c7b0d01ed3f46762b3c741ce6356da53847f611da7e081b658cf`.
El job de producción terminó correctamente; el healthcheck y `/contacto-whatsapp`
responden 200, y su API sin sesión responde 401. El workflow antiguo que
esperaba revisión para un SHA anterior fue cancelado para evitar un rollout
accidental de código obsoleto. La migración `20261012073419` ya consta en el
historial remoto de Supabase y no requería un cambio de aplicación.
Desde esta máquina se comprobó que 22/80/443 son accesibles y que 3000/5432/2375/2376
no aceptan conexiones externas.
La configuración de acceso privado `/administracion` está presente en
producción. Una sesión válida devolvió HTTP 200 y el panel respondió HTTP 200;
el email y la contraseña permanecen solo en el archivo root-only.
El Droplet sirve `https://downtimeos.tech` con TLS válido al conectarse
directamente a `165.227.53.165`; `/`, `/api/health` y
`/administracion/acceso` responden 200. `www.downtimeos.tech` devuelve 301 al
apex. El registro `.tech` delega a cuatro nameservers. La auditoría autoritativa
del 2026-10-12 consultó A para raíz, `www` y `app` en cada uno (**12/12** en
`165.227.53.165`) y no encontró registros AAAA para esos hosts. La raíz y
`https://app.downtimeos.tech/api/health` respondieron 200; `www` devolvió 301 al
apex. La divergencia DNS anterior está resuelta; no hace falta cambiar el
dominio en Get.tech ahora. Soporte técnico oficial:
[`support@get.tech`](https://get.tech/contact-us).
El puerto de aplicación sigue enlazado solo a `127.0.0.1:3000`. En el rollout
actual se verificó desde fuera `/api/health`, acceso, registro y recuperación;
el smoke de CI verificó 20 rutas, 10 pantallas con estilos, 6 recursos, 26
guardas de API y `/api/health`; el SSH desde esta
máquina conserva su regla `/32`. El CD pasó con aprobación manual y runner
efímero en un contenedor aislado, sin abrir SSH a rangos compartidos de GitHub.
La aceptación Auth con cuentas sintéticas y el envío de prueba al simulador de
Resend ya habían pasado; falta confirmar recepción en un buzón personal
autorizado. También faltan respaldo/restauración integral y aceptación funcional
de invitación de equipo.
Por eso no se declara aún 100% ni se invita a testers. No se despliega en
Vercel ni Azure.

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
  Producción solo se actualiza con `workflow_dispatch`, aprobación manual y los
  secretos SSH del environment `production`. El job usa un runner efímero
  dentro de un contenedor sin mounts ni puertos publicados, lanzado desde la
  máquina confiable que está permitida por el firewall SSH. Así no se abren los
  rangos IP compartidos de GitHub. Después de poner en cola el workflow, ejecuta
  `scripts/run-deploy-runner.ps1` desde el checkout del repositorio; el runner
  acepta un job y se elimina al terminar.
- `.github/workflows/uptime-production.yml` consulta el endpoint HTTPS de salud
  cada 15 minutos, en cada push a `main` y bajo ejecución manual, sin usar
  secretos ni cambiar estado. Un fallo queda registrado en GitHub Actions; las
  notificaciones personales dependen de las preferencias de GitHub.

## Estado del Droplet (12 oct 2026)

El propietario aprobó y aplicó el plan de **1 vCPU, 2 GB RAM y 50 GB SSD
(USD 12/mes)**. Se verificaron 1.9 GiB de memoria visible, Docker 29.9.0,
Compose v5.6.0 y firewall UFW activo. SSH acepta llaves, deshabilita el acceso
directo de `root` y la autenticación por contraseña. UFW tiene entrada denegada
por defecto. El Cloud Firewall `downtimeos-production-ingress` está asignado a
este Droplet: permite SSH (22/tcp) solo desde la IPv4 autorizada actual de esta
máquina (/32), HTTP/HTTPS (80/443) desde IPv4 e IPv6 públicas y mantiene toda la
salida permitida. DigitalOcean muestra 6 reglas y 1 Droplet. Desde esta máquina
se confirmó SSH y web accesibles; los puertos 3000, 5432, 2375 y 2376 no aceptan
conexiones externas. Si cambia la IP pública del operador, SSH quedará bloqueado
hasta actualizar el origen del firewall desde una sesión SSH autorizada o la
consola de DigitalOcean. Nginx y Certbot
están instalados; Nginx está activo, pasa `nginx -t`, y el timer de renovación está
activo. Se emitió el certificado
para `app.downtimeos.tech` con HTTP-01; el listener 443 y el proxy HTTPS están
activos y se validaron externamente.
`unattended-upgrades` está enabled y
active. Se aplicó `sosreport` sin reiniciar servicios; dos paquetes Ubuntu
continúan diferidos por phased updates y el kernel está vigente. La imagen
desplegada por CD está fijada al commit
`357c2a860dbfc0e48d2d3fbdcec915649c7d1b72`, digest
`sha256:13cab5fb0245c7b0d01ed3f46762b3c741ce6356da53847f611da7e081b658cf`.
CI, publicación GHCR y CD protegido terminaron correctamente para ese commit.
El contenedor actual está healthy, corre como
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

Las URL públicas verificadas en esta fase son `https://downtimeos.tech` (canónica)
y `https://app.downtimeos.tech`; `www.downtimeos.tech` redirige al dominio raíz.
Los 16 servidores autoritativos y cinco resolvers públicos consultados responden
con la IP del Droplet. No cambies sus registros DNS ni los registros MX/TXT/CNAME
de Resend o Google Workspace sin una razón concreta. El paquete
GHCR es privado. El workflow de CD solicita `packages: read` a `GITHUB_TOKEN`
y entrega ese token por stdin sobre SSH; el script lo guarda solo en un
directorio temporal bajo `/run` y lo elimina al finalizar. El environment
`production` tiene una llave SSH dedicada,
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
alternativa de texto plano. Esta revisión está incluida en el runtime desplegado
actual; el smoke HTTPS pasó. El envío previo al simulador oficial de Resend
fue aceptado. Sigue pendiente confirmar recepción en un buzón real autorizado.

La base de producción recibió el esquema de las migraciones y el backfill
autorizado de propietario/membresía; el historial remoto registra 58
migraciones versionadas. La migración `20261011093307` fijó `search_path` en
ocho funciones y quitó a `anon`/`authenticated` ejecución directa de las cuatro
funciones de costo; `service_role` conserva el acceso. Se volvió a consultar el
advisor: esas ocho alertas ya no aparecen. La migración `20261011093741` movió
`btree_gist` a `extensions` y se comprobó que la restricción GIST de periodos
sigue instalada. El advisor informa 14 tablas con RLS sin políticas. La auditoría
de privilegios confirmó que `anon` no tiene permisos en esas tablas; la
migración `20261012073419` revocó el `SELECT` redundante de `authenticated` en
`planta_causas` y `planta_eventos_respaldo_duraciones`. Se verificó que RLS sigue
activo, `authenticated` ya no tiene `SELECT` y `service_role` conserva su acceso.
No se modificaron filas. La app usa el cliente servidor para tablas privadas y
autentica/autoriza la sesión y planta antes de acceder.
El bucket privado `comprobantes-suscripcion` estaba ausente aunque la migración
`20261002000100` figura aplicada; el bucket previsto se restauró como
configuración privada (10 MiB, PDF/JPEG/PNG). Se verificó junto con el bucket
privado `reportes`; no había objetos en el bucket faltante y no se cambiaron
pagos. El flujo usa URLs de carga firmadas y validación en la API; falta probar
la aceptación autenticada con una cuenta y un pago autorizados, sin crear pagos
de prueba en producción.
El advisor mantiene una alerta de protección contra contraseñas filtradas
deshabilitada. La documentación oficial indica que esa función requiere Supabase
Pro o superior; el proyecto actual es Free, y no se actualizará el plan ni se
generarán cargos para quitar esa alerta. También hay alertas de performance del
advisor que deben revisarse tras obtener un respaldo. La
organización Supabase está en plan Free, que no incluye respaldos automáticos;
las exportaciones parciales observadas cubrían esquema y datos de `public`, no
hay dump completo ni restauración probada. Los backups PostgreSQL tampoco
incluyen los objetos de Supabase Storage, que requieren respaldo por separado.
Supabase recomienda para Free usar
`supabase db dump` y guardar copias fuera del proyecto
([documentación oficial](https://supabase.com/docs/guides/platform/backups)). El
panel de DigitalOcean ofrece "Setup Automated Backups", así que tampoco hay
backups automáticos del Droplet configurados.
La `.env.local` revisada no contiene `SUPABASE_DB_PASSWORD` ni `DATABASE_URL`, y
esta máquina no tiene `supabase`, `pg_dump` ni `pg_restore` instalados. Para
cumplir continuidad sin subir de plan falta conseguir la contraseña de DB por
canal seguro, instalar/usar un cliente aprobado y configurar exportación lógica
cifrada fuera del Droplet, con prueba de restore.
No se ampliaron servicios ni se incurrió en cargos. El catálogo `planes`
está vacío por decisión de no cambiar importes, y no se crearon pagos ni
suscripciones.

## Etapas 0–100

1. **Inventario y seguridad del host (0–15%)** — confirmar Droplet, Ubuntu,
   acceso `downtimeos` por llave, `PermitRootLogin no`, reglas de firewall y
   recuperación. SSH por llave se validó tras restringir UFW a la IP actual;
   Cloud Firewall permite SSH solo desde esa IP (/32); conservar la consola de
   DigitalOcean para recuperación si cambia.
2. **Capacidad y Docker (15–30%)** — acordar tamaño/costo, instalar Docker y
   Compose desde repositorio oficial, habilitar actualizaciones de seguridad y
   configurar firewall. UFW del host está activo y el Cloud Firewall
   `downtimeos-production-ingress` está asignado. Desde esta máquina se
   verificaron SSH/HTTP/HTTPS accesibles y 3000/5432/2375/2376 cerrados.
3. **Entorno de datos y secretos (30–45%)** — Supabase de producción confirmado,
   historial de esquema sincronizado (comparación local/remota: 58/58 versiones,
   sin extras ni faltantes) y backfill autorizado.
   `production.env` está creado como archivo root-only. Se creó una clave
   `sb_secret_` dedicada pero aún no se pudo recuperar del panel de forma segura
   para hacer el cambio atómico; la clave actual sigue funcionando y debe
   conservarse hasta validar el reemplazo. Las exportaciones
   disponibles fueron parciales y no constituyen un respaldo completo; falta
   obtener la credencial de base de datos por canal seguro, configurar backup
   lógico cifrado y probar restauración. La llave de envío está configurada en
   SMTP Auth; falta confirmar recepción en un buzón autorizado. IA, WhatsApp y
   PDF aparecen habilitados en observabilidad; Meta muestra las cuatro
   plantillas aprobadas, pero el histórico registra entregas fallidas de
   WhatsApp. No se hizo un envío ni análisis nuevo en esta revisión. En el
   chequeo actual `.env.local` apunta al proyecto confirmado
   pero no contiene `DATABASE_URL` ni contraseña DB, y contiene otras claves de
   desarrollo: no copiarlo al servidor.
4. **Imagen y CI (45–60%)** — workflows de CI e imagen verificados; GHCR publica
   imagen por SHA. El CD ya usa un token efímero de lectura durante el pull.
   Se verificó el build de `main` y la imagen inmutable; los cuatro secretos
   SSH están en el environment `production`.
5. **Runtime y proxy (60–75%)** — Compose, healthcheck, límites y logs están
   preparados; Nginx y Certbot están instalados. `app` y su healthcheck responden
   200 por HTTPS; proxy HTTPS activo y puertos internos cerrados. Los cuatro
   DNS autoritativos entregan A del Droplet para raíz, `www` y `app` (12/12),
   sin AAAA. Raíz y healthcheck responden por HTTPS.
   Auth remoto pasó con cuentas sintéticas; quedan recepción en buzón propio y
   aceptación de invitación. La sesión administrativa válida y el panel privado
   devolvieron HTTP 200.
6. **CD restringido y rollback (75–85%)** — comando root-owned, regla sudo
   restringida, llave exclusiva de Actions, `known_hosts` fijado y environment
   con aprobación manual están configurados. El commit
   `357c2a860dbfc0e48d2d3fbdcec915649c7d1b72` pasó CI, se aprobó en el
   environment `production` y se desplegó por digest inmutable; el job de CD y
   el healthcheck posterior pasaron. El runner efímero se ejecutó en contenedor aislado desde
   la máquina confiable;
   no se abrió SSH a rangos compartidos. Nunca se usa la contraseña personal de
   sudo.
7. **Validación y entrega (85–100%)** — smoke HTTPS, registro/confirmación,
   recuperación, invitaciones, roles, piloto, suscripción, aislamiento de
   empresas, operación y backup/restore. Solo después compartir URL y guía clara
   para testers; registrar procedimiento de despliegue, rollback y soporte.
   Healthcheck, 20 rutas públicas, 26 guardas API y callbacks de Auth sintéticos
   pasan por HTTPS. DNS y Cloud Firewall externos quedaron verificados; se
   restauró la configuración privada del bucket de comprobantes faltante.
   Faltan buzón real autorizado, respaldo/restore integral (incluidos objetos de
   Storage), aceptación de invitación de equipo, prueba autenticada de carga de
   comprobantes, diagnóstico de las entregas fallidas de WhatsApp y ensayo
   controlado de rollback en producción.

## Preparación de GitHub

El repositorio `h3l10-hu3rt4/downtimeOS` es público, pero la imagen GHCR es
privada. El workflow solicita `packages: read` para su `GITHUB_TOKEN`, lo envía
por stdin a través de SSH y el comando root-owned lo usa con `--password-stdin`
desde un `DOCKER_CONFIG` temporal en `/run`; el directorio se elimina tanto al
terminar como al fallar o hacer rollback. No se guarda un PAT permanente en el
Droplet, Actions ni `.env.local`. El job corre en un runner efímero iniciado
desde la máquina cuya IP ya está permitida por SSH; no abre puertos, no monta el
Docker socket ni carpetas del host y acepta un solo job. Arráncalo con
`scripts/run-deploy-runner.ps1` después de poner en cola el workflow de CD.
La imagen no debe contener secretos ni datos de clientes. No hagas público el
paquete: cambiarlo a público no se puede revertir a privado
([documentación de visibilidad](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility)).

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
  automáticamente SMTP de Auth. El `Site URL` canónico debe ser
  `https://downtimeos.tech`; agrega como redirects productivos las rutas
  exactas de callback (`/activar`, `/recuperar`) y conserva solo callbacks
  locales necesarios para desarrollo.
- `CRON_SECRET` solo si se habilitan tareas programadas.
- IA, WhatsApp y PDF están configurados, pero el catálogo `public.planes` y las
  suscripciones están vacíos. Hay 4 miembros de Dirección y 1 de Operaciones;
  ninguno registró/verificó WhatsApp con consentimiento. Los endpoints exigen
  plan activo: no cambies precios ni crees suscripciones para eludirlo. Las
  pruebas automatizadas simulan proveedores; plantillas aprobadas no prueban
  entrega real.

La revisión de producción (12 oct 2026) encontró 236 mensajes históricos de
WhatsApp: 152 `delivered`, 30 `sent` sin confirmación final, 2 `queued` y 52
`failed` (64% entregados/leídos). Estos son registros históricos, no un test
actual. El release `357c2a8` reemplazó los destinatarios globales con registro
individual por usuario/planta, opt-in, verificación de titularidad y fan-out
multiusuario por rol. Los cuatro nombres constan aprobados en Meta:
`downtimeos_alerta_paros`
(`es_MX`), `downtimeos_alerta_activo` (`en`),
`downtimeos_reporte_ejecutivo` (`en`, encabezado PDF) y
`downtimeos_validacion_paro` (`en`, botones de respuesta). El código construye
los payloads correspondientes y las pruebas automatizadas pasan; la entrega
real y los callbacks de estados requieren aceptación controlada con teléfonos
autorizados. La IA tiene 447 análisis históricos y el PDF 83 reportes. No se
ejecutaron llamadas reales de IA, PDF o Meta en este release porque faltan plan
habilitado y contactos verificados; no se saltó la autorización de suscripción
ni se provocaron cargos.

**No copiar el `.env.local` completo.** Las claves de Supabase, Resend y
proveedores que se hayan mostrado o compartido durante desarrollo deben rotarse
antes de uso productivo.

## Dependencias externas pendientes

1. DNS raíz, `www` y `app.downtimeos.tech` responden al Droplet en la revisión
   2026-10-12 (12/12 respuestas A en cuatro autoridades; sin AAAA); raíz y
   `app` responden 200 por HTTPS y `www` redirige al apex.
   Falta configurar un contacto operativo de Certbot para notificaciones de
   renovación.
2. Resend verifica `downtimeos.tech`, DKIM y ambos CNAME de envío; envío está
   habilitado. SMTP Auth guardó la credencial. Confirmación, recuperación e
   invitación Auth pasaron con cuentas sintéticas; también pasó el simulador de
   Resend. Falta confirmar recepción en un buzón personal autorizado.
3. Supabase Auth tiene `Site URL` `https://downtimeos.tech` y redirects
   productivos para `/activar` y `/recuperar`, además del redirect local de
   recuperación. Los callbacks productivos se verificaron.
4. GitHub tiene el environment `production`, sus cuatro secretos y aprobación
   requerida. CI, imagen GHCR y CD pasaron para el runtime
   `357c2a860dbfc0e48d2d3fbdcec915649c7d1b72`, desplegado por digest
   `sha256:13cab5fb0245c7b0d01ed3f46762b3c741ce6356da53847f611da7e081b658cf`.
   La publicación sigue siendo manual mediante `workflow_dispatch`; los cambios
   de runtime se promueven por digest tras aprobar el workflow.
5. Falta un respaldo integral con cifrado y una restauración ensayada. Supabase
   Free no incluye backup automático; obtener la credencial de DB por canal
   seguro, sin pegarla en el chat ni guardarla en Git, antes de preparar el job.
   No subir de plan ni activar ningún cargo sin aprobación.
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
