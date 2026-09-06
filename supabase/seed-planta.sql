-- ===========================================================================
-- DowntimeOS · Semilla de PLANTA — GENERADO AUTOMÁTICAMENTE
-- ===========================================================================
-- No edites este archivo a mano. Se deriva de public/demo/js/datos.js con:
--
--     node scripts/generar-seed-planta.js
--
-- Los eventos se siembran RELATIVOS a la fecha en que ejecutes el SQL
-- (current_date - N), así que la demo siempre se ve reciente sin volver a
-- generar nada.
--
-- Ejecutar DESPUÉS de schema-planta.sql. Es idempotente.
--
-- Generado: 2026-09-05T09:32:37.220Z
-- Líneas: 2 · Activos: 12 · Causas: 7 · Eventos: 43
-- ===========================================================================

begin;

-- --------------------------------------------------------------- líneas ---
insert into public.planta_lineas (id, nombre, descripcion, orden) values
  ('L-01', 'Línea 01 · Estructural', 'Maquinado, corte, curado y pintura', 1),
  ('L-02', 'Línea 02 · Ensamble ligero', 'Ensamble, pruebas y empaque', 2)
on conflict (id) do update
  set nombre = excluded.nombre,
      descripcion = excluded.descripcion,
      orden = excluded.orden;

-- --------------------------------------------------------------- causas ---
insert into public.planta_causas (id, etiqueta, requiere_texto, orden) values
  ('ruptura-herramental', 'Ruptura de herramental', false, 1),
  ('espera-material', 'Espera de material', false, 2),
  ('cambio-modelo', 'Cambio de modelo sin SMED', false, 3),
  ('ajuste-calidad', 'Ajuste de calidad / calibración', false, 4),
  ('falla-electrica', 'Falla eléctrica menor', false, 5),
  ('falta-operador', 'Falta de operador', false, 6),
  ('otros', 'Otros (especificar)', true, 7)
on conflict (id) do update
  set etiqueta = excluded.etiqueta,
      requiere_texto = excluded.requiere_texto,
      orden = excluded.orden;

-- -------------------------------------------------------------- activos ---
insert into public.planta_activos (id, linea_id, tipo, nombre, etapa, tarifa_hora, cuello_botella) values
  ('M-01', 'L-01', 'CM', 'Centro de maquinado 01', 'Maquinado', 2450, false),
  ('M-02', 'L-01', 'CM', 'Centro de maquinado 02', 'Maquinado', 2450, false),
  ('C-01', 'L-01', 'SR', 'Sierra de corte automatizado', 'Corte', 3900, true),
  ('H-01', 'L-01', 'HR', 'Horno de curado 01', 'Curado', 1850, false),
  ('H-02', 'L-01', 'HR', 'Horno de curado 02', 'Curado', 1850, false),
  ('H-03', 'L-01', 'HR', 'Horno de curado 03', 'Curado', 1850, false),
  ('P-01', 'L-01', 'CP', 'Cabina de pintura 01', 'Pintura', 2700, false),
  ('P-02', 'L-01', 'CP', 'Cabina de pintura 02', 'Pintura', 2700, false),
  ('E-01', 'L-02', 'ES', 'Estación de ensamble 01', 'Ensamble', 1650, false),
  ('E-02', 'L-02', 'ES', 'Estación de ensamble 02', 'Ensamble', 1650, false),
  ('R-01', 'L-02', 'BP', 'Banco de pruebas funcional', 'Pruebas', 2100, true),
  ('K-01', 'L-02', 'EM', 'Empaque y etiquetado', 'Empaque', 1200, true)
on conflict (id) do update
  set linea_id = excluded.linea_id,
      tipo = excluded.tipo,
      nombre = excluded.nombre,
      etapa = excluded.etapa,
      tarifa_hora = excluded.tarifa_hora,
      cuello_botella = excluded.cuello_botella;

