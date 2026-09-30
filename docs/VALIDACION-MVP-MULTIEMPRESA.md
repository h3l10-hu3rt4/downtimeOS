# Validación de DowntimeOS MVP multiempresa

## Base recomendada

Mantener **Supabase**. Es PostgreSQL administrado y ya cubre la base relacional,
Supabase Auth, Storage privado para PDF y políticas RLS. Migrar a PostgreSQL
administrado por separado no mejora el MVP y obligaría a reemplazar esas capas.

## Aplicación de la migración

1. En Supabase, abrir **SQL Editor**.
2. Ejecutar las migraciones existentes en el orden documentado en
   `supabase/ORDEN-DE-EJECUCION.md`.
3. Ejecutar `supabase/migraciones/2026-09-29-mvp-multitenant.sql`.
4. Ejecutar `supabase/migraciones/2026-09-29-operaciones-por-planta.sql`.
5. Confirmar que existen `organizaciones`, `plantas` y las columnas `planta_id`
   en las tablas operativas.

Estas dos migraciones quedaron aplicadas al proyecto Supabase vinculado de
desarrollo el 29 de septiembre de 2026. Se conservan como SQL explícito para
repetir el despliegue de forma auditada en otro entorno.

## Prueba de flujo

1. Abrir `/registro` y crear una empresa, una planta y la cuenta de Dirección.
2. Confirmar en Supabase: una organización, una planta, un perfil y cinco
   activos iniciales (`M-01` a `M-05`), todos `RUN`.
3. Iniciar sesión en `/acceso` y comprobar que Dirección abre `/direccion`.
4. Desde Dirección, invitar una cuenta de Operaciones y otra de Operador con
   `POST /api/cuenta` y `accion: "invitar"`.
5. Iniciar sesión en cada rol y comprobar que Operador reporta, Operaciones
   valida y Dirección ve el impacto y el PDF.
6. Crear una segunda empresa y confirmar que su Línea 01, máquinas, eventos,
   IA, PDFs y mensajes no aparecen para la primera.

## Integraciones

- **IA:** habilitar el interruptor de IA del panel y verificar que `POST
  /api/ia/resumen` devuelve el proveedor configurado y registra el análisis.
- **PDF:** generar un reporte de Dirección; confirmar fila en
  `planta_reportes`, objeto privado en el bucket `reportes` y URL firmada.
- **WhatsApp:** usar las plantillas aprobadas descritas en
  `docs/whatsapp-plantillas.md`. Confirmar que la respuesta `dtos:aprobar` o
  `dtos:rechazar` cambia la solicitud correspondiente sin tocar otra planta.

## Variables requeridas

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY` o
`ANTHROPIC_API_KEY`, y las variables de Meta WhatsApp ya existentes en Vercel.
Nunca colocar estas claves en `public/` o en archivos versionados.
