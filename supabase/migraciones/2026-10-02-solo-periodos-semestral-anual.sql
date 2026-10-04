-- DowntimeOS no ofrece suscripciones mensuales. Mantiene intactas las filas
-- históricas, pero impide crear o convertir periodos nuevos a mensual.
begin;

create or replace function public.rechazar_periodicidad_no_ofrecida()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.periodicidad is null or new.periodicidad not in ('semestral', 'anual') then
    raise exception 'DowntimeOS solo ofrece periodos semestrales o anuales.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists organizacion_suscripciones_periodo_ofrecido on public.organizacion_suscripciones;
create trigger organizacion_suscripciones_periodo_ofrecido
  before insert or update of periodicidad on public.organizacion_suscripciones
  for each row execute function public.rechazar_periodicidad_no_ofrecida();

commit;
