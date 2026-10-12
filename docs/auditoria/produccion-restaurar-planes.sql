-- DowntimeOS · Producción · Restaurar el catálogo de planes (hallazgo 17 de la auditoría, 2026-10-12)
-- Proyecto de Supabase: orinpbsesgckbvmwjjfl (producción). Ejecutar en SQL Editor, un paso a la vez.
-- Los valores son los mismos de la migración supabase/migrations/20260930000200_onboarding.sql.
-- No toca empresas, usuarios, suscripciones ni pagos.

-- ─────────────────────────────────────────────────────────────────────────
-- PASO 1 · Diagnóstico (solo lectura). Ejecuta esto primero y mira el resultado.
--   · 0 filas            → faltan los planes: continúa con el paso 2.
--   · 3 filas, activo=t  → los planes sí existen; NO ejecutes el paso 2 y avísame.
--   · filas con activo=f → alguien los desactivó; NO ejecutes el paso 2 y avísame.
-- ─────────────────────────────────────────────────────────────────────────
select codigo, nombre, precio_semestral_usd, precio_anual_usd, max_activos, max_plantas, activo, funciones
from public.planes
order by precio_semestral_usd;

-- ─────────────────────────────────────────────────────────────────────────
-- PASO 2 · Crear Starter, Pro y Enterprise. Si alguno ya existe, no lo modifica.
-- ─────────────────────────────────────────────────────────────────────────
insert into public.planes
  (codigo, nombre, precio_mensual_usd, precio_semestral_usd, precio_anual_usd, max_activos, max_plantas, funciones)
values
  ('starter', 'Starter', 49, 294, 588, 5, 1,
   '{"exportacion":true}'::jsonb),
  ('pro', 'Pro', 149, 894, 1788, 20, 1,
   '{"exportacion":true,"finanzas":true,"whatsapp":true,"pdf_mensual":true,"ai_finanzas":true,"ai_operaciones":true}'::jsonb),
  ('enterprise', 'Enterprise', 299, 1794, 3588, null, null,
   '{"exportacion":true,"multiplanta":true,"erp":true,"telemetria_opcional":true,"finanzas":true,"whatsapp":true,"pdf_mensual":true,"ai_finanzas":true,"ai_operaciones":true}'::jsonb)
on conflict (codigo) do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- PASO 3 · Comprobar. Deben salir 3 filas, activo = true:
--   starter    | 294  |  588 |  5 | 1
--   pro        | 894  | 1788 | 20 | 1
--   enterprise | 1794 | 3588 |    |
-- ─────────────────────────────────────────────────────────────────────────
select codigo, nombre, precio_semestral_usd, precio_anual_usd, max_activos, max_plantas, activo
from public.planes
order by precio_semestral_usd;
