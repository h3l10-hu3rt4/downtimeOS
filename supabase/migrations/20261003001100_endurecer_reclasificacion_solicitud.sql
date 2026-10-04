-- La corrección de causa solo aplica mientras el reporte siga pendiente y
-- abierto. Evita modificar retrospectivamente una resolución/cierre.
begin;

create or replace function public.planta_reclasificar_solicitud(
  p_planta_id uuid,
  p_folio text,
  p_causa_id text,
  p_causa_libre text default null
) returns public.planta_solicitudes
language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  v_solicitud public.planta_solicitudes%rowtype;
  v_causa public.planta_causas%rowtype;
  v_libre text;
begin
  select * into v_solicitud from public.planta_solicitudes
    where planta_id=p_planta_id and folio=p_folio for update;
  if not found then
    raise exception 'La solicitud no existe en esta planta.' using errcode='P0002';
  end if;
  if v_solicitud.estado <> 'pendiente' or v_solicitud.cerrada then
    raise exception 'La solicitud ya fue resuelta o cerrada.' using errcode='23514';
  end if;

  select * into v_causa from public.planta_causas where id=p_causa_id;
  if not found then
    raise exception 'La causa no existe en el catálogo.' using errcode='22023';
  end if;
  v_libre := nullif(left(trim(coalesce(p_causa_libre,'')),120),'');
  if v_causa.requiere_texto and coalesce(length(v_libre),0)<3 then
    raise exception 'La causa «Otros» necesita una descripción de al menos 3 caracteres.' using errcode='22023';
  end if;
  if not v_causa.requiere_texto then v_libre := null; end if;

  update public.planta_solicitudes set causa_id=v_causa.id,causa_libre=v_libre
    where planta_id=p_planta_id and folio=p_folio returning * into v_solicitud;
  return v_solicitud;
end;
$$;

revoke all on function public.planta_reclasificar_solicitud(uuid,text,text,text)
  from public,anon,authenticated;
grant execute on function public.planta_reclasificar_solicitud(uuid,text,text,text)
  to service_role;

commit;
