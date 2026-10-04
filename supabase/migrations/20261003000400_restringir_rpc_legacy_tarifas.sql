begin;

-- Estas RPC históricas no reciben planta_id. La aplicación actual utiliza las
-- variantes multitenant; las de un argumento solo se conservan para tareas
-- internas heredadas y no deben estar disponibles para clientes REST.
revoke execute on function public.planta_factor_capacidad(text)
  from public, anon, authenticated;
revoke execute on function public.planta_tarifa_aplicable(text)
  from public, anon, authenticated;

-- Mantener la compatibilidad de tareas administrativas internas que aún
-- consulten la vista heredada de recálculo. Nunca se concede al navegador.
grant execute on function public.planta_factor_capacidad(text) to service_role;
grant execute on function public.planta_tarifa_aplicable(text) to service_role;

commit;
