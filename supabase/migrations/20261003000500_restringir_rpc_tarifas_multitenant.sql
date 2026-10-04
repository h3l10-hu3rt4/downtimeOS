begin;

-- Las variantes tenant-aware también son de uso servidor: ningún cliente
-- navegador necesita invocarlas directamente. lib/planta.js y las RPC
-- transaccionales las ejecutan con service_role.
revoke execute on function public.planta_factor_capacidad(text, uuid)
  from public, anon, authenticated;
revoke execute on function public.planta_tarifa_aplicable(text, uuid)
  from public, anon, authenticated;

grant execute on function public.planta_factor_capacidad(text, uuid) to service_role;
grant execute on function public.planta_tarifa_aplicable(text, uuid) to service_role;

commit;
