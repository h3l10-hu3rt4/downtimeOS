# Entorno de validación y estado de producción

**No existe un staging remoto aislado.** El servidor es un DigitalOcean Droplet;
el proyecto Supabase conectado es el de **producción**. No se deben tratar sus
datos como fixtures ni hacer pruebas destructivas allí. La demo `/demo` y
Supabase Local son entornos separados: no usar Supabase Local desde otra computadora;
no se deben abrir puertos de Supabase de una PC para compartirlo.

## Estado verificado (12 oct 2026)

| Componente | Estado comprobado | Límite de esta comprobación |
| :--- | :--- | :--- |
| Aplicación | `https://downtimeos.tech` y `https://app.downtimeos.tech` responden por HTTPS; healthcheck 200; `/contacto-whatsapp` devuelve 200 y `/api/planta/whatsapp-contacto` rechaza sin sesión con 401. `www` redirige al dominio raíz. | No sustituye el recorrido autenticado del producto ni la verificación de un teléfono real. |
| Despliegue | El commit `357c2a860dbfc0e48d2d3fbdcec915649c7d1b72` pasó CI, se publicó por digest inmutable y el job protegido de DigitalOcean terminó correctamente. | No se hizo un rollback de producción de prueba. |
| Supabase | Proyecto `downtimeOS` en `ACTIVE_HEALTHY`; las 61 migraciones locales y remotas coinciden. Las tablas nuevas RLS tienen políticas explícitas de denegación a usuarios cliente; solo backend service-role puede leer/escribir. | Se añadieron tablas de contactos/desafíos; no se migraron números globales ni se alteraron clientes/pagos. |
| Correo Auth | Resend y SMTP Auth constan configurados; confirmación, recuperación e invitación pasaron con cuentas sintéticas. | Falta confirmar recepción en un buzón personal autorizado y aceptación funcional de invitación al equipo. |
| IA, PDF y WhatsApp | Las pruebas automáticas verifican generación PDF, composición de plantillas Meta, fan-out a varios miembros y separación Operaciones/Finanzas; las llamadas a Meta están simuladas. Los cuatro nombres de plantilla constan aprobados. | No se hizo llamada real pagada al proveedor, análisis nuevo, PDF nuevo ni mensaje WhatsApp. No hay plan/suscripción habilitado ni teléfono verificado con opt-in en producción. |
| Administración | Las APIs de observabilidad y selección de proveedor de IA responden 401 sin sesión. | Falta completar pruebas autenticadas de suscripciones, pilotos y carga de comprobantes con una cuenta de prueba autorizada. |

La consulta de solo lectura a la base confirmó 0 filas en `public.planes` y
0 suscripciones. Hay 4 membresías activas de Dirección y 1 de Operaciones, pero
ningún miembro ha registrado y verificado un número WhatsApp. Por tanto no es
posible aceptar ahora análisis IA/PDF (la aplicación exige plan activo) ni
mensajería real (exige plan y destinatarios verificados). No se añadieron
precios, suscripciones ni pagos.

## Antes de abrirlo a testers

- Preparar un respaldo lógico cifrado fuera del Droplet, respaldar por separado
  los objetos de Storage y ensayar una restauración. Supabase Free no ofrece
  backup automático; no subir de plan ni activar cargos sin aprobación.
- Confirmar correo de Auth en una bandeja autorizada y recorrer la aceptación de
  invitación desde la interfaz.
- Probar carga/lectura de comprobante con usuario y archivo sintéticos
  autorizados, sin crear pagos ni suscripciones de cobro reales.
- Cada persona de Operaciones o Dirección/Finanzas debe registrar su propio
  número, aceptar el opt-in y completar la verificación por WhatsApp; después
  probar fan-out multiusuario con un grupo de prueba autorizado. No enviar a
  contactos reales sin consentimiento.
- Habilitar alertas operativas y completar el ensayo de rollback documentado.
- Confirmar que los planes/precios necesarios para suscripciones estén
  cargados y revisados antes de probar compra o activación; no cambiar precios,
  registrar pagos ni generar cargos durante la validación.
- Una vez disponible un plan habilitado, ejecutar una aceptación funcional de
  análisis de IA, PDF generado/almacenado y plantilla de Meta con PDF usando una
  planta y miembros de prueba autorizados. Las pruebas locales simuladas no
  certifican el acceso a los proveedores reales.

Hasta cerrar estos puntos, la app está publicada y saludable, pero **no debe
anunciarse como aceptación completa ni como MVP 100% listo**. Sigue el
[procedimiento de despliegue](../DEPLOY-DIGITALOCEAN.md) y la
[guía de pruebas locales](GUIA-PRUEBAS-USUARIO.md). Para pruebas aisladas usa
Docker, Supabase Local y Mailpit; nunca apuntes las pruebas locales a la base
remota ni compartas `.env.local`.