-- ------------------------------------------------------ eventos de paro ---
-- El folio, la jornada, el turno, la tarifa aplicable y el costo se derivan
-- aquí mismo con las funciones del esquema: la semilla no puede discrepar del
-- resto de la base porque usa exactamente las mismas reglas.
with entradas (activo_id, causa_id, dias, hora, minutos, hash, nota) as (values
  ('E-01', 'cambio-modelo', 1, '15:25', 80, '5E', ''),
  ('C-01', 'espera-material', 1, '07:50', 40, 'LJ', ''),
  ('P-01', 'falla-electrica', 2, '13:40', 55, 'W3', ''),
  ('M-02', 'cambio-modelo', 2, '10:50', 100, 'WV', ''),
  ('K-01', 'espera-material', 2, '22:10', 85, 'R0', ''),
  ('C-01', 'ruptura-herramental', 2, '16:30', 60, '10', ''),
  ('H-02', 'ajuste-calidad', 4, '14:10', 50, 'V1', ''),
  ('R-01', 'falla-electrica', 4, '07:40', 40, '31', ''),
  ('M-01', 'cambio-modelo', 5, '15:15', 130, 'UU', ''),
  ('P-02', 'ajuste-calidad', 5, '01:25', 55, 'SP', ''),
  ('P-01', 'falta-operador', 5, '17:55', 60, 'KY', ''),
  ('K-01', 'espera-material', 6, '13:15', 110, '29', ''),
  ('H-03', 'espera-material', 7, '06:50', 160, 'ZQ', ''),
  ('E-02', 'falla-electrica', 7, '03:20', 50, 'KK', ''),
  ('M-01', 'falta-operador', 7, '23:50', 65, 'XE', ''),
  ('C-01', 'ajuste-calidad', 8, '09:05', 45, 'LM', ''),
  ('E-02', 'falta-operador', 8, '19:30', 45, '0S', ''),
  ('M-01', 'ajuste-calidad', 9, '08:45', 35, 'S7', ''),
  ('P-02', 'falla-electrica', 10, '11:25', 110, '2D', ''),
  ('H-01', 'espera-material', 10, '21:15', 200, 'P7', ''),
  ('R-01', 'ajuste-calidad', 11, '10:05', 60, 'T3', ''),
  ('M-02', 'cambio-modelo', 12, '13:20', 110, 'X7', ''),
  ('P-02', 'ajuste-calidad', 12, '20:05', 95, 'BM', ''),
  ('H-02', 'espera-material', 13, '02:40', 95, 'TP', ''),
  ('C-01', 'ruptura-herramental', 13, '20:10', 70, 'PT', ''),
  ('E-01', 'cambio-modelo', 15, '14:50', 95, 'WV', ''),
  ('R-01', 'ajuste-calidad', 15, '22:35', 70, 'KE', ''),
  ('H-02', 'falla-electrica', 16, '09:40', 65, 'YA', ''),
  ('M-01', 'falta-operador', 16, '21:40', 55, 'RP', ''),
  ('P-01', 'falla-electrica', 18, '12:30', 70, 'UK', ''),
  ('K-01', 'espera-material', 18, '08:30', 130, 'HQ', ''),
  ('M-02', 'cambio-modelo', 19, '11:00', 150, '08', ''),
  ('C-01', 'ruptura-herramental', 19, '23:15', 110, '94', ''),
  ('R-01', 'falla-electrica', 20, '11:45', 55, 'P1', ''),
  ('C-01', 'ruptura-herramental', 20, '15:40', 95, 'EC', ''),
  ('H-03', 'espera-material', 21, '19:20', 145, '8P', ''),
  ('P-02', 'falla-electrica', 22, '16:45', 85, 'B1', ''),
  ('E-02', 'falta-operador', 23, '16:20', 70, 'R1', ''),
  ('M-01', 'cambio-modelo', 24, '14:35', 90, 'KG', ''),
  ('H-01', 'espera-material', 25, '07:30', 180, 'ZJ', ''),
  ('M-02', 'cambio-modelo', 26, '10:15', 120, 'QF', ''),
  ('C-01', 'ruptura-herramental', 27, '08:20', 255, 'EH', 'Ruptura de sierra circular. Cambio de disco y realineación.'),
  ('R-01', 'ajuste-calidad', 28, '09:10', 85, 'HY', '')
), calculadas as (
  select
    e.activo_id,
    e.causa_id,
    e.minutos::numeric as minutos,
    e.nota,
    (((current_date - e.dias) + e.hora::time) at time zone public.planta_zona()) as inicio,
    e.hash
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
  'historico',
  c.nota,
  'Semilla'
from calculadas c
join public.planta_activos a on a.id = c.activo_id
on conflict (folio) do nothing;

-- ------------------------------------------------------- estado del piso ---
insert into public.planta_estados (activo_id, estado, desde, causa_id)
select
  e.activo_id,
  e.estado,
  now() - (e.desde_min || ' minutes')::interval,
  e.causa_id
from (values
  ('M-01', 'RUN', 212, null),
  ('M-02', 'RUN', 24, null),
  ('C-01', 'STOP', 74, 'ruptura-herramental'),
  ('H-01', 'RUN', 340, null),
  ('H-02', 'RUN', 188, null),
  ('H-03', 'RUN', 95, null),
  ('P-01', 'RUN', 410, null),
  ('P-02', 'RUN', 156, null),
  ('E-01', 'RUN', 265, null),
  ('E-02', 'RUN', 130, null),
  ('R-01', 'STOP', 31, 'ajuste-calidad'),
  ('K-01', 'RUN', 88, null)
) as e (activo_id, estado, desde_min, causa_id)
on conflict (activo_id) do nothing;

-- ------------------------------------------------ bandeja de solicitudes ---
insert into public.planta_solicitudes (
  folio, activo_id, causa_id, desde, reportado_por, estado, causa_validada_id, validada_en
)
select
  replace(a.linea_id, '-', '') || '-' || a.tipo || '-' || replace(a.id, '-', '') || '-' ||
    to_char((now() - (s.desde_min || ' minutes')::interval) at time zone public.planta_zona(), 'YYYYMMDD') || '-' ||
    to_char((now() - (s.desde_min || ' minutes')::interval) at time zone public.planta_zona(), 'HH24MI') || '-' || s.hash,
  s.activo_id,
  s.causa_id,
  now() - (s.desde_min || ' minutes')::interval,
  s.reportado_por,
  s.estado,
  case when s.estado = 'pendiente' then null else s.causa_id end,
  case when s.estado = 'pendiente' then null else now() - (s.desde_min || ' minutes')::interval end
from (values
  ('R-01', 'ajuste-calidad', 31, 'preaprobada', 'Helio Huerta', 'MF'),
  ('C-01', 'ruptura-herramental', 74, 'preaprobada', 'Helio Huerta', 'PA')
) as s (activo_id, causa_id, desde_min, estado, reportado_por, hash)
join public.planta_activos a on a.id = s.activo_id
on conflict (folio) do nothing;

commit;

-- ===========================================================================
-- COMPROBACIÓN — corre esto después para ver que quedó bien
-- ===========================================================================
-- select 'activos' as que, count(*) from public.planta_activos
-- union all select 'eventos', count(*) from public.planta_eventos
-- union all select 'solicitudes abiertas', count(*) from public.planta_solicitudes where not cerrada;
--
-- select * from public.planta_pareto;
-- select turno, sum(costo) from public.planta_por_turno_linea group by turno order by turno;
-- ===========================================================================
