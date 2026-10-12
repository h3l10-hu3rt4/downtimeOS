-- Cada persona registra y verifica su propio teléfono WhatsApp por membresía.
-- Las tablas son internas: la aplicación accede solo desde APIs de servidor.
begin;

create table if not exists public.planta_whatsapp_contactos (
  user_id uuid not null,
  planta_id uuid not null,
  organizacion_id uuid not null references public.organizaciones(id) on delete cascade,
  telefono_e164 text not null check (telefono_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  consentimiento_en timestamptz not null,
  verificado_en timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, planta_id),
  constraint planta_whatsapp_contactos_membresia_fkey
    foreign key (user_id, planta_id)
    references public.planta_membresias(user_id, planta_id) on delete cascade
);
create index if not exists planta_whatsapp_contactos_destino_idx
  on public.planta_whatsapp_contactos(planta_id, verificado_en)
  where verificado_en is not null;

create table if not exists public.planta_whatsapp_verificaciones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  planta_id uuid not null,
  codigo_hash text not null unique check (codigo_hash ~ '^[a-f0-9]{64}$'),
  expira_en timestamptz not null,
  intentos smallint not null default 0 check (intentos between 0 and 5),
  consumido_en timestamptz,
  created_at timestamptz not null default now(),
  constraint planta_whatsapp_verificaciones_contacto_fkey
    foreign key (user_id, planta_id)
    references public.planta_whatsapp_contactos(user_id, planta_id) on delete cascade
);
create index if not exists planta_whatsapp_verificaciones_expira_idx
  on public.planta_whatsapp_verificaciones(expira_en)
  where consumido_en is null;

alter table public.planta_whatsapp_contactos enable row level security;
alter table public.planta_whatsapp_verificaciones enable row level security;
revoke all on table public.planta_whatsapp_contactos, public.planta_whatsapp_verificaciones
  from public, anon, authenticated;
grant select, insert, update, delete on table public.planta_whatsapp_contactos,
  public.planta_whatsapp_verificaciones to service_role;

comment on table public.planta_whatsapp_contactos is
  'Contacto WhatsApp individual, con consentimiento y comprobación de control del número por cada membresía/planta.';
comment on table public.planta_whatsapp_verificaciones is
  'Desafíos de verificación inbound; solo guarda SHA-256 del token y caducidad, nunca el token en claro.';

commit;
