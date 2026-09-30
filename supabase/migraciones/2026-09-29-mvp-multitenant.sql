-- DowntimeOS MVP comercial: organizaciones, plantas y perfiles reales.
-- Ejecutar DESPUÉS de las migraciones existentes. Supabase ya es PostgreSQL;
-- este diseño conserva Auth, Storage y RLS sin administrar otro servidor.
begin;

create table if not exists public.organizaciones (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (char_length(trim(nombre)) between 2 and 160),
  created_at timestamptz not null default now()
);

create table if not exists public.plantas (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones(id) on delete cascade,
  nombre text not null check (char_length(trim(nombre)) between 2 and 160),
  codigo text not null default upper(substr(md5(random()::text), 1, 8)),
  zona_horaria text not null default 'America/Monterrey',
  activa boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organizacion_id, codigo)
);

alter table public.planta_perfiles add column if not exists organizacion_id uuid references public.organizaciones(id) on delete cascade;
alter table public.planta_perfiles add column if not exists planta_id uuid references public.plantas(id) on delete cascade;
alter table public.planta_perfiles add column if not exists updated_at timestamptz not null default now();
alter table public.planta_perfiles drop constraint if exists planta_perfiles_rol_check;
alter table public.planta_perfiles add constraint planta_perfiles_rol_check check (rol in ('admin', 'direccion', 'operaciones', 'operador'));
create index if not exists planta_perfiles_planta_usuario_idx on public.planta_perfiles (planta_id, user_id);

-- Estas columnas preparan el aislamiento por planta. Las instalaciones que ya
-- tienen la demo deben migrar sus datos a una planta creada previamente antes
-- de activar RLS; no se asigna una planta a ciegas para no mezclar empresas.
alter table public.planta_lineas add column if not exists planta_id uuid references public.plantas(id) on delete cascade;
alter table public.planta_activos add column if not exists planta_id uuid references public.plantas(id) on delete cascade;
alter table public.planta_estados add column if not exists planta_id uuid references public.plantas(id) on delete cascade;
alter table public.planta_eventos add column if not exists planta_id uuid references public.plantas(id) on delete cascade;
alter table public.planta_solicitudes add column if not exists planta_id uuid references public.plantas(id) on delete cascade;
alter table public.planta_cancelaciones add column if not exists planta_id uuid references public.plantas(id) on delete cascade;
alter table public.planta_analisis_ia add column if not exists planta_id uuid references public.plantas(id) on delete cascade;
alter table public.planta_reportes add column if not exists planta_id uuid references public.plantas(id) on delete cascade;
alter table public.planta_mensajes add column if not exists planta_id uuid references public.plantas(id) on delete cascade;

create index if not exists planta_lineas_tenant_idx on public.planta_lineas(planta_id, orden);
create index if not exists planta_activos_tenant_idx on public.planta_activos(planta_id, linea_id);
create index if not exists planta_eventos_tenant_idx on public.planta_eventos(planta_id, inicio desc);
create index if not exists planta_solicitudes_tenant_idx on public.planta_solicitudes(planta_id, estado, desde desc);

alter table public.organizaciones enable row level security;
alter table public.plantas enable row level security;

-- El JWT solo permite leer la organización/planta que aparece en su perfil.
-- Los Route Handlers usan service_role y verifican el perfil antes de operar;
-- estas políticas protegen cualquier acceso futuro con la clave anónima.
create policy "perfil lee su organizacion" on public.organizaciones for select to authenticated
using (id in (select organizacion_id from public.planta_perfiles where user_id = auth.uid() and activo));
create policy "perfil lee su planta" on public.plantas for select to authenticated
using (id in (select planta_id from public.planta_perfiles where user_id = auth.uid() and activo));
create policy "usuario lee su perfil" on public.planta_perfiles for select to authenticated using (user_id = auth.uid());

commit;

