-- ===========================================================================
-- Migración · 2026-09-04 · Factor de recuperación 0.35 → 0.20
-- ===========================================================================
-- POR QUÉ
-- La landing sostenía dos cifras de retorno a la vez (35% y 15%) sin
-- fundamento. Se unificaron en un solo modelo: 20% de reducción del MTTR por
-- notificación y despacho automatizados, que es el extremo conservador del
-- rango y solo atribuye a DowntimeOS lo que realmente acorta —la detección y
-- el despacho—, no la reparación física.
--
-- POR QUÉ ES OBLIGATORIA
-- `leads_ahorro_coherente` tenía el 0.35 escrito dentro. Los tres motores de
-- cálculo ya emiten ahorro_proyectado = perdida_anual × 0.20, así que SIN esta
-- migración la restricción rechaza cada alta de lead y el formulario de la
-- landing devuelve error en producción. Ejecútala ANTES de desplegar.
--
-- LOS REGISTROS ANTERIORES
-- Los leads capturados antes del cambio guardan un ahorro del 35% y no
-- cumplirían la restricción nueva. Reescribirlos falsearía lo que se le
-- prometió a cada prospecto en su momento, así que se conservan tal cual: la
-- restricción se crea `not valid`, lo que la aplica a las filas nuevas y a
-- cualquier actualización de las viejas, sin revalidar el histórico.
--
-- Para distinguirlos después, la vista del final expone el factor con el que
-- se calculó cada registro.
--
-- Ejecutar en Supabase → SQL Editor. Es idempotente.
-- ===========================================================================

begin;

alter table public.leads
  drop constraint if exists leads_ahorro_coherente;

alter table public.leads
  add constraint leads_ahorro_coherente
  check (abs(ahorro_proyectado - perdida_anual * 0.20) <= 1.0)
  not valid;

comment on constraint leads_ahorro_coherente on public.leads is
  'Recuperación = 20% de la pérdida anual (reducción de MTTR). NOT VALID: los leads previos al 2026-09-04 se calcularon con 35% y se conservan sin reescribir.';

-- Permite separar en los reportes los leads calculados con cada modelo.
create or replace view public.leads_por_modelo as
select
  folio,
  empresa,
  created_at,
  perdida_anual,
  ahorro_proyectado,
  case
    when perdida_anual = 0 then null
    else round((ahorro_proyectado / perdida_anual)::numeric, 4)
  end as factor_recuperacion,
  case
    when perdida_anual = 0 then 'sin_dato'
    when abs(ahorro_proyectado - perdida_anual * 0.20) <= 1.0 then 'mttr_20'
    when abs(ahorro_proyectado - perdida_anual * 0.35) <= 1.0 then 'historico_35'
    else 'otro'
  end as modelo
from public.leads;

comment on view public.leads_por_modelo is
  'Clasifica cada lead según el factor de recuperación con el que se calculó, para que los agregados no mezclen los dos modelos.';

commit;
