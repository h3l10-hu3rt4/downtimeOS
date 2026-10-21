-- Reafirma el endurecimiento de permisos en instalaciones donde la migración
-- original ya fue aplicada antes de hacer opcional la tabla de respaldo de demo.
begin;

revoke select on table public.planta_causas from authenticated;

do $$
begin
  if to_regclass('public.planta_eventos_respaldo_duraciones') is not null then
    execute 'revoke select on table public.planta_eventos_respaldo_duraciones from authenticated';
  end if;
end
$$;

commit;
