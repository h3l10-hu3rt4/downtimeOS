# Entorno de validación y estado de producción

**No existe un staging remoto aislado.** El servidor es un DigitalOcean Droplet;
el proyecto Supabase conectado es el de **producción**. No se deben tratar sus
datos como fixtures ni hacer pruebas destructivas allí. La demo `/demo` y
Supabase Local son entornos separados: no usar Supabase Local desde otra computadora;
no se deben abrir puertos de Supabase de una PC para compartirlo.

## Estado verificado (12 oct 2026)

| Componente | Estado comprobado | Límite de esta comprobación |
| :--- | :--- | :--- |
| Aplicación | `https://downtimeos.tech` y `https://app.downtimeos.tech` responden por HTTPS; `/api/health`, `/acceso`, `/registro` y `/recuperar` responden 200. `www` redirige al dominio raíz. | No sustituye el recorrido autenticado del producto. |
| Despliegue | El commit `5ca813d04af79b1fc0cb794d671051bdb5b78342` pasó CI, se publicó por digest inmutable y el job protegido de DigitalOcean terminó correctamente. | No se hizo un rollback de producción de prueba. |
| Supabase | Proyecto `downtimeOS` en `ACTIVE_HEALTHY`; el historial remoto incluye la migración `20261012073419`. | No se ejecutó ni modificó esquema/datos durante esta revisión. |
| Correo Auth | Resend y SMTP Auth constan configurados; confirmación, recuperación e invitación pasaron con cuentas sintéticas. | Falta confirmar recepción en un buzón personal autorizado y aceptación funcional de invitación al equipo. |
| IA, PDF y WhatsApp | Los interruptores aparecen activos; las cuatro plantillas de Meta configuradas constan como aprobadas. Hay uso histórico registrado. | WhatsApp también tiene entregas fallidas; no se hizo un envío, análisis ni PDF nuevo en esta revisión. La aprobación de plantilla no garantiza entrega. |
| Administración | Las APIs de observabilidad y selección de proveedor de IA responden 401 sin sesión. | Falta completar pruebas autenticadas de suscripciones, pilotos y carga de comprobantes con una cuenta de prueba autorizada. |

La consulta de solo lectura a la base confirmó 5 organizaciones, 0 suscripciones
y 0 filas en `public.planes`. Por tanto, aunque el panel administrativo está
disponible, el catálogo de planes no permite activar Starter/Pro/Enterprise ni
probar el ciclo de suscripción hasta revisar y cargar el catálogo acordado. No
se añadieron precios, suscripciones ni pagos en esta revisión.

## Antes de abrirlo a testers

- Preparar un respaldo lógico cifrado fuera del Droplet, respaldar por separado
  los objetos de Storage y ensayar una restauración. Supabase Free no ofrece
  backup automático; no subir de plan ni activar cargos sin aprobación.
- Confirmar correo de Auth en una bandeja autorizada y recorrer la aceptación de
  invitación desde la interfaz.
- Probar carga/lectura de comprobante con usuario y archivo sintéticos
  autorizados, sin crear pagos ni suscripciones de cobro reales.
- Investigar los estados fallidos de WhatsApp y probar cada flujo solo con
  destinatarios autorizados. No enviar mensajes de prueba a contactos reales
  sin autorización específica.
- Habilitar alertas operativas y completar el ensayo de rollback documentado.
- Confirmar que los planes/precios necesarios para suscripciones estén
  cargados y revisados antes de probar compra o activación; no cambiar precios,
  registrar pagos ni generar cargos durante la validación.

Hasta cerrar estos puntos, la app está publicada y saludable, pero **no debe
anunciarse como aceptación completa ni como MVP 100% listo**. Sigue el
[procedimiento de despliegue](../DEPLOY-DIGITALOCEAN.md) y la
[guía de pruebas locales](GUIA-PRUEBAS-USUARIO.md). Para pruebas aisladas usa
Docker, Supabase Local y Mailpit; nunca apuntes las pruebas locales a la base
remota ni compartas `.env.local`.
