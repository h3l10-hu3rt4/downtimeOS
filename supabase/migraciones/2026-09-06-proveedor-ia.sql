-- Selector público limitado de proveedor de IA para la demo.
-- No guarda secretos ni IDs de modelo; solo gemini | anthropic por área.
create table if not exists public.planta_proveedor_ia (
  enfoque text primary key check (enfoque in ('finanzas', 'operaciones')),
  proveedor text not null check (proveedor in ('gemini', 'anthropic')),
  updated_at timestamptz not null default now()
);

insert into public.planta_proveedor_ia (enfoque, proveedor) values
  ('finanzas', 'gemini'),
  ('operaciones', 'gemini')
on conflict (enfoque) do nothing;
