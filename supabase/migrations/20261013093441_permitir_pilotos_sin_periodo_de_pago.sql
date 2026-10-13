begin;

-- Los pilotos duran 14 días y no corresponden a un ciclo de cobro. Permite
-- periodicidad NULL mientras estado='piloto'; el paso a una suscripción paga
-- continúa exigiendo los periodos semestral o anual.
create or replace function public.rechazar_periodicidad_no_ofrecida()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.estado <> 'piloto'
    and (new.periodicidad is null or new.periodicidad not in ('semestral', 'anual')) then
    raise exception 'DowntimeOS solo ofrece periodos semestrales o anuales.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

create or replace function public.planta_bloquear_activacion_periodo_legacy()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Un piloto interno no tiene ciclo pagado. Al pasar a activa, el ciclo debe
  -- ser uno de los ofrecidos; conserva también el bloqueo de periodos legacy.
  if new.estado = 'activa'
    and (new.periodicidad is null or new.periodicidad not in ('semestral', 'anual')) then
    raise exception 'Esta solicitud usa un periodo histórico no ofrecido. Recházala y solicita un periodo semestral o anual.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.planta_bloquear_activacion_periodo_legacy() from public, anon, authenticated;

commit;
