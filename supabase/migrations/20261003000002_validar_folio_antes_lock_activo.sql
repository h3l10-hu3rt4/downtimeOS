-- Un folio inexistente no debe bloquear un activo ajeno de la misma planta.
-- Conserva el orden de locks activo -> solicitud usado por STOP y cierre.
begin;

create or replace function public.planta_descartar_solicitud(
  p_planta_id uuid,
  p_folio text,
  p_resuelta_por text default ''
) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare
  v_activo public.planta_activos%rowtype;
  v_solicitud public.planta_solicitudes%rowtype;
  v_estado public.planta_estados%rowtype;
  v_maquina_liberada boolean := false;
begin
  -- Resolver el folio primero, sin lock. No existe riesgo de elegir/bloquear
  -- cualquier activo de la planta cuando la subconsulta no encuentra filas.
  select * into v_solicitud from public.planta_solicitudes
    where planta_id=p_planta_id and folio=p_folio;
  if not found then
    raise exception 'La solicitud no existe en esta planta.' using errcode='P0002';
  end if;

  -- Mantener el orden compartido con STOP y cierre para evitar deadlocks:
  -- primero el activo referenciado por el folio válido, después la solicitud.
  select * into v_activo from public.planta_activos
    where planta_id=p_planta_id and id=v_solicitud.activo_id and activo
    for update;
  if not found then
    raise exception 'El equipo del reporte no existe o está inactivo.' using errcode='P0002';
  end if;
  select * into v_solicitud from public.planta_solicitudes
    where planta_id=p_planta_id and folio=p_folio for update;
  if not found then
    raise exception 'La solicitud no existe en esta planta.' using errcode='P0002';
  end if;

  update public.planta_solicitudes set estado='rechazada',causa_validada_id=causa_id,
    validada_en=clock_timestamp(),resuelta_por=left(coalesce(p_resuelta_por,''),120)
    where planta_id=p_planta_id and folio=p_folio returning * into v_solicitud;

  if not exists(select 1 from public.planta_solicitudes
      where planta_id=p_planta_id and activo_id=v_solicitud.activo_id
        and not cerrada and estado<>'rechazada' and folio<>p_folio) then
    select * into v_estado from public.planta_estados
      where planta_id=p_planta_id and activo_id=v_solicitud.activo_id for update;
    if found and v_estado.estado='STOP' then
      update public.planta_estados set estado='RUN',desde=clock_timestamp(),causa_id=null,
        causa_libre=null,actualizado_en=clock_timestamp()
        where planta_id=p_planta_id and activo_id=v_solicitud.activo_id;
      v_maquina_liberada := true;
    else
      v_maquina_liberada := true;
    end if;
    update public.planta_solicitudes set cerrada=true
      where planta_id=p_planta_id and activo_id=v_solicitud.activo_id and not cerrada;
  end if;

  select * into v_solicitud from public.planta_solicitudes
    where planta_id=p_planta_id and folio=p_folio;
  return jsonb_build_object('solicitud',to_jsonb(v_solicitud),'maquina_liberada',v_maquina_liberada);
end;
$$;

revoke all on function public.planta_descartar_solicitud(uuid,text,text) from public,anon,authenticated;
grant execute on function public.planta_descartar_solicitud(uuid,text,text) to service_role;

commit;
