-- Alta inicial real: el registro no debe crear activos de demostración.
-- Ejecutar después de las migraciones multitenant (2026-09-29/30).
begin;

alter table public.planta_perfiles
  add column if not exists es_admin_cuenta boolean not null default false;
alter table public.planta_perfiles
  add column if not exists puede_administrar_facturacion boolean not null default false;
alter table public.planta_perfiles
  add column if not exists onboarding_completado_en timestamptz;
alter table public.planta_perfiles drop constraint if exists planta_perfiles_rol_check;
alter table public.planta_perfiles add constraint planta_perfiles_rol_check
  check (rol in ('admin', 'direccion', 'finanzas', 'operaciones', 'operador'));
alter table public.organizaciones add column if not exists propietario_id uuid references auth.users(id) on delete set null;
-- Las cuentas existentes nacieron con un solo perfil de Dirección y aún no
-- conocían el flag de propietario. Promovemos al perfil activo más antiguo;
-- si ya había un admin explícito, ese tiene precedencia.
with propietarios_faltantes as (
  select distinct on (p.organizacion_id) p.organizacion_id,p.user_id
  from public.planta_perfiles p
  where p.organizacion_id is not null and p.activo and p.rol in ('admin','direccion')
    and not exists(select 1 from public.planta_perfiles x where x.organizacion_id=p.organizacion_id and x.activo and x.es_admin_cuenta)
  order by p.organizacion_id,p.created_at asc
)
update public.planta_perfiles p set es_admin_cuenta=true,puede_administrar_facturacion=true
from propietarios_faltantes f where p.organizacion_id=f.organizacion_id and p.user_id=f.user_id;
update public.organizaciones o set propietario_id = (
  select p.user_id from public.planta_perfiles p
  where p.organizacion_id=o.id and p.activo and p.es_admin_cuenta
  order by p.created_at asc limit 1
) where o.propietario_id is null and exists (
  select 1 from public.planta_perfiles p where p.organizacion_id=o.id and p.activo and p.es_admin_cuenta
);

-- Un usuario puede pertenecer a varias plantas sin duplicar su identidad Auth.
create table if not exists public.planta_membresias (
  user_id uuid not null references auth.users(id) on delete cascade,
  organizacion_id uuid not null references public.organizaciones(id) on delete cascade,
  planta_id uuid not null references public.plantas(id) on delete cascade,
  rol text not null check (rol in ('admin', 'direccion', 'finanzas', 'operaciones', 'operador')),
  nombre text not null default '',
  es_admin_cuenta boolean not null default false,
  puede_administrar_facturacion boolean not null default false,
  activo boolean not null default true,
  onboarding_completado_en timestamptz,
  created_at timestamptz not null default now(),
  primary key (user_id, planta_id)
);
insert into public.planta_membresias(user_id,organizacion_id,planta_id,rol,nombre,es_admin_cuenta,puede_administrar_facturacion,activo,onboarding_completado_en)
select user_id,organizacion_id,planta_id,rol,nombre,es_admin_cuenta,puede_administrar_facturacion,activo,onboarding_completado_en
from public.planta_perfiles where organizacion_id is not null and planta_id is not null
on conflict (user_id,planta_id) do nothing;
create index if not exists planta_membresias_org_usuario_idx on public.planta_membresias(organizacion_id,user_id,activo);
alter table public.planta_membresias enable row level security;
drop policy if exists "usuario lee sus membresias" on public.planta_membresias;
create policy "usuario lee sus membresias" on public.planta_membresias
  for select to authenticated using (user_id = auth.uid());

-- La membresía es la fuente de verdad para usuarios con acceso a varias plantas.
drop policy if exists "perfil lee su organizacion" on public.organizaciones;
drop policy if exists "membresia lee su organizacion" on public.organizaciones;
create policy "membresia lee su organizacion" on public.organizaciones for select to authenticated
  using (id in (select organizacion_id from public.planta_membresias where user_id=auth.uid() and activo));
drop policy if exists "perfil lee su planta" on public.plantas;
drop policy if exists "membresia lee su planta" on public.plantas;
create policy "membresia lee su planta" on public.plantas for select to authenticated
  using (id in (select planta_id from public.planta_membresias where user_id=auth.uid() and activo));
do $$
declare tabla text;
begin
  foreach tabla in array array['planta_lineas','planta_activos','planta_estados','planta_eventos',
    'planta_solicitudes','planta_cancelaciones','planta_analisis_ia','planta_reportes','planta_mensajes'] loop
    execute format('drop policy if exists "perfil lee su planta" on public.%I',tabla);
    execute format('drop policy if exists "membresia lee su planta" on public.%I',tabla);
    execute format('create policy "membresia lee su planta" on public.%I for select to authenticated using (planta_id in (select planta_id from public.planta_membresias where user_id=auth.uid() and activo))',tabla);
  end loop;
end $$;

alter table public.planta_activos
  add column if not exists etapa_orden smallint not null default 1 check (etapa_orden > 0),
  add column if not exists archivado_en timestamptz,
  add column if not exists archivado_por uuid references auth.users(id) on delete set null;
alter table public.planta_lineas
  add column if not exists archivado_en timestamptz,
  add column if not exists archivado_por uuid references auth.users(id) on delete set null;

-- Supabase RLS controla filas, no columnas. El operador puede leer los datos
-- necesarios para operar, pero no obtener tarifas mediante REST directo.
revoke select on public.planta_activos from authenticated;
grant select (id,planta_id,linea_id,tipo,nombre,etapa,etapa_orden,cuello_botella,activo,created_at,archivado_en,archivado_por)
  on public.planta_activos to authenticated;

-- Las cuentas migradas que ya tenían datos no deben volver al asistente vacío.
update public.planta_perfiles p
set onboarding_completado_en = coalesce(p.onboarding_completado_en, now())
where p.planta_id is not null
  and exists (select 1 from public.planta_lineas l where l.planta_id = p.planta_id)
  and exists (select 1 from public.planta_activos a where a.planta_id = p.planta_id);

create table if not exists public.planta_invitaciones (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones(id) on delete cascade,
  planta_id uuid not null references public.plantas(id) on delete cascade,
  auth_user_id uuid references auth.users(id) on delete set null,
  email text not null,
  nombre text not null,
  rol text not null check (rol in ('direccion', 'finanzas', 'operaciones', 'operador')),
  es_admin_cuenta boolean not null default false,
  puede_administrar_facturacion boolean not null default false,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aceptada', 'revocada', 'expirada')),
  invitada_por uuid references auth.users(id) on delete set null,
  enviada_en timestamptz not null default now(),
  aceptada_en timestamptz,
  created_at timestamptz not null default now(),
  unique (planta_id, email)
);
create index if not exists planta_invitaciones_planta_estado_idx
  on public.planta_invitaciones(planta_id, estado, enviada_en desc);
