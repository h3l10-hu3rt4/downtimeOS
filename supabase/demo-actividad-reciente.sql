-- ###########################################################################
-- DowntimeOS · PREPARAR LA DEMO: DURACIONES REALISTAS + ACTIVIDAD RECIENTE
-- ###########################################################################
--
-- CÓMO SE USA
--   Supabase → SQL Editor → pega TODO este archivo → Run.
--   Es idempotente: correrlo dos veces el mismo día no duplica ni vuelve a
--   recortar nada. Se puede repetir antes de cada presentación.
--
-- PARTE 1 · Duraciones realistas
--   Las pruebas de septiembre dejaron paros de 17 a 70 horas (paros abiertos
--   durante días antes de cerrarse). Un solo evento de C-01 valía $1.1 M y
--   aplastaba las gráficas de Dirección. Todo paro de más de 5 h que NO sea del
--   histórico sembrado se lleva a 45–240 min con una curva que conserva el
--   orden (el más largo sigue siendo el más largo). El costo se recalcula con la
--   tarifa congelada de cada evento, igual que hace `editarEvento()` en la API.
--   Antes de tocar nada, se respalda en `planta_eventos_respaldo_duraciones`.
--
-- PARTE 2 · Actividad reciente
--   El histórico se sembró con fechas fijas y envejece: semanas después, «Hoy»
--   y «7 días» caen a cero. Se agregan 12 paros en las últimas 7 JORNADAS
--   productivas (incluida la de hoy), para que 30 días / 7 días / Hoy den
--   cifras distintas y coherentes. Nunca crea paros en el futuro.
--   Costo, tarifa, jornada y turno los calcula la base con las mismas funciones
--   que usa la API.
--
-- PARA DESHACER
--   Parte 1:
--     update public.planta_eventos e
--        set minutos = r.minutos, costo_mxn = r.costo_mxn
--       from public.planta_eventos_respaldo_duraciones r
--      where r.folio = e.folio;
--   Parte 2:
--     delete from public.planta_eventos
--      where registrado_por = 'Actividad reciente (demo)';
-- ###########################################################################


-- ======================================================= PARTE 1 · respaldo
create table if not exists public.planta_eventos_respaldo_duraciones as
  select folio, minutos, costo_mxn, now() as respaldado_en
    from public.planta_eventos
   where minutos > 300 and origen <> 'historico';
-- Mismo criterio que el resto de las tablas: sin políticas, solo service_role.
alter table public.planta_eventos_respaldo_duraciones enable row level security;

-- ================================================ PARTE 1 · normalización
with nuevos as (
  select folio, tarifa_aplicada,
         round(least(240, greatest(45, sqrt(minutos) * 4)))::numeric as minutos
    from public.planta_eventos
   where minutos > 300 and origen <> 'historico'
)
update public.planta_eventos e
   set minutos   = n.minutos,
       costo_mxn = round((n.minutos / 60.0) * n.tarifa_aplicada, 2)
  from nuevos n
 where n.folio = e.folio;


-- ======================================== PARTE 2 · actividad reciente
-- `dias` = jornadas hacia atrás desde la jornada productiva actual (0 = hoy).
with entradas (activo_id, causa_id, minutos, dias, hora, hash, nota) as (values
  ('M-02', 'espera-material',     18, 0, '07:50', 'R1', 'Material de corte tardó en surtirse.'),
  ('H-01', 'ajuste-calidad',      24, 0, '11:15', 'R2', 'Ajuste de temperatura del horno.'),
  ('E-02', 'falta-operador',      15, 0, '15:20', 'R3', 'Operador cubriendo otra estación.'),
  ('C-01', 'ruptura-herramental', 38, 1, '08:40', 'R4', 'Cambio de disco de corte.'),
  ('R-01', 'ajuste-calidad',      27, 1, '16:45', 'R5', 'Recalibración del banco de pruebas.'),
  ('P-01', 'cambio-modelo',       42, 2, '10:05', 'R6', 'Cambio de color sin preparación.'),
  ('M-01', 'falla-electrica',     21, 3, '11:30', 'R7', 'Disparo de protección térmica.'),
  ('K-01', 'cambio-modelo',       19, 3, '18:55', 'R8', 'Cambio de etiqueta por pedido.'),
  ('H-02', 'espera-material',     33, 4, '08:10', 'R9', 'Espera de piezas del maquinado.'),
  ('C-01', 'espera-material',     26, 5, '13:40', 'RA', 'Sin barra en el almacén de línea.'),
  ('E-01', 'ajuste-calidad',      22, 5, '07:25', 'RB', 'Torque fuera de especificación.'),
  ('P-02', 'falla-electrica',     31, 6, '20:10', 'RC', 'Falla en extractor de cabina.')
),
calculadas as (
  select
    e.activo_id, e.causa_id, e.minutos::numeric as minutos, e.nota, e.hash,
    -- Base = jornada productiva actual en hora de la planta (no la fecha UTC).
    (((public.planta_jornada(now()) - e.dias) + e.hora::time)
      at time zone public.planta_zona()) as inicio
  from entradas e
)
insert into public.planta_eventos (
  folio, activo_id, causa_id, minutos, inicio, jornada, turno,
  retroactivo, tarifa_aplicada, costo_mxn, origen, nota, registrado_por
)
select
  replace(a.linea_id, '-', '') || '-' || a.tipo || '-' || replace(a.id, '-', '') || '-' ||
    to_char(c.inicio at time zone public.planta_zona(), 'YYYYMMDD') || '-' ||
    to_char(c.inicio at time zone public.planta_zona(), 'HH24MI') || '-' || c.hash,
  c.activo_id,
  c.causa_id,
  c.minutos,
  c.inicio,
  public.planta_jornada(c.inicio),
  public.planta_turno(c.inicio),
  false,
  public.planta_tarifa_aplicable(c.activo_id),
  round((c.minutos / 60.0) * public.planta_tarifa_aplicable(c.activo_id), 2),
  'demo',
  c.nota,
  'Actividad reciente (demo)'
from calculadas c
join public.planta_activos a on a.id = c.activo_id
where c.inicio <= now()
on conflict (folio) do nothing;


-- ================================================================ COMPROBACIÓN
-- Deben salir tres cifras claramente distintas, de menor a mayor.
select 'Hoy'     as periodo, count(*) as paros, round(sum(costo_mxn)) as costo_mxn
  from public.planta_eventos where jornada  = public.planta_jornada(now())
union all
select '7 días',  count(*), round(sum(costo_mxn))
  from public.planta_eventos where jornada >= public.planta_jornada(now()) - 6
union all
select '30 días', count(*), round(sum(costo_mxn))
  from public.planta_eventos where jornada >= public.planta_jornada(now()) - 29;
