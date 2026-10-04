-- ===========================================================================
-- DowntimeOS · Integraciones: IA, reportes PDF, WhatsApp y perfiles
-- Ejecutar después de schema-planta.sql. Es aditiva: no modifica semillas.
-- ===========================================================================
begin;

create table if not exists public.planta_perfiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  rol text not null check (rol in ('admin', 'direccion', 'operaciones', 'operador')),
  nombre text not null default '',
  planta_codigo text not null default 'DOWNTIMECO',
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.planta_analisis_ia (
  id uuid primary key default gen_random_uuid(),
  desde timestamptz,
  hasta timestamptz,
  modelo text not null,
  entrada jsonb not null,
  resultado jsonb not null,
  creado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists planta_analisis_ia_created_idx
  on public.planta_analisis_ia (created_at desc);

create table if not exists public.planta_reportes (
  id uuid primary key default gen_random_uuid(),
  analisis_id uuid references public.planta_analisis_ia(id) on delete set null,
  desde timestamptz,
  hasta timestamptz,
  storage_path text not null unique,
  creado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.planta_mensajes (
  id uuid primary key default gen_random_uuid(),
  canal text not null default 'whatsapp' check (canal = 'whatsapp'),
  destinatario text not null,
  contenido text not null,
  estado text not null default 'pendiente' check (estado in (
    'pendiente', 'queued', 'sent', 'delivered', 'read', 'failed', 'undelivered'
  )),
  proveedor_id text unique,
  evento_folio text references public.planta_eventos(folio) on delete set null,
  reporte_id uuid references public.planta_reportes(id) on delete set null,
  error text,
  metadatos jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists planta_mensajes_created_idx
  on public.planta_mensajes (created_at desc);
create index if not exists planta_mensajes_evento_idx
  on public.planta_mensajes (evento_folio) where evento_folio is not null;

alter table public.planta_perfiles enable row level security;
alter table public.planta_analisis_ia enable row level security;
alter table public.planta_reportes enable row level security;
alter table public.planta_mensajes enable row level security;

-- Bucket privado. Los PDFs se comparten mediante URLs firmadas de corta vida.
insert into storage.buckets (id, name, public)
values ('reportes', 'reportes', false)
on conflict (id) do nothing;

commit;
