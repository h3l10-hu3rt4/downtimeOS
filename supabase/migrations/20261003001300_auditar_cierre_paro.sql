-- Cierra el paro y deja identificado al actor autenticado en la misma
-- transacción. El RPC interno sin actor deja de estar disponible para
-- service_role; las llamadas de producto pasan por esta envoltura auditada.
begin;

create or replace function public.planta_cerrar_paro_auditado(
  p_organizacion_id uuid,
  p_planta_id uuid,
  p_usuario_id uuid,
  p_activo_id text,
  p_registrado_por text default '',
  p_origen text default 'piso'
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_resultado jsonb;
  v_folio text;
begin
  if p_usuario_id is null or not exists (
    select 1 from public.planta_membresias m
    where m.organizacion_id=p_organizacion_id and m.planta_id=p_planta_id
      and m.user_id=p_usuario_id and m.activo
  ) then
    raise exception 'No tienes una membresía activa en esta planta.' using errcode='42501';
  end if;

  v_resultado := public.planta_cerrar_paro(
    p_planta_id, p_activo_id, p_registrado_por, p_origen
  );
  v_folio := v_resultado #>> '{evento,folio}';
  if nullif(v_folio,'') is null then
    raise exception 'El cierre no devolvió un folio de auditoría.' using errcode='23514';
  end if;

  insert into public.planta_auditoria(
    organizacion_id,planta_id,actor_id,accion,entidad,entidad_id,detalles
  ) values (
    p_organizacion_id,p_planta_id,p_usuario_id,'paro_cerrado','evento',v_folio,
    jsonb_build_object('activo_id',p_activo_id,'origen',p_origen)
  );
  return v_resultado;
end;
$$;

revoke all on function public.planta_cerrar_paro_auditado(uuid,uuid,uuid,text,text,text)
  from public,anon,authenticated;
grant execute on function public.planta_cerrar_paro_auditado(uuid,uuid,uuid,text,text,text)
  to service_role;
revoke all on function public.planta_cerrar_paro(uuid,text,text,text) from service_role;

notify pgrst, 'reload schema';

commit;
