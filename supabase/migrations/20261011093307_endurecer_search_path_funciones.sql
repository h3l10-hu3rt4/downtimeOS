-- Fija el search_path de helpers que se ejecutan desde PostgREST/funciones.
-- Todas las referencias a objetos de la aplicación ya están cualificadas como
-- public.<objeto>, por lo que un path vacío evita resolución ambigua.
alter function public.planta_zona()
  set search_path = '';
alter function public.planta_turno(timestamptz)
  set search_path = '';
alter function public.planta_jornada(timestamptz)
  set search_path = '';
alter function public.planta_factor_capacidad(text)
  set search_path = '';
alter function public.planta_factor_capacidad(text, uuid)
  set search_path = '';
alter function public.planta_tarifa_aplicable(text)
  set search_path = '';
alter function public.planta_tarifa_aplicable(text, uuid)
  set search_path = '';
alter function public.tocar_updated_at()
  set search_path = '';

-- La aplicación invoca estas funciones con la llave server-side service_role.
-- No se exponen vía RPC a anon/authenticated; no modificar permisos de tablas.
revoke execute on function public.planta_factor_capacidad(text) from public, anon, authenticated;
revoke execute on function public.planta_factor_capacidad(text, uuid) from public, anon, authenticated;
revoke execute on function public.planta_tarifa_aplicable(text) from public, anon, authenticated;
revoke execute on function public.planta_tarifa_aplicable(text, uuid) from public, anon, authenticated;
