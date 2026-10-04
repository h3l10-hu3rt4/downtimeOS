-- Defensa en profundidad: clientes Auth solo leen lo permitido por RLS.
-- Toda escritura de la aplicación pasa por las APIs de servidor con service_role.
begin;

revoke insert, update, delete, truncate, references, trigger
  on all tables in schema public from anon, authenticated;
-- El navegador no consulta tablas públicas directamente: toda lectura pasa por
-- las APIs, que aplican sesión, planta y rol. No dar acceso REST al rol anon.
revoke select on all tables in schema public from anon;
revoke usage, select, update
  on all sequences in schema public from anon, authenticated;

-- Los prospectos contienen datos de contacto y solo se consultan mediante la
-- API de servidor. RLS ya los bloqueaba, pero se retiran también los grants
-- de tabla y columna para que una política añadida por accidente no los exponga.
revoke all privileges on table public.leads from anon, authenticated;
do $$
declare
  columnas text;
begin
  select string_agg(format('%I', column_name), ', ' order by ordinal_position)
    into columnas
    from information_schema.columns
   where table_schema = 'public' and table_name = 'leads';
  if columnas is not null then
    execute format('revoke select (%s) on table public.leads from anon, authenticated', columnas);
  end if;
end;
$$;

-- La tarifa por hora de los activos tampoco se consulta directamente desde
-- el navegador: las APIs filtran el dato según el rol antes de responder.
revoke select (tarifa_hora) on table public.planta_activos from anon, authenticated;

-- Mantener el límite para objetos futuros creados por el rol de migraciones.
alter default privileges for role postgres in schema public
  revoke insert, update, delete, truncate, references, trigger
  on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke select on tables from anon;
alter default privileges for role postgres in schema public
  revoke usage, select, update on sequences from anon, authenticated;

commit;
