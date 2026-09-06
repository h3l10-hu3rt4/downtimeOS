-- ###########################################################################
-- DowntimeOS · EJECUTAR TODO EN SUPABASE
-- ###########################################################################
--
--   COMO SE USA
--   1. Selecciona TODO este archivo (Ctrl+A) y copialo (Ctrl+C).
--   2. Pegalo en Supabase -> SQL Editor.
--   3. Pulsa Run.
--
--   Son los tres archivos de supabase/ concatenados en el orden correcto.
--   Todo es idempotente: si ya corriste alguna parte, volver a ejecutarlo no
--   rompe nada ni duplica datos.
--
--   Al terminar, corre la comprobacion que esta al final del archivo.
--
--   GENERADO AUTOMATICAMENTE — no lo edites. Se rehace con:
--       node scripts/generar-sql-completo.js
-- ###########################################################################


-- ###########################################################################
-- PASO 1 de 3 — Ordena lo viejo: factor de recuperacion 0.35 -> 0.20
-- ###########################################################################

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


-- ###########################################################################
-- PASO 2 de 3 — Crea el esquema de PLANTA (tablas planta_*)
-- ###########################################################################

-- ===========================================================================
-- DowntimeOS · Esquema de PLANTA
-- ===========================================================================
-- Este archivo crea lo que hasta ahora vivía solo en el navegador: activos,
-- líneas, causas, eventos de paro, estado vivo del piso y la bandeja de
-- solicitudes de Mantenimiento.
--
-- CONVIVE con `schema.sql`, que es otra cosa: aquel guarda PROSPECTOS de la
-- landing (`public.leads`); este guarda la OPERACIÓN de una planta. No se
-- tocan entre sí y ninguno sustituye al otro.
--
-- Todo lo de aquí lleva el prefijo `planta_` justamente para que la distinción
-- sea evidente al leer cualquier consulta.
--
-- ORDEN DE EJECUCIÓN
--   1. schema-planta.sql   (este archivo)
--   2. seed-planta.sql     (los 12 activos y el histórico de paros)
--
-- Es idempotente: se puede volver a ejecutar sin romper nada.
-- ===========================================================================

begin;

-- ===========================================================================
-- ZONA HORARIA — decisión que hay que tomar explícitamente
-- ===========================================================================
-- Los turnos se definen por hora local de la planta, no en UTC. Si estas
-- funciones usaran la zona de la sesión, el mismo paro caería en un turno
-- distinto según desde dónde se consulte, y el Pareto por turno dejaría de
-- ser reproducible. Se fija la zona de la planta de forma explícita.
--
-- Para una planta en otro huso: cambia esta constante y vuelve a ejecutar el
-- archivo. Para operación multi-sede real, esto pasaría a ser una columna de
-- una tabla `plantas`.
-- ===========================================================================
create or replace function public.planta_zona()
returns text language sql immutable as $$
  select 'America/Mexico_City'
$$;

-- ---------------------------------------------------------------------------
-- Turno de un instante. T1 06:00–14:00 · T2 14:00–22:00 · T3 22:00–06:00
-- ---------------------------------------------------------------------------
create or replace function public.planta_turno(p_inicio timestamptz)
returns text language sql immutable as $$
  select case
    when extract(hour from (p_inicio at time zone public.planta_zona())) >= 6
     and extract(hour from (p_inicio at time zone public.planta_zona())) < 14 then 'T1'
    when extract(hour from (p_inicio at time zone public.planta_zona())) >= 14
     and extract(hour from (p_inicio at time zone public.planta_zona())) < 22 then 'T2'
    else 'T3'
  end
$$;

-- ---------------------------------------------------------------------------
-- JORNADA PRODUCTIVA
-- El turno 3 cruza la medianoche, así que un paro de las 02:00 del día 5
-- pertenece a la jornada del día 4. Sin esta corrección, cualquier filtro por
-- fechas partiría en dos cada turno nocturno.
-- ---------------------------------------------------------------------------
create or replace function public.planta_jornada(p_inicio timestamptz)
returns date language sql immutable as $$
  select case
    when extract(hour from (p_inicio at time zone public.planta_zona())) < 6
      then (p_inicio at time zone public.planta_zona())::date - 1
    else (p_inicio at time zone public.planta_zona())::date
  end
