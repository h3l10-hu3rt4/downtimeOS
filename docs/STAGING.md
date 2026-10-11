# Entorno remoto del MVP para testers

Este documento describe el entorno remoto de pruebas del **producto DowntimeOS**,
no la demo DowntimeCO ni el Supabase local de una computadora. El destino es un
Droplet de DigitalOcean con Docker. Por decisión del propietario, el proyecto
Supabase conectado es el de **producción**, no un proyecto aislado de staging;
por eso aún no se debe invitar al equipo a probar desde Internet.

## Arquitectura objetivo

| Componente | Ubicación | Regla de aislamiento |
| :--- | :--- | :--- |
| App Next.js | DigitalOcean Droplet, Docker Compose e imagen GHCR | Desplegada; `/api/health` da 200 desde el host; solo escucha en `127.0.0.1:3000`, no está publicada por HTTPS |
| Auth, datos y Storage | Proyecto Supabase de producción ya confirmado | Esquema sincronizado; no usar Supabase Local desde otra computadora |
| Correo Auth | SMTP de Supabase Auth | Pendiente de configurar remitente verificado y comprobar entrega |
| Secretos de app | `/etc/downtimeos/production.env`, solo root | No versionar, imprimir ni ponerlos en la imagen |

La imagen está desplegada de forma privada y su healthcheck confirma conexión
con Supabase. El correo local sigue en Mailpit (`http://localhost:54324`) y no
llega al Droplet. No se confirmó envío real: la llave anterior de Resend se
expuso en una salida de herramientas y debe revocarse y reemplazarse antes de
actualizar el runtime y SMTP de Supabase Auth. WhatsApp e IA deben seguir
desactivados. El esquema y el vínculo de la cuenta existente están aplicados;
no se insertó catálogo de precios, suscripciones ni pagos.

La última migración de producción (`20261011093307`) fija el `search_path` de
las funciones auditadas y restringe la ejecución directa de funciones de costos
a `service_role`. Las alertas correspondientes desaparecieron del advisor. Las
tablas marcadas como RLS sin políticas no otorgan privilegios a `anon`; revisar
por separado las 14 alertas informativas, la ubicación de `btree_gist` y la
protección de contraseñas filtradas antes del lanzamiento.

## Preparación pendiente

1. Revocar la llave Resend expuesta, crear una llave nueva y actualizar de forma
   segura `/etc/downtimeos/production.env` y SMTP de Supabase Auth si comparten
   la credencial. No enviar la llave por chat.
2. Confirmar Site URL y Redirect URLs de Supabase Auth para el dominio HTTPS.
3. Probar entrega real de confirmación, recuperación e invitación con cuentas
   autorizadas; después habilitar el proxy HTTPS público.
4. Confirmar el firewall Cloud de DigitalOcean, correo operativo de Certbot,
   restauración de respaldo y monitorización/alertas.
5. Validar permisos e aislamiento con datos ficticios en cuentas de prueba.
6. Autorizar por separado el catálogo de planes antes de cargar importes; no
   registrar pagos ni cargos durante las pruebas.

Consulta el procedimiento paso a paso en [`DEPLOY-DIGITALOCEAN.md`](../DEPLOY-DIGITALOCEAN.md).
No se requiere ni se hará un despliegue a Vercel para este proceso.

## Criterio para compartir con testers

No compartir el dominio hasta que todas estas condiciones se cumplan:

- La app está disponible por HTTPS y `/api/health` responde correctamente.
- Registro, confirmación, login, recuperación e invitaciones llegan al correo de
  prueba y sus enlaces regresan al dominio del Droplet correcto.
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
local a la base remota ni ejecutar migraciones manuales fuera de la cadena
versionada y revisada.