alter table public.planta_invitaciones enable row level security;

-- Historial mínimo, con tenant y actor explícitos. No guardar secretos ni tokens.
create table if not exists public.planta_auditoria (
  id bigint generated always as identity primary key,
  organizacion_id uuid not null references public.organizaciones(id) on delete cascade,
  planta_id uuid references public.plantas(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  actor_externo text not null default '',
  accion text not null,
  entidad text not null,
  entidad_id text,
  detalles jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists planta_auditoria_tenant_fecha_idx
  on public.planta_auditoria(organizacion_id, created_at desc);
alter table public.planta_auditoria enable row level security;

-- Catálogo y suscripción a nivel empresa; sin datos de tarjeta.
create table if not exists public.planes (
  codigo text primary key check (codigo in ('starter', 'pro', 'enterprise')),
  nombre text not null,
  precio_mensual_usd numeric(10,2) not null default 0,
  precio_semestral_usd numeric(10,2) not null default 0,
  precio_anual_usd numeric(10,2) not null default 0,
  max_activos integer,
  max_plantas integer,
  funciones jsonb not null default '{}'::jsonb,
  activo boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.planes enable row level security;
alter table public.planes add column if not exists precio_mensual_usd numeric(10,2) not null default 0;
insert into public.planes(codigo, nombre, precio_mensual_usd, precio_semestral_usd, precio_anual_usd, max_activos, max_plantas, funciones) values
  ('starter', 'Starter', 49, 294, 588, 5, 1, '{"exportacion":true}'::jsonb),
  ('pro', 'Pro', 149, 894, 1788, 20, 1, '{"finanzas":true,"whatsapp":true,"pdf_mensual":true,"ai_finanzas":true,"ai_operaciones":true}'::jsonb),
  ('enterprise', 'Enterprise', 299, 1794, 3588, null, null, '{"multiplanta":true,"erp":true,"telemetria_opcional":true,"finanzas":true,"whatsapp":true,"pdf_mensual":true,"ai_finanzas":true,"ai_operaciones":true}'::jsonb)
on conflict (codigo) do nothing;

-- Precios mensuales públicos: son las equivalencias ya anunciadas en landing.
update public.planes set precio_mensual_usd=case codigo
  when 'starter' then 49 when 'pro' then 149 when 'enterprise' then 299 end
where codigo in ('starter','pro','enterprise');
-- La portabilidad del historial es básica y permanece disponible en todos
-- los planes; PDF ejecutivo con IA sigue siendo una función premium distinta.
update public.planes
set funciones = coalesce(funciones, '{}'::jsonb) || '{"exportacion":true}'::jsonb,
    updated_at = now()
where codigo in ('starter','pro','enterprise');

create table if not exists public.organizacion_suscripciones (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones(id) on delete cascade,
  plan_codigo text not null references public.planes(codigo),
  estado text not null default 'solicitada' check (estado in ('solicitada', 'piloto', 'pendiente_pago', 'activa', 'vencida', 'cancelacion_programada', 'cancelada', 'suspendida')),
  periodicidad text check (periodicidad in ('mensual', 'semestral', 'anual')),
  inicia_en timestamptz,
  termina_en timestamptz,
  renueva_en timestamptz,
  plantas_incluidas integer not null default 1 check (plantas_incluidas > 0),
  orden_compra text,
  notas_comerciales text not null default '',
  creada_por uuid references auth.users(id) on delete set null,
  creada_en timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.organizacion_suscripciones
  drop constraint if exists organizacion_suscripciones_periodicidad_check;
alter table public.organizacion_suscripciones
  add constraint organizacion_suscripciones_periodicidad_check
  check (periodicidad in ('mensual', 'semestral', 'anual'));
create index if not exists organizacion_suscripciones_org_estado_idx
  on public.organizacion_suscripciones(organizacion_id, estado, creada_en desc);
create unique index if not exists organizacion_suscripcion_una_pendiente_por_org_idx
  on public.organizacion_suscripciones(organizacion_id)
  where estado in ('solicitada', 'pendiente_pago', 'piloto');
alter table public.organizacion_suscripciones enable row level security;

create table if not exists public.organizacion_suscripcion_avisos (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones(id) on delete cascade,
  suscripcion_id uuid not null references public.organizacion_suscripciones(id) on delete cascade,
  tipo text not null check (tipo in ('7_dias','1_dia')),
  destinatario text not null,
  estado text not null default 'procesando' check (estado in ('procesando','enviada','error')),
  iniciada_en timestamptz not null default now(),
  enviado_en timestamptz,
  proveedor_id text not null default '',
  ultimo_error text not null default '',
  intentos integer not null default 1,
  unique (suscripcion_id,tipo)
);
create index if not exists organizacion_suscripcion_avisos_org_fecha_idx
  on public.organizacion_suscripcion_avisos(organizacion_id,iniciada_en desc);
alter table public.organizacion_suscripcion_avisos enable row level security;
revoke all on table public.organizacion_suscripcion_avisos from public,anon,authenticated;
grant all on table public.organizacion_suscripcion_avisos to service_role;

create or replace function public.organizacion_reservar_aviso_suscripcion(
  p_organizacion_id uuid,p_suscripcion_id uuid,p_tipo text,p_destinatario text
) returns uuid
language plpgsql security invoker set search_path=public as $$
declare v_id uuid;
begin
  if p_tipo not in ('7_dias','1_dia') or left(p_destinatario,254) = '' then
    raise exception 'Los datos del aviso de suscripción no son válidos.' using errcode='22023';
  end if;
  if not exists (
    select 1 from public.organizacion_suscripciones s
    where s.id=p_suscripcion_id and s.organizacion_id=p_organizacion_id
  ) then
    raise exception 'La suscripción no pertenece a la organización indicada.' using errcode='23503';
  end if;
  insert into public.organizacion_suscripcion_avisos(organizacion_id,suscripcion_id,tipo,destinatario,estado,iniciada_en,intentos)
  values(p_organizacion_id,p_suscripcion_id,p_tipo,left(p_destinatario,254),'procesando',clock_timestamp(),1)
  on conflict(suscripcion_id,tipo) do update set estado='procesando',destinatario=excluded.destinatario,
    iniciada_en=clock_timestamp(),ultimo_error='',intentos=organizacion_suscripcion_avisos.intentos+1
  where organizacion_suscripcion_avisos.estado='error'
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.organizacion_reservar_aviso_suscripcion(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.organizacion_reservar_aviso_suscripcion(uuid,uuid,text,text) to service_role;

create table if not exists public.organizacion_pagos (
  id uuid primary key default gen_random_uuid(),
  suscripcion_id uuid not null references public.organizacion_suscripciones(id) on delete restrict,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'comprobante_recibido', 'verificado', 'rechazado', 'reembolsado')),
  importe numeric(12,2) not null check (importe > 0),
  moneda text not null default 'USD' check (moneda in ('USD', 'MXN')),
  referencia text not null default '',
  comprobante_path text,
  recibido_en timestamptz,
  verificado_por uuid references auth.users(id) on delete set null,
  verificado_por_admin text not null default '',
  verificado_en timestamptz,
  notas text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists organizacion_pagos_suscripcion_fecha_idx
  on public.organizacion_pagos(suscripcion_id, created_at desc);
alter table public.organizacion_pagos enable row level security;

drop policy if exists "perfil lee catalogo de planes" on public.planes;
create policy "perfil lee catalogo de planes" on public.planes
  for select to authenticated using (activo);

create table if not exists public.organizacion_facturacion (
  organizacion_id uuid primary key references public.organizaciones(id) on delete cascade,
  razon_social text not null default '',
  rfc text not null default '',
  correo text not null default '',
  domicilio_fiscal text not null default '',
  referencia_cxp text not null default '',
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.organizacion_facturacion enable row level security;

-- La solicitud y el registro del importe esperado quedan en una transacción.
create or replace function public.organizacion_solicitar_plan(
  p_organizacion_id uuid,
  p_usuario_id uuid,
  p_plan_codigo text,
  p_periodicidad text,
  p_plantas integer,
  p_orden_compra text default ''
) returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  v_plan public.planes%rowtype;
  v_suscripcion public.organizacion_suscripciones%rowtype;
  v_planta_id uuid;
  v_num_plantas integer;
  v_num_activos integer;
  v_importe numeric(12,2);
begin
  -- Orden común de locks para transiciones de suscripción:
  -- primero advisory por organización, luego filas de suscripción y pagos.
  -- Mantenerlo igual en solicitud, resolución admin y cancelación.
  perform pg_advisory_xact_lock(hashtextextended(p_organizacion_id::text, 0));
  update public.organizacion_suscripciones set estado = 'vencida'
    where organizacion_id = p_organizacion_id
      and estado in ('activa', 'piloto', 'cancelacion_programada')
      and termina_en is not null and termina_en <= now();
  if exists (select 1 from public.organizacion_suscripciones s where s.organizacion_id = p_organizacion_id
    and s.estado in ('activa', 'piloto', 'cancelacion_programada')
    and (s.termina_en is null or s.termina_en > now())) then
    raise exception 'Tu empresa ya tiene un plan vigente; contacta a DowntimeOS para solicitar un cambio.' using errcode = '22023';
  end if;
  if p_periodicidad is null or p_periodicidad not in ('mensual', 'semestral', 'anual')
     or p_plantas is null or p_plantas < 1 then
    raise exception 'El periodo o el número de plantas no es válido.' using errcode = '22023';
  end if;
  select * into v_plan from public.planes where codigo = p_plan_codigo and activo;
  if not found then raise exception 'El plan solicitado no está disponible.' using errcode = '22023'; end if;
  if p_plan_codigo='enterprise' and p_plantas<3 then
    raise exception 'Enterprise requiere una cotización mínima de tres plantas.' using errcode='22023';
  end if;
  select count(*) into v_num_plantas from public.plantas where organizacion_id = p_organizacion_id and activa;
  select m.planta_id into v_planta_id from public.planta_membresias m
    where m.organizacion_id=p_organizacion_id and m.user_id=p_usuario_id and m.activo
    order by m.planta_id limit 1;
  if v_planta_id is null then
    raise exception 'Se requiere una membresía activa para solicitar un plan.' using errcode = '42501';
  end if;
  if v_plan.max_plantas is not null and v_num_plantas > v_plan.max_plantas then
    raise exception 'El plan seleccionado no cubre todas las plantas activas.' using errcode = '22023';
  end if;
  if p_plantas < v_num_plantas then raise exception 'La cotización debe cubrir todas las plantas activas.' using errcode = '22023'; end if;
  if v_plan.max_activos is not null then
    select count(*) into v_num_activos from public.planta_activos a
      join public.plantas p on p.id = a.planta_id
      where p.organizacion_id = p_organizacion_id and p.activa and a.activo;
    if v_num_activos > v_plan.max_activos then
      raise exception 'El plan seleccionado no cubre la cantidad de activos configurada.' using errcode = '22023';
    end if;
  end if;
  v_importe := (case p_periodicidad when 'mensual' then v_plan.precio_mensual_usd
    when 'anual' then v_plan.precio_anual_usd else v_plan.precio_semestral_usd end) * p_plantas;
  insert into public.organizacion_suscripciones(organizacion_id,plan_codigo,estado,periodicidad,plantas_incluidas,orden_compra,creada_por)
  values (p_organizacion_id,p_plan_codigo,'solicitada',p_periodicidad,p_plantas,left(trim(coalesce(p_orden_compra,'')),100),p_usuario_id)
  returning * into v_suscripcion;
  insert into public.organizacion_pagos(suscripcion_id,estado,importe,moneda,referencia)
  values (v_suscripcion.id,'pendiente',v_importe,'USD',left(trim(coalesce(p_orden_compra,'')),100));
  insert into public.planta_auditoria(organizacion_id,planta_id,actor_id,accion,entidad,entidad_id,detalles)
    values (p_organizacion_id,v_planta_id,p_usuario_id,'plan_solicitado','suscripcion',v_suscripcion.id::text,
      jsonb_build_object('plan',p_plan_codigo,'periodicidad',p_periodicidad,'importe_usd',v_importe,
        'orden_compra',left(trim(coalesce(p_orden_compra,'')),100)));
  return jsonb_build_object('id',v_suscripcion.id,'plan_codigo',v_suscripcion.plan_codigo,'estado',v_suscripcion.estado,
    'periodicidad',v_suscripcion.periodicidad,'plantas_incluidas',v_suscripcion.plantas_incluidas,
    'orden_compra',v_suscripcion.orden_compra,'importe_usd',v_importe);
end;
$$;
revoke all on function public.organizacion_solicitar_plan(uuid,uuid,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.organizacion_solicitar_plan(uuid,uuid,text,text,integer,text) to service_role;

-- Captura de onboarding atómica: valida y crea línea, activos y estados juntos.
create or replace function public.planta_configurar_inicial(
  p_planta_id uuid,
  p_usuario_id uuid,
  p_lineas jsonb,
  p_activos jsonb
) returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  l jsonb;
  a jsonb;
  v_id text;
  v_lineas integer := 0;
  v_activos integer := 0;
begin
  -- Serializa dobles envíos del onboarding para no mezclar dos configuraciones.
  perform 1 from public.plantas where id=p_planta_id and activa for update;
  if not found then raise exception 'La planta no existe o está archivada.' using errcode='P0002'; end if;
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) < 1 then
    raise exception 'Agrega al menos una línea.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_activos) <> 'array' or jsonb_array_length(p_activos) < 1 then
    raise exception 'Agrega al menos una máquina real de la planta.' using errcode = '22023';
  end if;
  if exists (select 1 from public.planta_lineas where planta_id = p_planta_id)
     or exists (select 1 from public.planta_activos where planta_id = p_planta_id) then
    raise exception 'La configuración inicial ya fue guardada.' using errcode = '23505';
  end if;

  for l in select value from jsonb_array_elements(p_lineas) loop
    v_id := upper(trim(l->>'id'));
    if v_id !~ '^L-[0-9]{2}$' or coalesce(length(trim(l->>'nombre')), 0) < 2 then
      raise exception 'Revisa el código y nombre de cada línea.' using errcode = '22023';
    end if;
    insert into public.planta_lineas(id, planta_id, nombre, descripcion, orden, activa)
    values (v_id, p_planta_id, left(trim(l->>'nombre'), 120), '', coalesce((l->>'orden')::smallint, 1), true);
    v_lineas := v_lineas + 1;
  end loop;

  for a in select value from jsonb_array_elements(p_activos) loop
    v_id := upper(trim(a->>'id'));
    if v_id !~ '^[A-Z]-[0-9]{2}$'
       or coalesce(length(trim(a->>'nombre')), 0) < 2
       or coalesce(length(trim(a->>'etapa')), 0) < 2
       or coalesce(length(trim(a->>'tipo')), 0) <> 2
       or (a->>'tarifa_hora')::numeric <= 0 then
      raise exception 'Revisa código, nombre, etapa, tipo y tarifa de cada máquina.' using errcode = '22023';
    end if;
    insert into public.planta_activos(id, planta_id, linea_id, tipo, nombre, etapa, etapa_orden, tarifa_hora, cuello_botella, activo)
    values (v_id, p_planta_id, upper(trim(a->>'linea_id')), upper(trim(a->>'tipo')),
      left(trim(a->>'nombre'), 120), left(trim(a->>'etapa'), 120),
      coalesce((a->>'etapa_orden')::smallint, 1), (a->>'tarifa_hora')::numeric,
      coalesce((a->>'cuello_botella')::boolean, false), true);
    insert into public.planta_estados(planta_id, activo_id, estado)
    values (p_planta_id, v_id, 'RUN');
    v_activos := v_activos + 1;
  end loop;
  update public.planta_perfiles set onboarding_completado_en = now()
    where user_id = p_usuario_id and planta_id = p_planta_id and activo;
  update public.planta_membresias set onboarding_completado_en = now()
    where user_id = p_usuario_id and planta_id = p_planta_id and activo;
  if not found then raise exception 'No se encontró la membresía autorizada de esta planta.' using errcode = '42501'; end if;
  return jsonb_build_object('lineas', v_lineas, 'activos', v_activos);
end;
$$;
revoke all on function public.planta_configurar_inicial(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.planta_configurar_inicial(uuid,uuid,jsonb,jsonb) to service_role;

-- Reemplaza la captura de paro incluyendo lock de activo para impedir que una
-- captura concurrente gane una carrera con el archivo del equipo.
create or replace function public.planta_reportar_paro(
  p_planta_id uuid,p_activo_id text,p_causa_id text,
  p_causa_libre text default null,p_desde timestamptz default null,p_reportado_por text default ''
) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare
  v_activo public.planta_activos%rowtype;
  v_causa public.planta_causas%rowtype;
  v_desde timestamptz := coalesce(p_desde,now());
  v_libre text;
  v_folio text;
  v_estado public.planta_estados%rowtype;
  v_solicitud public.planta_solicitudes%rowtype;
begin
  select * into v_activo from public.planta_activos
    where planta_id=p_planta_id and id=p_activo_id and activo
    for update;
  if not found then raise exception 'El activo % no existe o está inactivo en esta planta.',p_activo_id using errcode='P0001'; end if;
  if exists(select 1 from public.planta_estados where planta_id=p_planta_id and activo_id=p_activo_id and estado='STOP')
     or exists(select 1 from public.planta_solicitudes where planta_id=p_planta_id and activo_id=p_activo_id and not cerrada) then
    raise exception 'Este equipo ya tiene un paro o reporte abierto.' using errcode='23505';
  end if;
  select * into v_causa from public.planta_causas where id=p_causa_id;
  if not found then raise exception 'La causa % no existe.',p_causa_id using errcode='P0001'; end if;
  v_libre := nullif(left(trim(coalesce(p_causa_libre,'')),120),'');
  if v_causa.requiere_texto and coalesce(length(v_libre),0)<3 then
    raise exception 'La causa «Otros» necesita una descripción de al menos 3 caracteres.' using errcode='P0001';
  end if;
  if not v_causa.requiere_texto then v_libre := null; end if;
  v_folio := replace(v_activo.linea_id,'-','') || '-' || v_activo.tipo || '-' ||
    replace(v_activo.id,'-','') || '-' ||
    to_char(v_desde at time zone 'America/Mexico_City','YYYYMMDD-HH24MI') || '-' ||
    upper(substr(md5(p_planta_id::text || p_activo_id || clock_timestamp()::text),1,2));
  insert into public.planta_estados(planta_id,activo_id,estado,desde,causa_id,causa_libre,actualizado_en)
  values(p_planta_id,v_activo.id,'STOP',v_desde,v_causa.id,v_libre,now())
  on conflict(planta_id,activo_id) do update set estado=excluded.estado,desde=excluded.desde,
    causa_id=excluded.causa_id,causa_libre=excluded.causa_libre,actualizado_en=excluded.actualizado_en
  returning * into v_estado;
  insert into public.planta_solicitudes(planta_id,folio,activo_id,causa_id,causa_libre,desde,reportado_por,estado)
  values(p_planta_id,v_folio,v_activo.id,v_causa.id,v_libre,v_desde,left(coalesce(p_reportado_por,''),120),'pendiente')
  returning * into v_solicitud;
  return jsonb_build_object('estado',to_jsonb(v_estado),'solicitud',to_jsonb(v_solicitud));
end;
$$;
revoke all on function public.planta_reportar_paro(uuid,text,text,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.planta_reportar_paro(uuid,text,text,text,timestamptz,text) to service_role;

-- Mantener el ciclo de vida de líneas y equipos: nunca se borra historia operativa.
create or replace function public.planta_actualizar_estructura(
  p_planta_id uuid,
  p_usuario_id uuid,
  p_accion text,
  p_linea jsonb default null,
  p_activo jsonb default null,
  p_id text default null
) returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  v_linea_id text;
  v_activo_id text;
  v_cantidad integer;
  v_nombre text;
  v_organizacion_id uuid;
  v_plan_codigo text;
  v_max_activos integer;
begin
  -- Serializa altas de activos y sitios contra los límites de plan de la
  -- organización. Se usa el mismo lock raíz que en las transiciones de plan.
  if p_accion in ('crear_activo') then
    select organizacion_id into v_organizacion_id
      from public.plantas where id=p_planta_id and activa;
    if v_organizacion_id is null then
      raise exception 'La planta no existe o está archivada.' using errcode='P0002';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(v_organizacion_id::text, 0));
  end if;
  if p_accion = 'crear_linea' then
    v_linea_id := upper(trim(p_linea->>'id'));
    v_nombre := trim(p_linea->>'nombre');
    if v_linea_id !~ '^L-[0-9]{2}$' or coalesce(length(v_nombre), 0) < 2 then
      raise exception 'El código y nombre de línea no son válidos.' using errcode = '22023';
    end if;
    insert into public.planta_lineas(id,planta_id,nombre,descripcion,orden,activa)
    values (v_linea_id,p_planta_id,left(v_nombre,120),'',coalesce((p_linea->>'orden')::smallint,1),true);
    return jsonb_build_object('accion',p_accion,'linea_id',v_linea_id);
  elsif p_accion = 'crear_activo' then
    v_activo_id := upper(trim(p_activo->>'id'));
    v_linea_id := upper(trim(p_activo->>'linea_id'));
    v_nombre := trim(p_activo->>'nombre');
    if v_activo_id !~ '^[A-Z]-[0-9]{2}$' or coalesce(length(v_nombre),0) < 2
       or coalesce(length(trim(p_activo->>'etapa')),0) < 2
       or coalesce(length(trim(p_activo->>'tipo')),0) <> 2
       or (p_activo->>'tarifa_hora')::numeric not between 1 and 1000000
       or coalesce((p_activo->>'etapa_orden')::integer,0) not between 1 and 99 then
      raise exception 'Los datos del equipo no son válidos.' using errcode = '22023';
    end if;
    if not exists(select 1 from public.planta_lineas where planta_id=p_planta_id and id=v_linea_id and activa and archivado_en is null) then
      raise exception 'La línea elegida no existe o está archivada.' using errcode = '22023';
    end if;
    select organizacion_id into v_organizacion_id from public.plantas where id=p_planta_id and activa;
    select s.plan_codigo into v_plan_codigo from public.organizacion_suscripciones s
      where s.organizacion_id=v_organizacion_id and s.estado in ('piloto','activa','cancelacion_programada')
        and (s.inicia_en is null or s.inicia_en <= now()) and (s.termina_en is null or s.termina_en > now())
      order by s.creada_en desc limit 1 for update;
    if v_plan_codigo is null then raise exception 'Se requiere un plan activo para agregar equipos.' using errcode='23514'; end if;
    select max_activos into v_max_activos from public.planes where codigo=v_plan_codigo and activo;
    if v_max_activos is not null then
      select count(*) into v_cantidad from public.planta_activos a
        join public.plantas p on p.id=a.planta_id
        where p.organizacion_id=v_organizacion_id and p.activa and a.activo and a.archivado_en is null;
      if v_cantidad >= v_max_activos then raise exception 'El plan alcanzó su límite de equipos activos.' using errcode='23514'; end if;
    end if;
    insert into public.planta_activos(id,planta_id,linea_id,tipo,nombre,etapa,etapa_orden,tarifa_hora,cuello_botella,activo)
    values (v_activo_id,p_planta_id,v_linea_id,upper(trim(p_activo->>'tipo')),left(v_nombre,120),
      left(trim(p_activo->>'etapa'),120),(p_activo->>'etapa_orden')::smallint,
      (p_activo->>'tarifa_hora')::numeric,coalesce((p_activo->>'cuello_botella')::boolean,false),true);
    insert into public.planta_estados(planta_id,activo_id,estado) values(p_planta_id,v_activo_id,'RUN');
    return jsonb_build_object('accion',p_accion,'activo_id',v_activo_id);
  elsif p_accion = 'archivar_activo' then
    v_activo_id := upper(trim(p_id));
    -- Serializa el archivo con reportes de paro, que bloquean la misma fila
    -- de planta_activos antes de verificarla y crear estado/solicitud.
    perform 1 from public.planta_activos
      where planta_id=p_planta_id and id=v_activo_id and activo
      for update;
    if not found then raise exception 'El equipo no existe o ya está archivado.' using errcode='P0002'; end if;
    if exists(select 1 from public.planta_estados where planta_id=p_planta_id and activo_id=v_activo_id and estado='STOP') then
      raise exception 'Cierra el paro vigente antes de archivar este equipo.' using errcode='23514';
    end if;
    if exists(select 1 from public.planta_solicitudes where planta_id=p_planta_id and activo_id=v_activo_id and not cerrada) then
      raise exception 'Resuelve los reportes abiertos antes de archivar este equipo.' using errcode='23514';
    end if;
    update public.planta_activos set activo=false,archivado_en=now(),archivado_por=p_usuario_id
      where planta_id=p_planta_id and id=v_activo_id and activo and archivado_en is null;
    if not found then raise exception 'El equipo no existe o ya está archivado.' using errcode = 'P0002'; end if;
    update public.planta_estados set estado='RUN',causa_id=null,causa_libre=null,actualizado_en=now()
      where planta_id=p_planta_id and activo_id=v_activo_id;
    return jsonb_build_object('accion',p_accion,'activo_id',v_activo_id);
  elsif p_accion = 'archivar_linea' then
    v_linea_id := upper(trim(p_id));
    select count(*) into v_cantidad from public.planta_activos
      where planta_id=p_planta_id and linea_id=v_linea_id and activo and archivado_en is null;
    if v_cantidad > 0 then raise exception 'Archiva primero los equipos activos de esta línea.' using errcode = '23503'; end if;
    update public.planta_lineas set activa=false,archivado_en=now(),archivado_por=p_usuario_id
      where planta_id=p_planta_id and id=v_linea_id and activa and archivado_en is null;
    if not found then raise exception 'La línea no existe o ya está archivada.' using errcode = 'P0002'; end if;
    return jsonb_build_object('accion',p_accion,'linea_id',v_linea_id);
  end if;
  raise exception 'Acción de estructura no reconocida.' using errcode = '22023';
end;
$$;

revoke all on function public.planta_actualizar_estructura(uuid,uuid,text,jsonb,jsonb,text) from public, anon, authenticated;
grant execute on function public.planta_actualizar_estructura(uuid,uuid,text,jsonb,jsonb,text) to service_role;

create or replace function public.organizacion_es_propietario(p_organizacion_id uuid,p_usuario_id uuid)
returns boolean language sql stable security invoker set search_path=public as $$
  select exists(select 1 from public.organizaciones where id=p_organizacion_id and propietario_id=p_usuario_id)
$$;
revoke all on function public.organizacion_es_propietario(uuid,uuid) from public,anon,authenticated;

create or replace function public.organizacion_admin_resolver_solicitud(
  p_suscripcion_id uuid,p_accion text,p_admin text
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare
  s public.organizacion_suscripciones%rowtype;
  v_organizacion_id uuid;
  v_inicio timestamptz := now();
  v_fin timestamptz;
  v_pago_id uuid;
begin
  -- Lock order: advisory por organización -> suscripción -> pagos.
  -- Todas las transiciones de este flujo deben respetar este orden.
  select organizacion_id into v_organizacion_id from public.organizacion_suscripciones where id=p_suscripcion_id;
  if v_organizacion_id is null then raise exception 'No encontramos esa solicitud.' using errcode='P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_organizacion_id::text, 0));
  select * into s from public.organizacion_suscripciones where id=p_suscripcion_id for update;
  if not found then raise exception 'No encontramos esa solicitud.' using errcode='P0002'; end if;
  if s.estado not in ('solicitada','pendiente_pago') then raise exception 'La solicitud ya no está pendiente.' using errcode='23505'; end if;
  if p_accion is null or p_accion not in ('activar','piloto','rechazar') then raise exception 'Acción no válida.' using errcode='22023'; end if;
  if p_accion='activar' then
    select id into v_pago_id from public.organizacion_pagos where suscripcion_id=s.id and estado='pendiente' order by created_at desc limit 1 for update;
    if v_pago_id is null then raise exception 'No hay un pago pendiente vinculado para verificar.' using errcode='23514'; end if;
    v_fin := v_inicio + case s.periodicidad when 'mensual' then interval '1 month'
      when 'anual' then interval '12 months' else interval '6 months' end;
    update public.organizacion_pagos set estado='verificado',verificado_en=v_inicio,verificado_por_admin=left(p_admin,254) where id=v_pago_id;
    update public.organizacion_suscripciones set estado='activa',inicia_en=v_inicio,termina_en=v_fin,renueva_en=v_fin,updated_at=v_inicio where id=s.id;
  elsif p_accion='piloto' then
    v_fin := v_inicio + interval '14 days';
    update public.organizacion_suscripciones set estado='piloto',inicia_en=v_inicio,termina_en=v_fin,renueva_en=null,updated_at=v_inicio where id=s.id;
  else
    update public.organizacion_pagos set estado='rechazado',verificado_por_admin=left(p_admin,254) where suscripcion_id=s.id and estado='pendiente';
    update public.organizacion_suscripciones set estado='cancelada',updated_at=v_inicio where id=s.id;
  end if;
  insert into public.planta_auditoria(organizacion_id,actor_externo,accion,entidad,entidad_id,detalles)
    values(s.organizacion_id,left(p_admin,254),case when p_accion='piloto' then 'piloto_activado' when p_accion='activar' then 'pago_verificado_plan_activado' else 'solicitud_plan_rechazada' end,
      'suscripcion',s.id::text,jsonb_build_object('termina_en',v_fin,'accion',p_accion));
  return jsonb_build_object('id',s.id,'accion',p_accion,'termina_en',v_fin);
end $$;
revoke all on function public.organizacion_admin_resolver_solicitud(uuid,text,text) from public,anon,authenticated;
grant execute on function public.organizacion_admin_resolver_solicitud(uuid,text,text) to service_role;

-- Crear un sitio y asociar al propietario en una sola transacción. El lock de
-- la suscripción serializa altas simultáneas para no exceder el cupo cotizado.
create or replace function public.organizacion_agregar_planta(
  p_organizacion_id uuid,p_usuario_id uuid,p_planta_origen_id uuid,p_nombre text
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare
  s public.organizacion_suscripciones%rowtype;
  v_max_plantas integer;
  v_actuales integer;
  v_funciones jsonb;
  v_rol text;
  v_nombre_usuario text;
  v_facturacion boolean;
  v_planta public.plantas%rowtype;
begin
  if not exists(select 1 from public.organizaciones where id=p_organizacion_id and propietario_id=p_usuario_id) then
    raise exception 'Solo el propietario de la cuenta puede agregar plantas.' using errcode='42501';
  end if;
  -- Todas las altas de sitios de una organización respetan serialización por
  -- organización, incluso cuando hay más de una suscripción histórica.
  perform pg_advisory_xact_lock(hashtextextended(p_organizacion_id::text, 0));
  if char_length(trim(p_nombre)) not between 2 and 160 then raise exception 'Nombre de planta no válido.' using errcode='22023'; end if;
  select * into s from public.organizacion_suscripciones
    where organizacion_id=p_organizacion_id and estado in ('activa','piloto','cancelacion_programada')
      and (inicia_en is null or inicia_en<=now()) and (termina_en is null or termina_en>now())
    order by creada_en desc limit 1 for update;
  if not found then raise exception 'La cuenta no tiene un plan vigente.' using errcode='23514'; end if;
  select max_plantas,funciones into v_max_plantas,v_funciones from public.planes where codigo=s.plan_codigo and activo;
  if v_funciones->>'multiplanta' is distinct from 'true' then raise exception 'La función multiplanta no está incluida en el plan.' using errcode='42501'; end if;
  select count(*) into v_actuales from public.plantas where organizacion_id=p_organizacion_id and activa;
  if v_max_plantas is not null and v_actuales>=v_max_plantas then raise exception 'El plan alcanzó su límite de plantas.' using errcode='23514'; end if;
  if v_actuales>=s.plantas_incluidas then raise exception 'La cotización no incluye otra planta.' using errcode='23514'; end if;
  select rol,nombre,puede_administrar_facturacion into v_rol,v_nombre_usuario,v_facturacion
    from public.planta_membresias where user_id=p_usuario_id and planta_id=p_planta_origen_id and organizacion_id=p_organizacion_id and activo;
  if not found then raise exception 'No hay membresía del propietario en la planta de origen.' using errcode='42501'; end if;
  insert into public.plantas(organizacion_id,nombre) values(p_organizacion_id,trim(p_nombre)) returning * into v_planta;
  insert into public.planta_membresias(user_id,organizacion_id,planta_id,rol,nombre,es_admin_cuenta,puede_administrar_facturacion,activo)
    values(p_usuario_id,p_organizacion_id,v_planta.id,v_rol,v_nombre_usuario,true,v_facturacion,true);
  insert into public.planta_auditoria(organizacion_id,planta_id,actor_id,accion,entidad,entidad_id,detalles)
    values(p_organizacion_id,v_planta.id,p_usuario_id,'planta_creada','planta',v_planta.id::text,jsonb_build_object('nombre',v_planta.nombre));
  return jsonb_build_object('id',v_planta.id,'nombre',v_planta.nombre,'codigo',v_planta.codigo);
end $$;
revoke all on function public.organizacion_agregar_planta(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.organizacion_agregar_planta(uuid,uuid,uuid,text) to service_role;

-- Cambios/revocación de acceso son atómicos y afectan solo una membresía;
-- `planta_perfiles` queda como compatibilidad histórica, no como autoridad.
create or replace function public.planta_admin_cambiar_miembro(
  p_organizacion_id uuid,p_planta_id uuid,p_actor_id uuid,p_invitacion_id uuid,p_rol text,p_facturacion boolean
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare i public.planta_invitaciones%rowtype;
begin
  if not exists(select 1 from public.organizaciones where id=p_organizacion_id and propietario_id=p_actor_id) then
    raise exception 'Solo el propietario puede cambiar miembros.' using errcode='42501';
  end if;
  if p_rol not in ('direccion','finanzas','operaciones','operador') then raise exception 'Rol no válido.' using errcode='22023'; end if;
  select * into i from public.planta_invitaciones where id=p_invitacion_id and organizacion_id=p_organizacion_id and planta_id=p_planta_id for update;
  if not found or i.estado <> 'aceptada' then raise exception 'El miembro no está activo en esta planta.' using errcode='P0002'; end if;
  if i.auth_user_id=p_actor_id then raise exception 'El propietario no puede editarse desde el equipo.' using errcode='42501'; end if;
  update public.planta_membresias set rol=p_rol,es_admin_cuenta=false,puede_administrar_facturacion=p_facturacion
    where user_id=i.auth_user_id and planta_id=p_planta_id and organizacion_id=p_organizacion_id and activo;
  if not found then raise exception 'No hay una membresía activa para este usuario.' using errcode='P0002'; end if;
  update public.planta_invitaciones set rol=p_rol,puede_administrar_facturacion=p_facturacion where id=i.id;
  insert into public.planta_auditoria(organizacion_id,planta_id,actor_id,accion,entidad,entidad_id,detalles)
    values(p_organizacion_id,p_planta_id,p_actor_id,'permisos_usuario_actualizados','usuario',i.auth_user_id::text,
      jsonb_build_object('rol_anterior',i.rol,'rol_nuevo',p_rol,'facturacion',p_facturacion));
  return jsonb_build_object('id',i.id,'rol',p_rol,'puede_administrar_facturacion',p_facturacion);
end $$;
revoke all on function public.planta_admin_cambiar_miembro(uuid,uuid,uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.planta_admin_cambiar_miembro(uuid,uuid,uuid,uuid,text,boolean) to service_role;

create or replace function public.planta_admin_revocar_miembro(
  p_organizacion_id uuid,p_planta_id uuid,p_actor_id uuid,p_invitacion_id uuid
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare i public.planta_invitaciones%rowtype;
begin
  if not exists(select 1 from public.organizaciones where id=p_organizacion_id and propietario_id=p_actor_id) then
    raise exception 'Solo el propietario puede revocar miembros.' using errcode='42501';
  end if;
  select * into i from public.planta_invitaciones where id=p_invitacion_id and organizacion_id=p_organizacion_id and planta_id=p_planta_id for update;
  if not found or i.estado not in ('pendiente','aceptada') then raise exception 'La invitación ya no está activa.' using errcode='P0002'; end if;
  if i.auth_user_id=p_actor_id then raise exception 'El propietario no puede desactivar su propio acceso.' using errcode='42501'; end if;
  update public.planta_membresias set activo=false where user_id=i.auth_user_id and planta_id=p_planta_id and organizacion_id=p_organizacion_id;
  update public.planta_invitaciones set estado='revocada' where id=i.id;
  insert into public.planta_auditoria(organizacion_id,planta_id,actor_id,accion,entidad,entidad_id,detalles)
    values(p_organizacion_id,p_planta_id,p_actor_id,'invitacion_revocada','invitacion',i.id::text,jsonb_build_object('email',i.email,'rol',i.rol));
  return jsonb_build_object('id',i.id,'estado','revocada');
end $$;
revoke all on function public.planta_admin_revocar_miembro(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.planta_admin_revocar_miembro(uuid,uuid,uuid,uuid) to service_role;

commit;

-- Billing hardening: cancel atomically and distinguish voided payments from
-- rejected proof. Safe to re-run on databases created by this migration.
begin;

alter table public.organizacion_pagos drop constraint if exists organizacion_pagos_estado_check;
alter table public.organizacion_pagos drop constraint if exists organizacion_pagos_estado_mvp_check;
alter table public.organizacion_pagos add constraint organizacion_pagos_estado_mvp_check
  check (estado in ('pendiente','comprobante_recibido','verificado','rechazado','reembolsado','anulado'));

create or replace function public.organizacion_cancelar_suscripcion(
  p_organizacion_id uuid,p_suscripcion_id uuid,p_planta_id uuid,p_actor_id uuid
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare
  s public.organizacion_suscripciones%rowtype;
  v_organizacion_id uuid;
  v_estado text;
  v_accion text;
begin
  -- Lock order: advisory por organización -> suscripción -> pagos.
  -- Serializa activar/piloto/rechazar con solicitudes y cancelaciones.
  select organizacion_id into v_organizacion_id from public.organizacion_suscripciones
    where id=p_suscripcion_id and organizacion_id=p_organizacion_id;
  if v_organizacion_id is null then raise exception 'No encontramos la suscripción de tu empresa.' using errcode='P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_organizacion_id::text, 0));
  select * into s from public.organizacion_suscripciones
    where id=p_suscripcion_id and organizacion_id=p_organizacion_id for update;
  if not found then raise exception 'No encontramos la suscripción de tu empresa.' using errcode='P0002'; end if;
  if s.estado in ('cancelada','cancelacion_programada') then
    raise exception 'La suscripción ya está cancelada o tiene cancelación programada.' using errcode='23505';
  end if;

  if s.estado in ('activa','piloto') and s.termina_en is not null and s.termina_en > now() then
    v_estado := 'cancelacion_programada';
    v_accion := 'cancelacion_programada';
  elsif s.estado in ('solicitada','pendiente_pago','activa','piloto','vencida','suspendida') then
    v_estado := 'cancelada';
    v_accion := 'suscripcion_cancelada';
    update public.organizacion_pagos set estado='anulado',notas=case when notas='' then 'Solicitud de plan cancelada.' else notas || E'\nSolicitud de plan cancelada.' end
      where suscripcion_id=s.id and estado in ('pendiente','comprobante_recibido');
  else
    raise exception 'El estado actual no permite cancelar esta suscripción.' using errcode='22023';
  end if;

  update public.organizacion_suscripciones set estado=v_estado,updated_at=now() where id=s.id;
  insert into public.planta_auditoria(organizacion_id,planta_id,actor_id,accion,entidad,entidad_id,detalles)
    values(p_organizacion_id,p_planta_id,p_actor_id,v_accion,'suscripcion',s.id::text,
      jsonb_build_object('estado_anterior',s.estado,'estado_nuevo',v_estado,'termina_en',s.termina_en));
  return jsonb_build_object('id',s.id,'estado',v_estado,'termina_en',s.termina_en);
end $$;
revoke all on function public.organizacion_cancelar_suscripcion(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.organizacion_cancelar_suscripcion(uuid,uuid,uuid,uuid) to service_role;

-- Redefinición de la resolución administrativa: otorgar un piloto anula el
-- pago pendiente relacionado en la misma transacción (no lo etiqueta como rechazado).
create or replace function public.organizacion_admin_resolver_solicitud(
  p_suscripcion_id uuid,p_accion text,p_admin text
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare
  s public.organizacion_suscripciones%rowtype;
  v_organizacion_id uuid;
  v_inicio timestamptz := now();
  v_fin timestamptz;
  v_pago_id uuid;
begin
  -- Esta definición posterior también debe seguir el orden de locks común:
  -- organización -> suscripción -> pago.
  select organizacion_id into v_organizacion_id from public.organizacion_suscripciones where id=p_suscripcion_id;
  if v_organizacion_id is null then raise exception 'No encontramos esa solicitud.' using errcode='P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_organizacion_id::text, 0));
  select * into s from public.organizacion_suscripciones where id=p_suscripcion_id for update;
  if not found then raise exception 'No encontramos esa solicitud.' using errcode='P0002'; end if;
  if s.estado not in ('solicitada','pendiente_pago') then raise exception 'La solicitud ya no está pendiente.' using errcode='23505'; end if;
  if p_accion is null or p_accion not in ('activar','piloto','rechazar') then raise exception 'Acción no válida.' using errcode='22023'; end if;
  if p_accion='activar' then
    select id into v_pago_id from public.organizacion_pagos where suscripcion_id=s.id and estado='pendiente' order by created_at desc limit 1 for update;
    if v_pago_id is null then raise exception 'No hay un pago pendiente vinculado para verificar.' using errcode='23514'; end if;
    v_fin := v_inicio + case s.periodicidad when 'mensual' then interval '1 month'
      when 'anual' then interval '12 months' else interval '6 months' end;
    update public.organizacion_pagos set estado='verificado',verificado_en=v_inicio,verificado_por_admin=left(p_admin,254) where id=v_pago_id;
    update public.organizacion_suscripciones set estado='activa',inicia_en=v_inicio,termina_en=v_fin,renueva_en=v_fin,updated_at=v_inicio where id=s.id;
  elsif p_accion='piloto' then
    v_fin := v_inicio + interval '14 days';
    update public.organizacion_pagos set estado='anulado',verificado_por_admin=left(p_admin,254),notas=case when notas='' then 'Pago anulado al conceder piloto.' else notas || E'\nPago anulado al conceder piloto.' end
      where suscripcion_id=s.id and estado in ('pendiente','comprobante_recibido');
    update public.organizacion_suscripciones set estado='piloto',inicia_en=v_inicio,termina_en=v_fin,renueva_en=null,updated_at=v_inicio where id=s.id;
  else
    update public.organizacion_pagos set estado='rechazado',verificado_por_admin=left(p_admin,254) where suscripcion_id=s.id and estado in ('pendiente','comprobante_recibido');
    update public.organizacion_suscripciones set estado='cancelada',updated_at=v_inicio where id=s.id;
  end if;
  insert into public.planta_auditoria(organizacion_id,actor_externo,accion,entidad,entidad_id,detalles)
    values(s.organizacion_id,left(p_admin,254),case when p_accion='piloto' then 'piloto_activado' when p_accion='activar' then 'pago_verificado_plan_activado' else 'solicitud_plan_rechazada' end,
      'suscripcion',s.id::text,jsonb_build_object('termina_en',v_fin,'accion',p_accion));
  return jsonb_build_object('id',s.id,'accion',p_accion,'termina_en',v_fin);
end $$;
revoke all on function public.organizacion_admin_resolver_solicitud(uuid,text,text) from public,anon,authenticated;
grant execute on function public.organizacion_admin_resolver_solicitud(uuid,text,text) to service_role;

commit;