$$;

-- ===========================================================================
-- CATÁLOGOS
-- ===========================================================================
create table if not exists public.planta_lineas (
  id           text primary key,                       -- 'L-01'
  nombre       text not null,
  descripcion  text not null default '',
  orden        smallint not null default 0,
  activa       boolean not null default true,
  created_at   timestamptz not null default now(),

  constraint planta_lineas_id_formato check (id ~ '^L-[0-9]{2}$')
);

create table if not exists public.planta_causas (
  id             text primary key,                     -- 'ruptura-herramental'
  etiqueta       text not null,
  -- `requiere_texto` marca la causa «Otros»: obliga a escribir el motivo, así
  -- que el catálogo cerrado sigue siendo agrupable en el Pareto en lugar de
  -- convertirse en un cajón de sastre.
  requiere_texto boolean not null default false,
  orden          smallint not null default 0,
  activa         boolean not null default true
);

create table if not exists public.planta_activos (
  id             text primary key,                     -- 'C-01'
  linea_id       text not null references public.planta_lineas(id) on delete restrict,
  tipo           text not null,                        -- 'SR', 'CM', 'HR'...
  nombre         text not null,
  etapa          text not null,
  tarifa_hora    numeric(12,2) not null,
  -- Una etapa con un solo activo es cuello de botella. Los activos de la misma
  -- etapa son paralelos y equivalentes; ver `planta_factor_capacidad`.
  cuello_botella boolean not null default false,
  activo         boolean not null default true,
  created_at     timestamptz not null default now(),

  constraint planta_activos_id_formato  check (id ~ '^[A-Z]-[0-9]{2}$'),
  constraint planta_activos_tipo_formato check (tipo ~ '^[A-Z]{2}$'),
  constraint planta_activos_tarifa_rango check (tarifa_hora between 1 and 1000000)
);

create index if not exists planta_activos_linea_idx on public.planta_activos (linea_id);

-- ---------------------------------------------------------------------------
-- Tarifa que se aplica a un paro. Es la regla de negocio más importante del
-- costeo y vive AQUÍ, en la base, para que ninguna capa pueda calcularla
-- distinto por su cuenta.
-- ---------------------------------------------------------------------------
create or replace function public.planta_factor_capacidad(p_activo text)
returns numeric language sql stable as $$
  select coalesce(1.0 / nullif(count(*) filter (where par.activo), 0), 0)
  from public.planta_activos objetivo
  join public.planta_activos par
    on par.linea_id = objetivo.linea_id and par.etapa = objetivo.etapa
 where objetivo.id = p_activo
$$;

create or replace function public.planta_tarifa_aplicable(p_activo text)
returns numeric language sql stable as $$
  select coalesce((
    select sum(linea.tarifa_hora) from public.planta_activos linea
     where linea.linea_id = activo.linea_id and linea.activo
  ), 0) * public.planta_factor_capacidad(p_activo)
  from public.planta_activos activo
 where activo.id = p_activo
$$;

-- ===========================================================================
-- ESTADO VIVO DEL PISO
-- ===========================================================================
-- Un activo solo puede estar operando o detenido. "Setup" NO es un estado: es
-- la acción de capturar un paro que ya terminó, y produce un evento, no un
-- cambio de estado.
-- ===========================================================================
create table if not exists public.planta_estados (
  activo_id      text primary key references public.planta_activos(id) on delete cascade,
  estado         text not null,
  -- `desde` es la marca de tiempo real del cambio. Al deshacer el cierre de un
  -- paro se restaura la marca ORIGINAL, no `now()`: reiniciarla haría aparecer
  -- el paro más corto de lo que fue, que es justo el dato que medimos.
  desde          timestamptz not null default now(),
  causa_id       text references public.planta_causas(id),
  causa_libre    text,
  actualizado_en timestamptz not null default now(),

  constraint planta_estados_valido check (estado in ('RUN', 'STOP')),
  constraint planta_estados_causa_en_paro check (
    estado = 'RUN' and causa_id is null
    or estado = 'STOP'
  )
);

