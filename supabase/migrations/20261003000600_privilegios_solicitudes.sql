-- Las solicitudes contienen la identidad interna de quien reportó el paro.
-- El navegador consume este recurso exclusivamente a través de las APIs del
-- servidor, que aplican planta y rol; no necesita leer la tabla por PostgREST.
begin;

revoke all privileges on table public.planta_solicitudes from anon, authenticated;

-- REVOKE a nivel de tabla no elimina grants independientes por columna.
do $$
declare
  columnas text;
begin
  select string_agg(format('%I', column_name), ', ' order by ordinal_position)
    into columnas
    from information_schema.columns
   where table_schema = 'public' and table_name = 'planta_solicitudes';
  if columnas is not null then
    execute format(
      'revoke select (%s) on table public.planta_solicitudes from anon, authenticated',
      columnas
    );
  end if;
end;
$$;

commit;
