-- =============================================================================
-- DowntimeOS · Esquema de la tabla `leads` para Supabase (PostgreSQL)
-- =============================================================================
-- Migración de la Capa 3 local (data/leads.json) a Postgres.
-- Ejecutar en: Supabase Dashboard → SQL Editor → New query → Run.
--
-- Criterio de diseño: las invariantes ESTRUCTURALES viven en la base (rangos,
-- enums, formatos, coherencia origen/estatus) para que ninguna versión futura
-- de la API pueda escribir un registro incoherente. Las reglas de NEGOCIO que
-- cambian seguido (la lista de dominios B2B bloqueados) se quedan en la capa
-- de aplicación, igual que en server/validacion.py.
-- =============================================================================

-- gen_random_uuid(). En Supabase suele venir instalada; se declara por si acaso.
create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Folio legible: conserva el formato del prototipo local (LEAD-2026-0001).
-- La PK real es un uuid; el folio es la identidad que ve el usuario y la que
-- devuelve la API como `id` para no tocar public/js/app.js.
-- -----------------------------------------------------------------------------
create sequence if not exists public.leads_folio_seq as bigint start 1;

create table if not exists public.leads (
  id                  uuid primary key default gen_random_uuid(),

  folio               text not null unique
                        default 'LEAD-'
                              || to_char(now() at time zone 'utc', 'YYYY')
                              || '-'
                              || lpad(nextval('public.leads_folio_seq')::text, 4, '0'),

  -- --- Identificación del lead ---------------------------------------------
  nombre              text not null,
  puesto              text not null default 'No especificado',
  empresa             text not null,
  sector              text not null default '',
  email               text not null,
  -- Columna derivada: habilita analítica por dominio e índices sin recalcular.
  dominio_email       text generated always as (lower(split_part(email, '@', 2))) stored,
  telefono            text not null,
  ciudad              text not null default '',
  parque_industrial   text not null default '',

  -- --- Parámetros de la calculadora (PRD §4.2) ------------------------------
  maquinas            smallint      not null,
  turnos              smallint      not null,
  -- Derivada: turnos × 8 h. No se inserta, la calcula Postgres.
  horas_operacion_dia smallint generated always as (turnos * 8) stored,
  tarifa_hora         numeric(12,2) not null,
  minutos_paro_dia    numeric(6,2)  not null,
  divisa              text          not null,

  -- --- Resultado financiero (PRD §4.3) --------------------------------------
  -- Lo escribe la API tras RECALCULAR; nunca se confía en el cliente.
  perdida_diaria      numeric(16,2) not null,
  perdida_mensual     numeric(16,2) not null,
  perdida_anual       numeric(16,2) not null,
  ahorro_proyectado   numeric(16,2) not null,
  -- Se persiste en lugar de derivarse: congela el tipo de cambio vigente al
  -- momento de la captura. Una columna generada quedaría atada a un FX fijo.
  perdida_anual_mxn   numeric(16,2) not null,
  costo_por_minuto    numeric(16,4) not null,

  -- --- Clasificación y trazabilidad -----------------------------------------
  origen              text not null,
  estatus             text not null,
  utm                 jsonb not null default '{}'::jsonb,
  notas               text  not null default '',

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- === Invariantes ===========================================================
  constraint leads_nombre_largo    check (char_length(nombre)  between 3 and 160),
  constraint leads_empresa_largo   check (char_length(empresa) between 2 and 160),
  constraint leads_notas_largo     check (char_length(notas)   <= 500),

  -- Espejo de validacion.RE_EMAIL
  constraint leads_email_formato   check (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
  -- Espejo de validacion.normalizar_telefono: se guarda ya normalizado
  constraint leads_telefono_10     check (telefono ~ '^[0-9]{10}$'),

  -- Espejo de calculo.LIMITES
  constraint leads_maquinas_rango  check (maquinas         between 1 and 100),
  constraint leads_turnos_rango    check (turnos           between 1 and 3),
  constraint leads_minutos_rango   check (minutos_paro_dia between 5 and 120),

  constraint leads_divisa_valida   check (divisa  in ('MXN', 'USD')),
  constraint leads_origen_valido   check (origen  in ('CALCULADORA', 'AUDITORIA')),
  constraint leads_estatus_valido  check (estatus in ('NUEVO', 'AUDITORIA_SOLICITADA')),

  -- Espejo de calculo.LIMITES_TARIFA: el rango depende de la divisa.
  constraint leads_tarifa_segun_divisa check (
       (divisa = 'MXN' and tarifa_hora between 100 and 200000)
    or (divisa = 'USD' and tarifa_hora between 5   and 12000)
  ),

  -- El estatus se deriva del formulario de origen; no pueden contradecirse.
  constraint leads_estatus_coherente check (
       (origen = 'AUDITORIA'   and estatus = 'AUDITORIA_SOLICITADA')
    or (origen = 'CALCULADORA' and estatus = 'NUEVO')
  ),

  -- El formulario de cierre exige ubicación de planta.
  constraint leads_ciudad_en_auditoria check (
    origen <> 'AUDITORIA' or char_length(ciudad) > 0
  ),

  constraint leads_montos_no_negativos check (
    perdida_diaria >= 0 and perdida_mensual   >= 0 and perdida_anual     >= 0
    and ahorro_proyectado >= 0 and perdida_anual_mxn >= 0 and costo_por_minuto >= 0
  ),

  -- Red de seguridad aritmética: aunque una versión futura de la API traiga un
  -- bug, la base rechaza cifras que no cierren entre sí. La tolerancia absorbe
  -- el redondeo a 2 decimales de cada escalón.
  constraint leads_anual_coherente check (
    abs(perdida_anual - perdida_mensual * 12) <= 1.0
  ),
  -- El factor de recuperacion es 0.20 (reduccion de MTTR por notificacion y
  -- despacho automatizados). Si vuelve a moverse, hay que migrar esta
  -- restriccion Y los tres motores de calculo a la vez, o el alta de leads
  -- empieza a fallar en produccion. Ver supabase/migraciones/.
  constraint leads_ahorro_coherente check (
    abs(ahorro_proyectado - perdida_anual * 0.20) <= 1.0
  )
);

comment on table  public.leads is
  'Leads capturados por la landing DowntimeOS (calculadora de margen oculto y auditoría de 30 días).';
comment on column public.leads.folio is
  'Identidad legible LEAD-AAAA-NNNN. La API la expone como `id` para mantener el contrato con public/js/app.js.';
comment on column public.leads.perdida_anual_mxn is
  'Pérdida anual normalizada a MXN con el tipo de cambio vigente al capturar. Permite comparar leads en distinta divisa.';
comment on column public.leads.horas_operacion_dia is
  'Derivada (turnos x 8). No insertar: Postgres la calcula.';

-- -----------------------------------------------------------------------------
-- Índices
-- -----------------------------------------------------------------------------
create index if not exists leads_created_at_idx on public.leads (created_at desc);
create index if not exists leads_estatus_idx    on public.leads (estatus);
create index if not exists leads_email_idx      on public.leads (lower(email));
create index if not exists leads_dominio_idx    on public.leads (dominio_email);

-- -----------------------------------------------------------------------------
-- updated_at automático
-- -----------------------------------------------------------------------------
create or replace function public.tocar_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists leads_set_updated_at on public.leads;
create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function public.tocar_updated_at();

-- -----------------------------------------------------------------------------
-- Vista de agregados: reemplaza store.estadisticas() / GET /api/leads/stats
-- -----------------------------------------------------------------------------
create or replace view public.leads_stats as
select
  (select count(*) from public.leads)::bigint                        as total,
  (select coalesce(jsonb_object_agg(estatus, n), '{}'::jsonb)
     from (select estatus, count(*) as n
             from public.leads group by estatus) t)                  as por_estatus,
  (select coalesce(sum(perdida_anual_mxn), 0) from public.leads)     as perdida_anual_agregada_mxn,
  (select coalesce(round(avg(perdida_anual_mxn), 2), 0)
     from public.leads)                                              as perdida_anual_promedio_mxn,
  (select coalesce(sum(maquinas), 0) from public.leads)::bigint      as maquinas_totales;

-- =============================================================================
-- SEGURIDAD (RLS)
-- =============================================================================
-- Se habilita RLS y NO se crea ninguna política: con eso, las llaves públicas
-- (anon / authenticated) no pueden leer ni escribir nada. Las funciones
-- serverless de Vercel usan SUPABASE_SERVICE_ROLE_KEY, que omite RLS por
-- diseño y solo vive en variables de entorno del servidor.
--
-- ⚠️ NUNCA pongas la service_role key en public/ ni en NEXT_PUBLIC_*: quien la
--    tenga puede leer y borrar toda la tabla.
-- -----------------------------------------------------------------------------
alter table public.leads enable row level security;

-- Opcional — solo si algún día quieres insertar desde el navegador SIN pasar
-- por la función serverless. Implica perder la validación B2B del servidor y
-- el recálculo de montos, así que NO se recomienda. Descomentar con criterio:
--
-- create policy "anon puede insertar leads"
--   on public.leads for insert
--   to anon
--   with check (true);