-- ===========================================================================
-- EVENTOS DE PARO (bitácora)
-- ===========================================================================
create table if not exists public.planta_eventos (
  folio          text primary key,          -- L01-SR-C01-20260904-1425-A1
  activo_id      text not null references public.planta_activos(id) on delete restrict,
  causa_id       text not null references public.planta_causas(id)  on delete restrict,
  causa_libre    text,
  minutos        numeric(8,2) not null,
  inicio         timestamptz  not null,
  -- Jornada y turno se derivan del inicio y se GUARDAN, no se calculan al
  -- consultar: así un cambio futuro en el horario de turnos no reescribe la
  -- historia ya registrada.
  jornada        date not null,
  turno          text not null,
  retroactivo    boolean not null default false,
  -- Se congela la tarifa del momento junto al costo, igual que en `leads`: si
  -- mañana sube el costo hora-máquina, lo ya ocurrido no cambia de precio.
  tarifa_aplicada numeric(12,2) not null,
  costo_mxn      numeric(16,2) not null,
  origen         text not null default 'demo',
  nota           text not null default '',
  registrado_por text not null default '',
  created_at     timestamptz not null default now(),

  constraint planta_eventos_folio_formato check (
    folio ~ '^L[0-9]{2}-[A-Z]{2}-[A-Z][0-9]{2}-[0-9]{8}-[0-9]{4}-[0-9A-Z]{2}$'
  ),
  constraint planta_eventos_minutos_rango check (minutos > 0 and minutos <= 4320),
  constraint planta_eventos_turno_valido  check (turno in ('T1', 'T2', 'T3')),
  constraint planta_eventos_origen_valido check (origen in ('historico', 'demo', 'piso', 'mantenimiento')),
  constraint planta_eventos_costo_no_negativo check (costo_mxn >= 0),
  -- Red de seguridad aritmética: aunque una versión futura de la API traiga un
  -- bug, la base rechaza un costo que no cierre contra minutos y tarifa.
  constraint planta_eventos_costo_coherente check (
    abs(costo_mxn - (minutos / 60.0) * tarifa_aplicada) <= 1.0
  )
);

create index if not exists planta_eventos_inicio_idx  on public.planta_eventos (inicio desc);
create index if not exists planta_eventos_jornada_idx on public.planta_eventos (jornada desc, turno);
create index if not exists planta_eventos_activo_idx  on public.planta_eventos (activo_id);
create index if not exists planta_eventos_causa_idx   on public.planta_eventos (causa_id);

-- ===========================================================================
-- BANDEJA DE SOLICITUDES DE PARO
-- ===========================================================================
create table if not exists public.planta_solicitudes (
  folio             text primary key,
  activo_id         text not null references public.planta_activos(id) on delete restrict,
  causa_id          text not null references public.planta_causas(id)  on delete restrict,
  causa_libre       text,
  -- ⚠️ REGLA CRÍTICA: `desde` es el instante en que el OPERADOR reportó el
  -- paro. El cronómetro y la pérdida se calculan siempre contra esta columna,
  -- NUNCA contra `validada_en`. Validar solo oficializa la causa raíz. Si el
  -- reloj esperara a la validación, la planta perdería tiempo auditable justo
  -- en los paros peor atendidos, que son los que más importa medir.
  desde             timestamptz not null,
  reportado_por     text not null default '',
  estado            text not null default 'pendiente',
  causa_validada_id text references public.planta_causas(id),
  validada_en       timestamptz,
  resuelta_por      text not null default '',
  cerrada           boolean not null default false,
  created_at        timestamptz not null default now(),

  constraint planta_solicitudes_estado_valido check (
    estado in ('preaprobada', 'pendiente', 'aprobada', 'rechazada')
  ),
  -- Una solicitud resuelta tiene que decir cuándo y con qué causa.
  constraint planta_solicitudes_resolucion_coherente check (
    estado = 'pendiente' and validada_en is null
    or estado <> 'pendiente' and validada_en is not null and causa_validada_id is not null
  )
);

create index if not exists planta_solicitudes_abiertas_idx
  on public.planta_solicitudes (estado, desde desc) where not cerrada;

