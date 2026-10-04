-- Las preferencias globales de proveedores e interruptores solo se operan
-- desde rutas de servidor. Las llaves públicas no deben leerlas ni mutarlas
-- directamente por PostgREST.
begin;

-- Las tablas creadas por el rol de migraciones `postgres` pueden heredar
-- GRANT ALL para llaves públicas. El producto solo usa PostgREST desde el
-- servidor; las excepciones futuras deberán otorgar permisos explícitos.
alter default privileges for role postgres in schema public
  revoke all privileges on tables from anon, authenticated;

alter table public.planta_proveedor_ia enable row level security;
revoke all privileges on table public.planta_proveedor_ia from public, anon, authenticated;
grant select, insert, update, delete on table public.planta_proveedor_ia to service_role;

alter table public.planta_interruptores_integraciones enable row level security;
revoke all privileges on table public.planta_interruptores_integraciones from public, anon, authenticated;
grant select, insert, update, delete on table public.planta_interruptores_integraciones to service_role;

-- Estas filas contienen análisis financieros/operativos en JSON, teléfonos y
-- contenido de mensajes, o rutas privadas de Storage. Los clientes solo las
-- consultan mediante APIs que ya validan rol y planta.
revoke all privileges on table public.planta_analisis_ia, public.planta_mensajes, public.planta_reportes
  from public, anon, authenticated;
grant select, insert, update, delete on table public.planta_analisis_ia, public.planta_mensajes, public.planta_reportes
  to service_role;

-- La landing obtiene estadísticas agregadas a través de /api/leads/stats.
-- `leads_por_modelo` contiene empresas, folios y montos de prospectos; ninguna
-- vista necesita acceso REST directo desde el navegador.
revoke all privileges on table public.leads_por_modelo, public.leads_stats
  from public, anon, authenticated, service_role;
grant select on table public.leads_por_modelo, public.leads_stats to service_role;

commit;
