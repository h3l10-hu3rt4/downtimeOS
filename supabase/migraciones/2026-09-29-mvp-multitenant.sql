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