-- ===========================================================================
-- CANCELACIONES (soft delete)
-- ===========================================================================
-- Cuando alguien borra un registro mal capturado, el evento sale de la
-- operación pero queda su rastro aquí. Una cancelación sin huella es
-- indistinguible de un dato que nunca existió.
-- ===========================================================================
create table if not exists public.planta_cancelaciones (
  id            bigserial primary key,
  folio_evento  text not null,
  activo_id     text not null,
  causa_id      text,
  minutos       numeric(8,2),
  inicio        timestamptz,
  motivo        text not null default '',
  cancelado_por text not null default '',
  cancelado_en  timestamptz not null default now()
);

create index if not exists planta_cancelaciones_fecha_idx
  on public.planta_cancelaciones (cancelado_en desc);

-- ===========================================================================
-- VISTAS DE ANÁLISIS
-- ===========================================================================

-- Bitácora enriquecida: lo que consumen los tres tableros.
create or replace view public.planta_bitacora as
select
  e.folio,
  e.activo_id,
  a.linea_id,
  a.nombre        as activo_nombre,
  a.etapa,
  a.cuello_botella,
  e.causa_id,
  c.etiqueta      as causa_etiqueta,
  e.causa_libre,
  case when c.requiere_texto and e.causa_libre is not null
       then e.causa_libre || ' (otros)'
       else c.etiqueta end as causa_mostrada,
  e.minutos,
  e.inicio,
  e.jornada,
  e.turno,
  e.retroactivo,
  e.tarifa_aplicada,
  e.costo_mxn,
  e.origen,
  e.registrado_por,
  e.created_at
from public.planta_eventos e
join public.planta_activos a on a.id = e.activo_id
join public.planta_causas  c on c.id = e.causa_id;

-- Pareto por causa. El acumulado se calcula en la base para que los tres
-- tableros no puedan discrepar en el corte del 80%.
create or replace view public.planta_pareto as
with por_causa as (
  select
    e.causa_id,
    c.etiqueta,
    count(*)          as eventos,
    sum(e.minutos)    as minutos,
    sum(e.costo_mxn)  as costo
  from public.planta_eventos e
  join public.planta_causas c on c.id = e.causa_id
  group by e.causa_id, c.etiqueta
)
select
  causa_id,
  etiqueta,
  eventos,
  minutos,
  costo,
  round(100 * costo / nullif(sum(costo) over (), 0), 2) as porcentaje,
  round(100 * sum(costo) over (order by costo desc rows unbounded preceding)
            / nullif(sum(costo) over (), 0), 2)          as acumulado
from por_causa
order by costo desc;

-- Impacto por activo.
create or replace view public.planta_por_activo as
select
  e.activo_id,
  a.linea_id,
  a.nombre,
  a.cuello_botella,
  count(*)         as eventos,
  sum(e.minutos)   as minutos,
  sum(e.costo_mxn) as costo
from public.planta_eventos e
join public.planta_activos a on a.id = e.activo_id
group by e.activo_id, a.linea_id, a.nombre, a.cuello_botella
order by sum(e.costo_mxn) desc;

-- Matriz turno × línea, que alimenta las barras verticales de Dirección.
create or replace view public.planta_por_turno_linea as
select
  e.turno,
  a.linea_id,
  count(*)         as eventos,
  sum(e.minutos)   as minutos,
  sum(e.costo_mxn) as costo
from public.planta_eventos e
join public.planta_activos a on a.id = e.activo_id
group by e.turno, a.linea_id
order by e.turno, a.linea_id;

-- ---------------------------------------------------------------------------
-- AUDITORÍA DE COSTEO
-- Recalcula cada evento con las tarifas VIGENTES y lo compara con el costo
-- congelado. Sirve para responder «¿cuánto de la diferencia contra el mes
-- pasado es operación y cuánto es que cambiamos las tarifas?».
-- ---------------------------------------------------------------------------
create or replace view public.planta_auditoria_costeo as
select
  e.folio,
  e.activo_id,
  e.inicio,
  e.tarifa_aplicada                                  as tarifa_congelada,
  public.planta_tarifa_aplicable(e.activo_id)        as tarifa_vigente,
  e.costo_mxn                                        as costo_congelado,
  round((e.minutos / 60.0) * public.planta_tarifa_aplicable(e.activo_id), 2) as costo_recalculado,
  round((e.minutos / 60.0) * public.planta_tarifa_aplicable(e.activo_id) - e.costo_mxn, 2) as diferencia
