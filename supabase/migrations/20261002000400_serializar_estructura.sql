-- Evita que el archivo de una línea compita con la creación de un equipo
-- asociado a ella. Ambas operaciones usan el lock raíz de la organización.
begin;

create or replace function public.planta_actualizar_estructura(
  p_planta_id uuid,
  p_usuario_id uuid,
  p_accion text,
  p_linea jsonb default null,
  p_activo jsonb default null,
  p_id text default null
) returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  v_linea_id text;
  v_activo_id text;
  v_cantidad integer;
  v_nombre text;
  v_organizacion_id uuid;
  v_plan_codigo text;
  v_max_activos integer;
begin
  -- El mismo orden de locks serializa altas de activos/líneas contra archivo
  -- de líneas y evita superar límites en altas concurrentes.
  if p_accion in ('crear_activo', 'archivar_linea') then
    select organizacion_id into v_organizacion_id
      from public.plantas where id=p_planta_id and activa;
    if v_organizacion_id is null then
      raise exception 'La planta no existe o está archivada.' using errcode='P0002';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(v_organizacion_id::text, 0));
  end if;
  if p_accion = 'crear_linea' then
    v_linea_id := upper(trim(p_linea->>'id'));
    v_nombre := trim(p_linea->>'nombre');
    if v_linea_id !~ '^L-[0-9]{2}$' or coalesce(length(v_nombre), 0) < 2 then
      raise exception 'El código y nombre de línea no son válidos.' using errcode = '22023';
    end if;
    insert into public.planta_lineas(id,planta_id,nombre,descripcion,orden,activa)
    values (v_linea_id,p_planta_id,left(v_nombre,120),'',coalesce((p_linea->>'orden')::smallint,1),true);
    return jsonb_build_object('accion',p_accion,'linea_id',v_linea_id);
  elsif p_accion = 'crear_activo' then
    v_activo_id := upper(trim(p_activo->>'id'));
    v_linea_id := upper(trim(p_activo->>'linea_id'));
    v_nombre := trim(p_activo->>'nombre');
    if v_activo_id !~ '^[A-Z]-[0-9]{2}$' or coalesce(length(v_nombre),0) < 2
       or coalesce(length(trim(p_activo->>'etapa')),0) < 2
       or coalesce(length(trim(p_activo->>'tipo')),0) <> 2
       or (p_activo->>'tarifa_hora')::numeric not between 1 and 1000000
       or coalesce((p_activo->>'etapa_orden')::integer,0) not between 1 and 99 then
      raise exception 'Los datos del equipo no son válidos.' using errcode = '22023';
    end if;
    if not exists(select 1 from public.planta_lineas where planta_id=p_planta_id and id=v_linea_id and activa and archivado_en is null) then
      raise exception 'La línea elegida no existe o está archivada.' using errcode = '22023';
    end if;
    select organizacion_id into v_organizacion_id from public.plantas where id=p_planta_id and activa;
    select s.plan_codigo into v_plan_codigo from public.organizacion_suscripciones s
      where s.organizacion_id=v_organizacion_id and s.estado in ('piloto','activa','cancelacion_programada')
        and (s.inicia_en is null or s.inicia_en <= now()) and (s.termina_en is null or s.termina_en > now())
      order by s.creada_en desc limit 1 for update;
    if v_plan_codigo is null then raise exception 'Se requiere un plan activo para agregar equipos.' using errcode='23514'; end if;
    select max_activos into v_max_activos from public.planes where codigo=v_plan_codigo and activo;
    if v_max_activos is not null then
      select count(*) into v_cantidad from public.planta_activos a
        join public.plantas p on p.id=a.planta_id
        where p.organizacion_id=v_organizacion_id and p.activa and a.activo and a.archivado_en is null;
      if v_cantidad >= v_max_activos then raise exception 'El plan alcanzó su límite de equipos activos.' using errcode='23514'; end if;
    end if;
    insert into public.planta_activos(id,planta_id,linea_id,tipo,nombre,etapa,etapa_orden,tarifa_hora,cuello_botella,activo)
    values (v_activo_id,p_planta_id,v_linea_id,upper(trim(p_activo->>'tipo')),left(v_nombre,120),
      left(trim(p_activo->>'etapa'),120),(p_activo->>'etapa_orden')::smallint,
      (p_activo->>'tarifa_hora')::numeric,coalesce((p_activo->>'cuello_botella')::boolean,false),true);
    insert into public.planta_estados(planta_id,activo_id,estado) values(p_planta_id,v_activo_id,'RUN');
    return jsonb_build_object('accion',p_accion,'activo_id',v_activo_id);
  elsif p_accion = 'archivar_activo' then
    v_activo_id := upper(trim(p_id));
    -- Serializa el archivo con reportes de paro, que bloquean la misma fila
    -- de planta_activos antes de verificarla y crear estado/solicitud.
    perform 1 from public.planta_activos
      where planta_id=p_planta_id and id=v_activo_id and activo
      for update;
    if not found then raise exception 'El equipo no existe o ya está archivado.' using errcode='P0002'; end if;
    if exists(select 1 from public.planta_estados where planta_id=p_planta_id and activo_id=v_activo_id and estado='STOP') then
      raise exception 'Cierra el paro vigente antes de archivar este equipo.' using errcode='23514';
    end if;
    if exists(select 1 from public.planta_solicitudes where planta_id=p_planta_id and activo_id=v_activo_id and not cerrada) then
      raise exception 'Resuelve los reportes abiertos antes de archivar este equipo.' using errcode='23514';
    end if;
    update public.planta_activos set activo=false,archivado_en=now(),archivado_por=p_usuario_id
      where planta_id=p_planta_id and id=v_activo_id and activo and archivado_en is null;
    if not found then raise exception 'El equipo no existe o ya está archivado.' using errcode = 'P0002'; end if;
    update public.planta_estados set estado='RUN',causa_id=null,causa_libre=null,actualizado_en=now()
      where planta_id=p_planta_id and activo_id=v_activo_id;
    return jsonb_build_object('accion',p_accion,'activo_id',v_activo_id);
  elsif p_accion = 'archivar_linea' then
    v_linea_id := upper(trim(p_id));
    select count(*) into v_cantidad from public.planta_activos
      where planta_id=p_planta_id and linea_id=v_linea_id and activo and archivado_en is null;
    if v_cantidad > 0 then raise exception 'Archiva primero los equipos activos de esta línea.' using errcode = '23503'; end if;
    update public.planta_lineas set activa=false,archivado_en=now(),archivado_por=p_usuario_id
      where planta_id=p_planta_id and id=v_linea_id and activa and archivado_en is null;
    if not found then raise exception 'La línea no existe o ya está archivada.' using errcode = 'P0002'; end if;
    return jsonb_build_object('accion',p_accion,'linea_id',v_linea_id);
  end if;
  raise exception 'Acción de estructura no reconocida.' using errcode = '22023';
end;
$$;

revoke all on function public.planta_actualizar_estructura(uuid,uuid,text,jsonb,jsonb,text) from public, anon, authenticated;
grant execute on function public.planta_actualizar_estructura(uuid,uuid,text,jsonb,jsonb,text) to service_role;

commit;