-- IMPORTANTE: para instalaciones existentes, antes de hacer obligatoria la
-- planta se conserva el histórico en una organización técnica Legacy.
do $$
declare legacy_org uuid; legacy_planta uuid;
begin
  select id into legacy_org from public.organizaciones where nombre = 'Histórico DowntimeOS';
  if legacy_org is null then insert into public.organizaciones(nombre) values ('Histórico DowntimeOS') returning id into legacy_org; end if;
  select id into legacy_planta from public.plantas where organizacion_id = legacy_org and codigo = 'LEGACY';
  if legacy_planta is null then insert into public.plantas(organizacion_id,nombre,codigo) values (legacy_org,'Planta histórica','LEGACY') returning id into legacy_planta; end if;
  update public.planta_lineas set planta_id=legacy_planta where planta_id is null;
  update public.planta_activos set planta_id=legacy_planta where planta_id is null;
  update public.planta_estados set planta_id=legacy_planta where planta_id is null;
  update public.planta_eventos set planta_id=legacy_planta where planta_id is null;
  update public.planta_solicitudes set planta_id=legacy_planta where planta_id is null;
  update public.planta_cancelaciones set planta_id=legacy_planta where planta_id is null;
  update public.planta_analisis_ia set planta_id=legacy_planta where planta_id is null;
  update public.planta_reportes set planta_id=legacy_planta where planta_id is null;
  update public.planta_mensajes set planta_id=legacy_planta where planta_id is null;
end $$;

-- Los códigos de operación se vuelven únicos dentro de una planta, no a nivel
-- global. Esto permite que todas las empresas tengan una Línea 01 y M-01.
alter table public.planta_activos drop constraint if exists planta_activos_linea_id_fkey;
alter table public.planta_estados drop constraint if exists planta_estados_activo_id_fkey;
alter table public.planta_eventos drop constraint if exists planta_eventos_activo_id_fkey;
alter table public.planta_solicitudes drop constraint if exists planta_solicitudes_activo_id_fkey;
alter table public.planta_mensajes drop constraint if exists planta_mensajes_evento_folio_fkey;
alter table public.planta_lineas drop constraint if exists planta_lineas_pkey;
alter table public.planta_activos drop constraint if exists planta_activos_pkey;
alter table public.planta_estados drop constraint if exists planta_estados_pkey;
alter table public.planta_eventos drop constraint if exists planta_eventos_pkey;
alter table public.planta_solicitudes drop constraint if exists planta_solicitudes_pkey;
alter table public.planta_lineas alter column planta_id set not null;
alter table public.planta_activos alter column planta_id set not null;
alter table public.planta_estados alter column planta_id set not null;
alter table public.planta_eventos alter column planta_id set not null;
alter table public.planta_solicitudes alter column planta_id set not null;
alter table public.planta_lineas add primary key (planta_id,id);
alter table public.planta_activos add primary key (planta_id,id);
alter table public.planta_estados add primary key (planta_id,activo_id);
alter table public.planta_eventos add primary key (planta_id,folio);
alter table public.planta_solicitudes add primary key (planta_id,folio);
alter table public.planta_activos add constraint planta_activos_linea_tenant_fkey foreign key (planta_id,linea_id) references public.planta_lineas(planta_id,id) on delete restrict;
alter table public.planta_estados add constraint planta_estados_activo_tenant_fkey foreign key (planta_id,activo_id) references public.planta_activos(planta_id,id) on delete cascade;
alter table public.planta_eventos add constraint planta_eventos_activo_tenant_fkey foreign key (planta_id,activo_id) references public.planta_activos(planta_id,id) on delete restrict;
alter table public.planta_solicitudes add constraint planta_solicitudes_activo_tenant_fkey foreign key (planta_id,activo_id) references public.planta_activos(planta_id,id) on delete restrict;
alter table public.planta_mensajes add constraint planta_mensajes_evento_tenant_fkey foreign key (planta_id,evento_folio) references public.planta_eventos(planta_id,folio) on delete set null;

-- La función de costo recibe la planta para no mezclar tarifas de M-01.
create or replace function public.planta_tarifa_aplicable(p_activo text, p_planta_id uuid)
returns numeric language sql stable as $$
  select coalesce((select sum(linea.tarifa_hora) from public.planta_activos linea where linea.planta_id=activo.planta_id and linea.linea_id=activo.linea_id and linea.activo),0)
       * public.planta_factor_capacidad(p_activo)
  from public.planta_activos activo where activo.planta_id=p_planta_id and activo.id=p_activo
$$;
