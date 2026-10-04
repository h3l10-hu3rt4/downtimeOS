-- Dirección puede ver reportes financieros, por lo que solo la titularidad
-- autoriza conceder ese rol. Los delegados conservan control del equipo regular.
begin;

create or replace function public.planta_admin_cambiar_miembro(
  p_organizacion_id uuid,p_planta_id uuid,p_actor_id uuid,p_invitacion_id uuid,p_rol text,p_facturacion boolean
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  i public.planta_invitaciones%rowtype;
  v_propietario uuid;
  v_actor_admin boolean;
  v_objetivo_admin boolean;
begin
  select propietario_id into v_propietario from public.organizaciones
    where id=p_organizacion_id for update;
  if not found then raise exception 'No encontramos la cuenta.' using errcode='P0002'; end if;
  select exists(select 1 from public.organizacion_admin_delegados d
      where d.organizacion_id=p_organizacion_id and d.user_id=p_actor_id)
    into v_actor_admin;
  if p_actor_id is distinct from v_propietario and not v_actor_admin then
    raise exception 'No tienes permiso para administrar este equipo.' using errcode='42501';
  end if;
  if not exists(select 1 from public.planta_membresias
    where organizacion_id=p_organizacion_id and planta_id=p_planta_id and user_id=p_actor_id and activo) then
    raise exception 'No tienes una membresía activa en esta planta.' using errcode='42501';
  end if;
  if p_rol not in ('direccion','finanzas','operaciones','operador') then
    raise exception 'Rol no válido.' using errcode='22023';
  end if;
  if p_actor_id is distinct from v_propietario and (p_rol in ('direccion','finanzas') or coalesce(p_facturacion,false)) then
    raise exception 'Solo el titular puede asignar Dirección o Finanzas, o conceder acceso a facturación.' using errcode='42501';
  end if;
  select * into i from public.planta_invitaciones
    where id=p_invitacion_id and organizacion_id=p_organizacion_id and planta_id=p_planta_id for update;
  if not found or i.estado <> 'aceptada' then raise exception 'El miembro no está activo en esta planta.' using errcode='P0002'; end if;
  if i.auth_user_id is null or i.auth_user_id=v_propietario then
    raise exception 'No se puede cambiar el titular desde la administración del equipo.' using errcode='42501';
  end if;
  select exists(select 1 from public.organizacion_admin_delegados d
      where d.organizacion_id=p_organizacion_id and d.user_id=i.auth_user_id)
    into v_objetivo_admin;
  if p_actor_id is distinct from v_propietario and (v_objetivo_admin or i.es_admin_cuenta) then
    raise exception 'Los administradores delegados no pueden modificar a otros delegados.' using errcode='42501';
  end if;
  update public.planta_membresias set rol=p_rol,
      es_admin_cuenta=(p_actor_id=v_propietario and v_objetivo_admin),
      puede_administrar_facturacion=p_facturacion
    where user_id=i.auth_user_id and planta_id=p_planta_id and organizacion_id=p_organizacion_id and activo;
  if not found then raise exception 'No hay una membresía activa para este usuario.' using errcode='P0002'; end if;
  update public.planta_perfiles set rol=p_rol,es_admin_cuenta=(p_actor_id=v_propietario and v_objetivo_admin),
      puede_administrar_facturacion=p_facturacion
    where user_id=i.auth_user_id and planta_id=p_planta_id and organizacion_id=p_organizacion_id;
  update public.planta_invitaciones set rol=p_rol,puede_administrar_facturacion=p_facturacion where id=i.id;
  insert into public.planta_auditoria(organizacion_id,planta_id,actor_id,accion,entidad,entidad_id,detalles)
    values(p_organizacion_id,p_planta_id,p_actor_id,'permisos_usuario_actualizados','usuario',i.auth_user_id::text,
      jsonb_build_object('rol_anterior',i.rol,'rol_nuevo',p_rol,'facturacion',p_facturacion));
  return jsonb_build_object('id',i.id,'rol',p_rol,'puede_administrar_facturacion',p_facturacion);
end $$;

revoke all on function public.planta_admin_cambiar_miembro(uuid,uuid,uuid,uuid,text,boolean)
  from public,anon,authenticated;
grant execute on function public.planta_admin_cambiar_miembro(uuid,uuid,uuid,uuid,text,boolean)
  to service_role;

commit;
