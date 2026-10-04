-- Interruptores persistentes del panel /administracion.
-- El service_role de las funciones serverless es el único actor que los lee o
-- escribe; no hay acceso directo desde el navegador a esta tabla.
create table if not exists public.planta_interruptores_integraciones (
  clave text primary key check (clave = 'global'),
  ia_activa boolean not null default true,
  whatsapp_activa boolean not null default true,
  pdf_activa boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.planta_interruptores_integraciones (clave, ia_activa, whatsapp_activa, pdf_activa)
values ('global', true, true, true)
on conflict (clave) do nothing;

alter table public.planta_interruptores_integraciones enable row level security;