from public.planta_eventos e
where public.planta_tarifa_aplicable(e.activo_id) is distinct from e.tarifa_aplicada;

-- ===========================================================================
-- SEGURIDAD (RLS)
-- ===========================================================================
-- Mismo criterio que `public.leads`: se habilita RLS y NO se crea ninguna
-- política, de modo que las llaves públicas (anon / authenticated) no pueden
-- leer ni escribir nada. Las funciones serverless usan la service_role, que
-- omite RLS por diseño y solo vive en variables de entorno del servidor.
--
-- 👉 CUANDO ENTRE SUPABASE AUTH, este es el punto donde el blindaje por rol
--    deja de ser una redirección de JavaScript y pasa a ser real. El esqueleto
--    de políticas está comentado al final de este archivo.
-- ===========================================================================
alter table public.planta_lineas        enable row level security;
alter table public.planta_causas        enable row level security;
alter table public.planta_activos       enable row level security;
alter table public.planta_estados       enable row level security;
alter table public.planta_eventos       enable row level security;
alter table public.planta_solicitudes   enable row level security;
alter table public.planta_cancelaciones enable row level security;

comment on table public.planta_activos is
  'Activos de la planta. `tarifa_hora` es información financiera: en el modelo de permisos, el perfil de piso NO debe poder leer esta columna.';
comment on column public.planta_solicitudes.desde is
  'Instante del REPORTE del operador. El cronómetro y la pérdida se calculan contra esta columna, nunca contra validada_en.';
comment on column public.planta_eventos.tarifa_aplicada is
  'Tarifa congelada al momento del registro. Si el activo es cuello de botella, es la suma de las tarifas de su línea.';

commit;

-- ===========================================================================
-- ESQUELETO DE POLÍTICAS PARA CUANDO ENTRE SUPABASE AUTH
-- ===========================================================================
-- Descomentar SOLO cuando exista una tabla de perfiles con el rol de cada
-- usuario. Mientras tanto, todo pasa por la service_role en el servidor.
--
-- create table public.planta_perfiles (
--   user_id uuid primary key references auth.users(id) on delete cascade,
--   rol     text not null check (rol in ('direccion','operaciones','operador'))
-- );
--
-- create or replace function public.rol_actual() returns text
--   language sql stable as $$
--     select rol from public.planta_perfiles where user_id = auth.uid()
--   $$;
--
-- -- Los tres roles leen la bitácora...
-- create policy "todos leen eventos" on public.planta_eventos
--   for select to authenticated using (public.rol_actual() is not null);
--
-- -- ...pero SOLO dirección lee las tarifas. Esta es la política que convierte
-- -- el blindaje de la demo en algo real: el operador no puede leer el costo ni
-- -- consultando la API directamente.
-- create policy "solo direccion lee tarifas" on public.planta_activos
--   for select to authenticated using (
--     public.rol_actual() = 'direccion'
--   );
-- -- (para los otros roles se expondría una vista sin las columnas de dinero)
-- ===========================================================================


-- ###########################################################################
-- PASO 3 de 3 — Siembra la planta de demostracion
-- ###########################################################################

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


-- ###########################################################################
-- COMPROBACION — corre esto despues y revisa los numeros
-- ###########################################################################
-- Esperado: 2 lineas · 12 activos · 7 causas · 43 eventos · 2 solicitudes
select 'lineas'      as que, count(*) as cuantos from public.planta_lineas
union all select 'activos',      count(*) from public.planta_activos
union all select 'causas',       count(*) from public.planta_causas
union all select 'eventos',      count(*) from public.planta_eventos
union all select 'solicitudes',  count(*) from public.planta_solicitudes
union all select 'leads (viejo)', count(*) from public.leads
order by 1;
