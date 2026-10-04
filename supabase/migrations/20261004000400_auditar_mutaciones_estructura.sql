-- Las mutaciones de onboarding y estructura y su rastro de auditoría deben
-- confirmar juntas; un fallo al insertar auditoría revierte también el cambio.
begin;

create or replace function public.planta_configurar_inicial_auditada(
  p_planta_id uuid,
  p_usuario_id uuid,
  p_lineas jsonb,
  p_activos jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_organizacion_id uuid;
  v_resultado jsonb;
  v_lineas jsonb;
  v_activos jsonb;
begin
  select p.organizacion_id into v_organizacion_id
  from public.plantas p
  join public.planta_membresias m
    on m.planta_id = p.id and m.organizacion_id = p.organizacion_id
   and m.user_id = p_usuario_id and m.activo and m.rol in ('direccion','admin')
  where p.id = p_planta_id and p.activa
  for share of p, m;
  if not found then
    raise exception 'No tienes permiso para configurar esta planta.' using errcode = '42501';
  end if;

  v_resultado := public.planta_configurar_inicial(p_planta_id,p_usuario_id,p_lineas,p_activos);

  select coalesce(jsonb_agg(to_jsonb(l) order by l.orden,l.id),'[]'::jsonb)
    into v_lineas from public.planta_lineas l where l.planta_id = p_planta_id;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]'::jsonb)
    into v_activos from public.planta_activos a where a.planta_id = p_planta_id;

  insert into public.planta_auditoria(
    organizacion_id,planta_id,actor_id,accion,entidad,entidad_id,detalles
  ) values (
    v_organizacion_id,p_planta_id,p_usuario_id,'configuracion_inicial_creada','planta',p_planta_id::text,
    jsonb_build_object('resultado',v_resultado,'lineas',v_lineas,'activos',v_activos)
  );
  return v_resultado;
end;
$$;
revoke all on function public.planta_configurar_inicial_auditada(uuid,uuid,jsonb,jsonb)
  from public,anon,authenticated;
grant execute on function public.planta_configurar_inicial_auditada(uuid,uuid,jsonb,jsonb)
  to service_role;

create or replace function public.planta_actualizar_estructura_auditada(
  p_planta_id uuid,
  p_usuario_id uuid,
  p_accion text,
  p_linea jsonb default null,
  p_activo jsonb default null,
  p_id text default null
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_organizacion_id uuid;
  v_resultado jsonb;
  v_entidad text;
  v_entidad_id text;
  v_antes jsonb := null;
  v_despues jsonb;
begin
  select p.organizacion_id into v_organizacion_id
  from public.plantas p
  join public.planta_membresias m
    on m.planta_id = p.id and m.organizacion_id = p.organizacion_id
   and m.user_id = p_usuario_id and m.activo and m.rol in ('direccion','admin')
  where p.id = p_planta_id and p.activa
  for share of p, m;
  if not found then
    raise exception 'No tienes permiso para editar la estructura de esta planta.' using errcode = '42501';
  end if;

  if p_accion = 'actualizar_activo' then
    select to_jsonb(a) into v_antes from public.planta_activos a
     where a.planta_id = p_planta_id and a.id = p_activo->>'id'
     for update;
    v_entidad := 'activo';
  elsif p_accion in ('crear_linea','archivar_linea') then
    v_entidad := 'linea';
    if p_accion = 'archivar_linea' then
      select to_jsonb(l) into v_antes from public.planta_lineas l
       where l.planta_id = p_planta_id and l.id = p_id
       for update;
    end if;
  else
    v_entidad := 'activo';
    if p_accion = 'archivar_activo' then
      select to_jsonb(a) into v_antes from public.planta_activos a
       where a.planta_id = p_planta_id and a.id = p_id
       for update;
    end if;
  end if;

  if p_accion = 'actualizar_activo' then
    v_resultado := public.planta_editar_activo(p_planta_id,p_usuario_id,p_activo);
  else
    v_resultado := public.planta_actualizar_estructura(
      p_planta_id,p_usuario_id,p_accion,p_linea,p_activo,p_id
    );
  end if;
  v_entidad_id := case when v_entidad = 'activo'
    then coalesce(v_resultado->>'activo_id',v_resultado->>'linea_id')
    else v_resultado->>'linea_id'
  end;

  if v_entidad = 'linea' then
    select to_jsonb(l) into v_despues from public.planta_lineas l
     where l.planta_id = p_planta_id and l.id = v_entidad_id;
  else
    select to_jsonb(a) into v_despues from public.planta_activos a
     where a.planta_id = p_planta_id and a.id = v_entidad_id;
  end if;

  insert into public.planta_auditoria(
    organizacion_id,planta_id,actor_id,accion,entidad,entidad_id,detalles
  ) values (
    v_organizacion_id,p_planta_id,p_usuario_id,'estructura_'||p_accion,v_entidad,v_entidad_id,
    jsonb_build_object('resultado',v_resultado,'antes',v_antes,'despues',v_despues)
  );
  return v_resultado;
end;
$$;
revoke all on function public.planta_actualizar_estructura_auditada(uuid,uuid,text,jsonb,jsonb,text)
  from public,anon,authenticated;
grant execute on function public.planta_actualizar_estructura_auditada(uuid,uuid,text,jsonb,jsonb,text)
  to service_role;

notify pgrst, 'reload schema';
commit;
