-- Restringe lecturas directas de costos y evita que una vista privilegiada
-- permita saltarse RLS. Ejecutar después de las migraciones multitenant.
begin;

-- La vista operativa corre con los permisos/RLS del usuario que consulta.
alter view if exists public.planta_bitacora set (security_invoker = true);
-- Algunas instalaciones históricas pueden no tener todas las vistas todavía;
-- no dejes que una vista ausente revierta los demás cierres de permisos.
do $$
declare vista text;
begin
  foreach vista in array array[
    'planta_bitacora','planta_pareto','planta_por_activo',
    'planta_por_turno_linea','planta_auditoria_costeo'
  ] loop
    if to_regclass(format('public.%I', vista)) is not null then
      execute format('revoke all on table public.%I from public, anon, authenticated', vista);
    end if;
  end loop;
end $$;

-- El rol autenticado conserva acceso a los datos operativos del paro, pero no
-- puede consultar tarifa_aplicada/costo_mxn desde PostgREST directamente.
revoke select on table public.planta_eventos from public, anon, authenticated;
grant select (
  planta_id, folio, activo_id, causa_id, causa_libre, minutos, inicio,
  jornada, turno, retroactivo, origen, nota, registrado_por, created_at
) on public.planta_eventos to authenticated;

commit;
