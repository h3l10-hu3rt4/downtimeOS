-- La cancelación del historial es una sola transacción: no puede quedar
-- el rastro de cancelación creado mientras el evento sigue apareciendo activo.
begin;

create or replace function public.planta_cancelar_evento(
  p_planta_id uuid,
  p_folio text,
  p_motivo text default '',
  p_cancelado_por text default ''
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_evento public.planta_eventos%rowtype;
begin
  if p_planta_id is null or nullif(trim(p_folio), '') is null then
    raise exception 'Se requiere la planta y el folio del evento.' using errcode = '22023';
  end if;

  select * into v_evento
  from public.planta_eventos
  where planta_id = p_planta_id and folio = p_folio
  for update;
  if not found then
    raise exception 'El evento no existe en esta planta.' using errcode = 'P0002';
  end if;

  insert into public.planta_cancelaciones(
    planta_id, folio_evento, activo_id, causa_id, minutos, inicio, motivo, cancelado_por
  ) values (
    p_planta_id, v_evento.folio, v_evento.activo_id, v_evento.causa_id,
    v_evento.minutos, v_evento.inicio,
    left(coalesce(nullif(trim(p_motivo), ''), 'Sin motivo declarado'), 500),
    left(coalesce(p_cancelado_por, ''), 120)
  );

  delete from public.planta_eventos
  where planta_id = p_planta_id and folio = p_folio;
  if not found then
    raise exception 'El evento cambió mientras se cancelaba.' using errcode = '40001';
  end if;

  return jsonb_build_object('folio', v_evento.folio, 'cancelado', true);
end;
$$;

revoke all on function public.planta_cancelar_evento(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.planta_cancelar_evento(uuid, text, text, text)
  to service_role;

commit;
