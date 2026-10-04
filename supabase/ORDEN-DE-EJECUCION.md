# Supabase · preparación local del MVP

> **Esta es la guía vigente para desarrollo local y pruebas.** La única cadena
> soportada del esquema actual es `supabase/migrations`, ejecutada por Supabase
> CLI en un proyecto local nuevo y desechable.

## Preparar un Supabase Local desechable

Desde la raíz del repositorio, con Docker Desktop activo:

```powershell
npx supabase start --workdir .
npx supabase migration list --local --workdir .
```

El primer comando inicia los servicios locales y aplica las migraciones
versionadas pendientes. El segundo solo consulta el historial; comprueba que la
cadena aplicada coincide con los archivos locales antes de probar. No publiques
claves que el CLI pueda mostrar en otros comandos.

**Importante:** `supabase start` reutiliza el volumen del proyecto si ya existe;
no lo convierte en una base vacía. No ejecutes pruebas E2E si el historial,
usuarios o datos pertenecen a una instancia existente o compartida. Detente y
prepara un proyecto/volumen local realmente desechable. Esta guía no recomienda
`supabase db reset` como método para limpiar una base.

## Ejecutar el E2E

El runner requiere una base desechable, verifica el estado antes de escribir y
crea cuentas, organizaciones, datos operativos, pagos e invitaciones sintéticas.
También deja archivos en Storage cuando corre las pruebas de comprobantes.
**No borra esos datos al terminar**, así que no se puede repetir sobre la misma
instancia. Usa:

```powershell
.\scripts\e2e-mvp-local.ps1 -SupabaseWorkdir . -ConfirmDisposableDatabase
```

Antes de ejecutar, asegúrate de que el Supabase seleccionado sea el desechable y
de que Next use la misma instancia. El preflight falla cerrado ante usuarios
Auth, organizaciones que no sean el bootstrap vacío, filas existentes en
tablas operativas/de tenant, o archivos en los buckets de comprobantes y
reportes. Lee las líneas `NO EJECUTADO` del resumen: correo/invitaciones y
aprobación administrativa pueden omitirse si Mailpit o las credenciales locales
de administración no están disponibles.

## Arrancar la app en Docker

```powershell
npm run docker:local
```

El lanzador usa el Supabase local del repositorio cuando está activo. Si solo
detecta una instancia histórica guardada en `%LOCALAPPDATA%`, se detiene; para
conectarse a ella hay que pasar conscientemente `-SupabaseWorkdir` al script.
No inicia, reinicia ni limpia bases. `-ComposeArgs` solo acepta `ps` (consulta)
o el `up -d --build` predeterminado; rechaza comandos de parada/borrado.

No uses `docker compose down -v`, `docker system prune`, `docker volume prune`
ni `supabase db reset` como comandos de diagnóstico o limpieza sobre datos que
quieras conservar. Para repetir E2E, usa infraestructura local desechable nueva
en lugar de truncar tablas.

## Archivos SQL históricos: no ejecutar

`supabase/migraciones/`, `supabase/EJECUTAR-TODO.sql`, `schema-planta.sql`,
`seed-planta.sql` y las recetas antiguas de Supabase SQL Editor pertenecen a
generaciones anteriores de la demo. No son una alternativa a
`supabase/migrations`, no instalan el MVP actual y no deben copiarse/ejecutarse
sobre una base existente.

En particular, se retiró de esta guía una receta antigua de `TRUNCATE` que
borraba cancelaciones, solicitudes, eventos y estados de planta. **No la uses.**
Aunque aquella receta dijera que no tocaba `public.leads`, sí destruía historial
operativo. Conserva los datos existentes y valida cambios de producción mediante
un proceso separado de migración, respaldo y revisión en staging.

## Contexto heredado

`public.leads` guarda prospectos de la landing; las tablas `planta_*` guardan
operación de la planta. Son dominios distintos. Las tablas de catálogo global
que las migraciones actuales preparan no representan datos de una empresa y por
eso el preflight E2E permite su contenido de referencia; valida por separado
las tablas tenant y los buckets con archivos.
