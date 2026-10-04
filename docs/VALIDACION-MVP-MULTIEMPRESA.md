# Validación de DowntimeOS MVP multiempresa

## Base recomendada

Mantener **Supabase**. Es PostgreSQL administrado y ya cubre la base relacional,
Supabase Auth, Storage privado para PDF y políticas RLS. Migrar a PostgreSQL
administrado por separado no mejora el MVP y obligaría a reemplazar esas capas.

## Aplicación de migraciones

No ejecutes SQL histórico desde Supabase Studio ni sigas una lista manual de
migraciones de versiones anteriores. La única cadena vigente es
`supabase/migrations`, administrada por Supabase CLI. Para levantar y verificar
un entorno local nuevo o ya identificado, sigue
[`supabase/ORDEN-DE-EJECUCION.md`](../supabase/ORDEN-DE-EJECUCION.md) y
[`docs/GUIA-PRUEBAS-USUARIO.md`](GUIA-PRUEBAS-USUARIO.md). No uses `db reset` ni
apliques estas instrucciones sobre una base compartida o de producción.

## Prueba de flujo

1. Seguir la guía de pruebas de usuario para registrar una empresa, confirmar
   el correo en Mailpit y configurar explícitamente su primera planta. El
   registro no debe describirse como si sembrara automáticamente cinco
   máquinas: la estructura se captura durante la configuración.
2. Invitar usuarios desde **Equipo**, aceptar cada invitación en Mailpit y
   comprobar el acceso de Dirección, Finanzas, Operaciones y Operador según sus
   permisos.
3. Enviar una solicitud de suscripción semestral o anual y, solo en una base
   local de pruebas, aprobar un piloto desde Administración. Los tableros y
   varias mutaciones requieren un plan vigente.
4. Registrar y revisar paros, y verificar en cada rol los datos y acciones
   permitidos. Crear otra organización de prueba y comprobar el aislamiento
   entre organizaciones y plantas.
5. Para una validación automatizada completa, usa el runner E2E desechable
   descrito en `supabase/ORDEN-DE-EJECUCION.md`; no lo ejecutes sobre la base
   local persistente que contiene datos de trabajo.

## Integraciones

- **IA:** habilitar el proveedor explícitamente en Docker solo si se acepta que
  los datos del análisis se envíen a ese proveedor y se use su cuota.
- **PDF:** generar un reporte con datos sintéticos y comprobar que el archivo
  se sirve desde el almacenamiento privado mediante una URL firmada.
- **WhatsApp:** mantener desactivado durante pruebas normales. Solo habilitar
  Meta/Twilio de forma explícita cuando se autorice el envío de mensajes reales
  a los destinatarios configurados; las plantillas están documentadas en
  `docs/whatsapp-plantillas.md`.

## Variables requeridas

Para ejecución local, `scripts/docker-local.ps1` obtiene las credenciales
efímeras de Supabase Local; no copies claves remotas de `.env.local` a Docker.
IA y mensajería son opcionales y requieren habilitación explícita. Nunca pongas
claves privadas en `public/` ni las subas al repositorio.

## Evidencia reciente — 4 de octubre de 2026

La validación automatizada se ejecutó contra una instancia Supabase Local
temporal y desechable, separada de la base de desarrollo; la pila y sus datos
sintéticos se retiraron al terminar. Resultado:

- `npm test`: 468 pruebas aprobadas; `npm run build`: compilación correcta;
  `npm audit`: 0 vulnerabilidades; `npm run smoke`: 20 rutas, 10 pantallas con
  estilos y 26 comprobaciones de rechazo de APIs sin sesión.
- E2E real con dos organizaciones: confirmación y recuperación por Mailpit,
  aislamiento multiempresa, invitaciones aceptadas para Dirección, Finanzas,
  Operaciones y Operador, permisos positivos/negativos, solicitud y cancelación
  de pago, comprobante privado, aprobación administrativa, renovación y límites
  de plan.
- E2E operativo: registro y cierre atómicos de paros, idempotencia, descarte de
  falsos positivos, privacidad financiera y 64 ciclos concurrentes sin colisión
  de folios.
- UI en Edge: acceso, registro, recuperación, activación, Equipo, Suscripción y
  tableros por rol; las vistas móviles de acceso, registro y recuperación pasan
  a 390 px sin desbordamiento horizontal.

No cubrió carga de 10k/100k registros, el paso futuro de una renovación por
calendario ni proveedores externos reales de IA, WhatsApp o correo SMTP. Esta
evidencia valida el MVP en local; no convierte el dominio público en un entorno
de prueba: las rutas de producto en `downtimeos.tech` aún requieren un deploy
de staging/producción antes de probarse allí.
