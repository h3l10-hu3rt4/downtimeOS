# Entorno remoto del MVP para testers

Este documento describe el entorno remoto de pruebas del **producto DowntimeOS**,
no la demo DowntimeCO ni el Supabase local de una computadora. El destino es un
Droplet de DigitalOcean con Docker. Por decisión del propietario, el proyecto
Supabase conectado es el de **producción**, no un proyecto aislado de staging;
por eso aún no se debe invitar al equipo a probar desde Internet.

## Arquitectura objetivo

| Componente | Ubicación | Regla de aislamiento |
| :--- | :--- | :--- |
| App Next.js | DigitalOcean Droplet, Docker Compose e imagen GHCR | Docker y firewall preparados; la aplicación aún no está publicada |
| Auth, datos y Storage | Proyecto Supabase de producción ya confirmado | Esquema sincronizado; no usar Supabase Local desde otra computadora |
| Correo Auth | SMTP de Supabase Auth | Pendiente de configurar remitente verificado y comprobar entrega |
| Secretos de app | `/etc/downtimeos/production.env`, solo root | No versionar, imprimir ni ponerlos en la imagen |

El correo local sigue en Mailpit (`http://localhost:54324`) y no llega al Droplet.
El sistema no enviará invitaciones reales hasta que se configure y valide SMTP
en Supabase Auth. WhatsApp e IA deben empezar desactivados para evitar mensajes
reales y consumo de créditos. La migración creó el esquema y vinculó la cuenta
existente; no insertó catálogo de precios, suscripciones ni pagos.

## Preparación pendiente

1. Completar secretos mínimos del runtime en `/etc/downtimeos/production.env`.
2. Configurar el environment protegido de GitHub y validar que el token
   temporal del workflow pueda descargar el paquete GHCR por digest.
3. Configurar Site URL y Redirect URLs de Supabase Auth con el dominio HTTPS.
4. Configurar SMTP para confirmación, invitaciones y recuperación; probar los
   cuatro flujos antes de abrirlo al equipo.
5. Publicar con TLS, health check y una aprobación de CI/CD; luego validar
   permisos y aislamiento con cuentas de prueba.
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
