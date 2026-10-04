begin;

-- Los registros históricos mensuales se conservan, pero una solicitud que
-- quedó pendiente no debe poder convertirse ahora en una suscripción activa.
create or replace function public.planta_bloquear_activacion_periodo_legacy()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.estado in ('activa', 'piloto')
    and (new.periodicidad is null or new.periodicidad not in ('semestral', 'anual')) then
    raise exception 'Esta solicitud usa un periodo histórico no ofrecido. Recházala y solicita un periodo semestral o anual.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists organizacion_suscripciones_bloquear_periodo_legacy on public.organizacion_suscripciones;
create trigger organizacion_suscripciones_bloquear_periodo_legacy
  before update of estado, periodicidad on public.organizacion_suscripciones
  for each row execute function public.planta_bloquear_activacion_periodo_legacy();

revoke all on function public.planta_bloquear_activacion_periodo_legacy() from public, anon, authenticated;

commit;
