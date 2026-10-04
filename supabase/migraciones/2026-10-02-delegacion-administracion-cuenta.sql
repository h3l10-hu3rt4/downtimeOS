-- Administración delegada de la cuenta, separada de su titularidad legal.
-- Aplicar después de todas las migraciones MVP de cuentas y equipo.
begin;

create table if not exists public.organizacion_admin_delegados (
  organizacion_id uuid not null references public.organizaciones(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  concedido_por uuid not null references auth.users(id) on delete restrict,
  concedido_en timestamptz not null default now(),
  primary key (organizacion_id, user_id)
);
create index if not exists organizacion_admin_delegados_usuario_idx
  on public.organizacion_admin_delegados(user_id, organizacion_id);
alter table public.organizacion_admin_delegados enable row level security;
revoke all on public.organizacion_admin_delegados from public, anon, authenticated;
grant all on public.organizacion_admin_delegados to service_role;

create or replace function public.planta_admin_delegar_cuenta(
  p_organizacion_id uuid,
  p_planta_id uuid,
  p_actor_id uuid,
  p_objetivo_id uuid,
  p_delegar boolean
) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp
as $$
declare
  v_propietario uuid;
  v_nombre text;
begin
  select propietario_id into v_propietario from public.organizaciones
    where id=p_organizacion_id for update;
  if not found then raise exception 'No encontramos la cuenta.' using errcode='P0002'; end if;
  if v_propietario is distinct from p_actor_id then
    raise exception 'Solo el titular puede conceder o revocar administración delegada.' using errcode='42501';
  end if;
  if p_objetivo_id is null or p_objetivo_id=v_propietario then
    raise exception 'La titularidad no se delega ni se modifica desde el equipo.' using errcode='42501';
  end if;
  if not exists(select 1 from public.planta_membresias
    where organizacion_id=p_organizacion_id and planta_id=p_planta_id
      and user_id=p_actor_id and activo) then
    raise exception 'El titular no tiene una membresía activa en esta planta.' using errcode='42501';
  end if;
  select nombre into v_nombre from public.planta_membresias
    where organizacion_id=p_organizacion_id and planta_id=p_planta_id
      and user_id=p_objetivo_id and activo for update;
  if not found or not exists(select 1 from public.planta_invitaciones
    where organizacion_id=p_organizacion_id and planta_id=p_planta_id
      and auth_user_id=p_objetivo_id and estado='aceptada') then
    raise exception 'La persona debe ser miembro activo de esta planta.' using errcode='P0002';
  end if;

  if p_delegar then
    insert into public.organizacion_admin_delegados(organizacion_id,user_id,concedido_por,concedido_en)
      values(p_organizacion_id,p_objetivo_id,p_actor_id,clock_timestamp())
      on conflict(organizacion_id,user_id) do update
        set concedido_por=excluded.concedido_por, concedido_en=excluded.concedido_en;
    update public.planta_membresias set es_admin_cuenta=true
      where organizacion_id=p_organizacion_id and user_id=p_objetivo_id;
    update public.planta_perfiles set es_admin_cuenta=true
      where organizacion_id=p_organizacion_id and user_id=p_objetivo_id;
    update public.planta_invitaciones set es_admin_cuenta=true
      where organizacion_id=p_organizacion_id and auth_user_id=p_objetivo_id
        and estado in ('pendiente','aceptada');
  else
    delete from public.organizacion_admin_delegados
      where organizacion_id=p_organizacion_id and user_id=p_objetivo_id;
    update public.planta_membresias set es_admin_cuenta=false
      where organizacion_id=p_organizacion_id and user_id=p_objetivo_id;
    update public.planta_perfiles set es_admin_cuenta=false
      where organizacion_id=p_organizacion_id and user_id=p_objetivo_id;
    update public.planta_invitaciones set es_admin_cuenta=false
      where organizacion_id=p_organizacion_id and auth_user_id=p_objetivo_id
        and estado in ('pendiente','aceptada');
  end if;

  insert into public.planta_auditoria(organizacion_id,planta_id,actor_id,accion,entidad,entidad_id,detalles)
    values(p_organizacion_id,p_planta_id,p_actor_id,
      case when p_delegar then 'administracion_cuenta_delegada' else 'administracion_cuenta_revocada' end,
      'usuario',p_objetivo_id::text,jsonb_build_object('nombre',v_nombre));
  return jsonb_build_object('user_id',p_objetivo_id,'es_admin_cuenta',p_delegar);
end $$;
revoke all on function public.planta_admin_delegar_cuenta(uuid,uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.planta_admin_delegar_cuenta(uuid,uuid,uuid,uuid,boolean) to service_role;

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
  if p_rol not in ('direccion','finanzas','operaciones','operador') then raise exception 'Rol no válido.' using errcode='22023'; end if;
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
revoke all on function public.planta_admin_cambiar_miembro(uuid,uuid,uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.planta_admin_cambiar_miembro(uuid,uuid,uuid,uuid,text,boolean) to service_role;

create or replace function public.planta_admin_revocar_miembro(
  p_organizacion_id uuid,p_planta_id uuid,p_actor_id uuid,p_invitacion_id uuid
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
  select * into i from public.planta_invitaciones
    where id=p_invitacion_id and organizacion_id=p_organizacion_id and planta_id=p_planta_id for update;
  if not found or i.estado not in ('pendiente','aceptada') then raise exception 'La invitación ya no está activa.' using errcode='P0002'; end if;
  if i.auth_user_id is null or i.auth_user_id=v_propietario then
    raise exception 'No se puede revocar el acceso del titular desde el equipo.' using errcode='42501';
  end if;
  select exists(select 1 from public.organizacion_admin_delegados d
      where d.organizacion_id=p_organizacion_id and d.user_id=i.auth_user_id)
    into v_objetivo_admin;
  if p_actor_id=v_propietario and v_objetivo_admin then
    raise exception 'Revoca primero la administración delegada; después podrás quitar el acceso a esta planta.' using errcode='23514';
  end if;
  if p_actor_id is distinct from v_propietario and (v_objetivo_admin or i.es_admin_cuenta) then
    raise exception 'Los administradores delegados no pueden revocar a otros delegados.' using errcode='42501';
  end if;
  update public.planta_membresias set activo=false
    where user_id=i.auth_user_id and planta_id=p_planta_id and organizacion_id=p_organizacion_id;
  update public.planta_perfiles set activo=false
    where user_id=i.auth_user_id and planta_id=p_planta_id and organizacion_id=p_organizacion_id;
  update public.planta_invitaciones set estado='revocada' where id=i.id;
  insert into public.planta_auditoria(organizacion_id,planta_id,actor_id,accion,entidad,entidad_id,detalles)
    values(p_organizacion_id,p_planta_id,p_actor_id,'invitacion_revocada','invitacion',i.id::text,
      jsonb_build_object('email',i.email,'rol',i.rol));
  return jsonb_build_object('id',i.id,'estado','revocada');
end $$;
revoke all on function public.planta_admin_revocar_miembro(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.planta_admin_revocar_miembro(uuid,uuid,uuid,uuid) to service_role;

-- Solo una invitación creada por el titular puede activar una delegación.
create or replace function public.planta_aceptar_invitacion(
  p_invitacion_id uuid,p_usuario_id uuid,p_email text,p_token_hash text
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  i public.planta_invitaciones%rowtype;
  m public.planta_membresias%rowtype;
  v_propietario uuid;
  v_admin_cuenta boolean;
begin
  if p_usuario_id is null or p_email is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'El enlace de invitación no es válido.' using errcode='42501';
  end if;
  select * into i from public.planta_invitaciones where id=p_invitacion_id for update;
  if not found or i.auth_user_id is distinct from p_usuario_id
    or lower(trim(i.email)) is distinct from lower(trim(p_email))
    or i.acceptance_token_hash is distinct from p_token_hash then
    raise exception 'El enlace no corresponde a esta cuenta.' using errcode='42501';
  end if;
  select propietario_id into v_propietario from public.organizaciones
    where id=i.organizacion_id for update;
  if v_propietario is null or p_usuario_id=v_propietario then
    raise exception 'El titular no puede aceptar una invitación de equipo.' using errcode='42501';
  end if;
  if i.es_admin_cuenta and i.invitada_por is distinct from v_propietario then
    raise exception 'Una delegación solo puede concederla el titular.' using errcode='42501';
  end if;
  if i.estado='aceptada' then
    select * into m from public.planta_membresias where user_id=i.auth_user_id
      and organizacion_id=i.organizacion_id and planta_id=i.planta_id and activo for update;
    if not found then raise exception 'La invitación ya no está activa.' using errcode='P0002'; end if;
    return jsonb_build_object('invitacion_id',i.id,'planta_id',i.planta_id,'estado','aceptada');
  end if;
  if i.estado<>'pendiente' then raise exception 'La invitación ya no está vigente.' using errcode='P0002'; end if;
  if i.expires_at<=clock_timestamp() then raise exception 'La invitación venció; solicita que la reenvíen.' using errcode='P0002'; end if;

  v_admin_cuenta := i.es_admin_cuenta or exists(select 1 from public.organizacion_admin_delegados d
    where d.organizacion_id=i.organizacion_id and d.user_id=i.auth_user_id);
  update public.planta_membresias set activo=true,rol=i.rol,nombre=i.nombre,
      es_admin_cuenta=v_admin_cuenta,puede_administrar_facturacion=i.puede_administrar_facturacion
    where user_id=i.auth_user_id and organizacion_id=i.organizacion_id and planta_id=i.planta_id and not activo;
  if not found then raise exception 'No existe una membresía pendiente para esta invitación.' using errcode='P0002'; end if;
  update public.planta_perfiles set activo=true,rol=i.rol,nombre=i.nombre,
      es_admin_cuenta=v_admin_cuenta,puede_administrar_facturacion=i.puede_administrar_facturacion
    where user_id=i.auth_user_id and organizacion_id=i.organizacion_id and planta_id=i.planta_id;
  if i.es_admin_cuenta then
    insert into public.organizacion_admin_delegados(organizacion_id,user_id,concedido_por,concedido_en)
      values(i.organizacion_id,i.auth_user_id,i.invitada_por,clock_timestamp())
      on conflict(organizacion_id,user_id) do nothing;
    update public.planta_membresias set es_admin_cuenta=true
      where organizacion_id=i.organizacion_id and user_id=i.auth_user_id;
    update public.planta_perfiles set es_admin_cuenta=true
      where organizacion_id=i.organizacion_id and user_id=i.auth_user_id;
  end if;
  update public.planta_invitaciones set estado='aceptada',aceptada_en=clock_timestamp() where id=i.id and estado='pendiente';
  insert into public.planta_auditoria(organizacion_id,planta_id,actor_id,accion,entidad,entidad_id,detalles)
    values(i.organizacion_id,i.planta_id,i.auth_user_id,'invitacion_aceptada','invitacion',i.id::text,
      jsonb_build_object('rol',i.rol,'administracion_delegada',i.es_admin_cuenta));
  return jsonb_build_object('invitacion_id',i.id,'planta_id',i.planta_id,'estado','aceptada');
end $$;
revoke all on function public.planta_aceptar_invitacion(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.planta_aceptar_invitacion(uuid,uuid,text,text) to service_role;

commit;
