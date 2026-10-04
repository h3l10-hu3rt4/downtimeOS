-- El cierre de un paro debe ser una sola transacción: evento financiero,
-- estado RUN y cierre de las solicitudes abiertas nunca pueden divergir.
-- Aplicar después de 2026-10-02-serializar-estructura.sql.
begin;

create or replace function public.planta_cerrar_paro(
  p_planta_id uuid,
  p_activo_id text,
  p_registrado_por text default '',
  p_origen text default 'piso'
) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare
  v_activo public.planta_activos%rowtype;
  v_estado public.planta_estados%rowtype;
  v_causa public.planta_causas%rowtype;
  v_evento public.planta_eventos%rowtype;
  v_desde timestamptz;
  v_fin timestamptz;
  v_minutos numeric(8,2);
  v_tarifa numeric(12,2);
  v_costo numeric(16,2);
  v_local timestamp;
  v_hora integer;
  v_jornada date;
  v_turno text;
  v_folio text;
  v_solicitudes_cerradas integer := 0;
begin
  if p_origen not in ('piso','mantenimiento') then
    raise exception 'El origen del cierre no es válido.' using errcode='22023';
  end if;

  -- Serializa todos los cambios de estado/eventos para este equipo.
  select * into v_activo from public.planta_activos
    where planta_id=p_planta_id and id=p_activo_id and activo
    for update;
  if not found then
    raise exception 'El equipo no existe o está inactivo en esta planta.' using errcode='P0002';
  end if;

  select * into v_estado from public.planta_estados
    where planta_id=p_planta_id and activo_id=p_activo_id
    for update;
  if not found or v_estado.estado <> 'STOP' then
    raise exception 'El equipo ya no tiene un paro abierto que cerrar.' using errcode='P0002';
  end if;

  v_desde := v_estado.desde;
  v_fin := clock_timestamp();
  v_minutos := greatest(1, round(extract(epoch from (v_fin-v_desde))/60.0));
  if v_minutos > 4320 then
    raise exception 'El paro supera 72 horas; solicita a Mantenimiento una corrección auditada antes de cerrarlo.' using errcode='22023';
  end if;

  select * into v_causa from public.planta_causas
    where id=coalesce(v_estado.causa_id,'espera-material');
  if not found then
    raise exception 'La causa del paro ya no existe en el catálogo.' using errcode='P0002';
  end if;

  select public.planta_tarifa_aplicable(p_activo_id,p_planta_id) into v_tarifa;
  if v_tarifa is null or v_tarifa <= 0 then
    raise exception 'No fue posible determinar la tarifa vigente del equipo.' using errcode='22023';
  end if;
  v_costo := round((v_minutos/60.0)*v_tarifa,2);

  v_local := v_desde at time zone 'America/Mexico_City';
  v_hora := extract(hour from v_local)::integer;
  v_jornada := v_local::date - case when v_hora < 6 then 1 else 0 end;
  v_turno := case when v_hora >= 6 and v_hora < 14 then 'T1'
                  when v_hora >= 14 and v_hora < 22 then 'T2' else 'T3' end;
  v_folio := replace(v_activo.linea_id,'-','') || '-' || v_activo.tipo || '-' ||
    replace(v_activo.id,'-','') || '-' ||
    to_char(v_local,'YYYYMMDD-HH24MI') || '-' ||
    upper(substr(md5(p_planta_id::text || p_activo_id || clock_timestamp()::text),1,2));

  insert into public.planta_eventos(
    planta_id,folio,activo_id,causa_id,causa_libre,minutos,inicio,jornada,turno,
    retroactivo,tarifa_aplicada,costo_mxn,origen,nota,registrado_por
  ) values (
    p_planta_id,v_folio,p_activo_id,v_causa.id,v_estado.causa_libre,v_minutos,v_desde,
    v_jornada,v_turno,false,v_tarifa,v_costo,p_origen,
    'Cierre confirmado desde DowntimeOS.',left(coalesce(p_registrado_por,''),120)
  ) returning * into v_evento;

  update public.planta_estados set estado='RUN',desde=v_fin,causa_id=null,causa_libre=null,actualizado_en=v_fin
    where planta_id=p_planta_id and activo_id=p_activo_id
    returning * into v_estado;
  update public.planta_solicitudes set cerrada=true
    where planta_id=p_planta_id and activo_id=p_activo_id and not cerrada;
  get diagnostics v_solicitudes_cerradas = row_count;

  return jsonb_build_object(
    'evento',to_jsonb(v_evento),
    'estado',to_jsonb(v_estado),
    'solicitudes_cerradas',v_solicitudes_cerradas
  );
end;
$$;

-- Rechazar un falso positivo y, si era el último reporte abierto, liberar el
-- activo en una sola transacción (sin crear un evento financiero).
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
  -- Usa el mismo lock de activo que STOP y cierre para serializar dos
  -- descartes simultáneos de reportes distintos de la misma máquina.
  -- Primero comprueba el folio sin bloquear activos. Así un folio inexistente
  -- no termina bloqueando arbitrariamente el primer activo de la planta.
  select * into v_solicitud from public.planta_solicitudes
    where planta_id=p_planta_id and folio=p_folio;
  if not found then
    raise exception 'La solicitud no existe en esta planta.' using errcode='P0002';
  end if;
  -- Conserva el orden de locks compartido con STOP/cierre: activo y después
  -- solicitud. La fila se vuelve a leer bloqueada antes de mutarla.
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

-- Mantenimiento captura un paro ya validado: STOP y solicitud aprobada deben
-- persistirse juntos para no dejar el semáforo separado de su bitácora.
create or replace function public.planta_reportar_paro_mantenimiento(
  p_planta_id uuid,
  p_activo_id text,
  p_causa_id text,
  p_causa_libre text default null,
  p_reportado_por text default ''
) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare
  v_activo public.planta_activos%rowtype;
  v_causa public.planta_causas%rowtype;
  v_estado public.planta_estados%rowtype;
  v_solicitud public.planta_solicitudes%rowtype;
  v_desde timestamptz := clock_timestamp();
  v_libre text;
  v_folio text;
begin
  select * into v_activo from public.planta_activos
    where planta_id=p_planta_id and id=p_activo_id and activo
    for update;
  if not found then
    raise exception 'El equipo no existe o está inactivo en esta planta.' using errcode='P0002';
  end if;
  if exists(select 1 from public.planta_estados where planta_id=p_planta_id and activo_id=p_activo_id and estado='STOP')
     or exists(select 1 from public.planta_solicitudes where planta_id=p_planta_id and activo_id=p_activo_id and not cerrada) then
    raise exception 'Este equipo ya tiene un paro o reporte abierto.' using errcode='23505';
  end if;
  select * into v_causa from public.planta_causas where id=p_causa_id;
  if not found then raise exception 'La causa seleccionada ya no está disponible.' using errcode='P0002'; end if;
  v_libre := nullif(left(trim(coalesce(p_causa_libre,'')),120),'');
  if v_causa.requiere_texto and coalesce(length(v_libre),0)<3 then
    raise exception 'La causa «Otros» necesita una descripción de al menos 3 caracteres.' using errcode='22023';
  end if;
  if not v_causa.requiere_texto then v_libre := null; end if;

  v_folio := replace(v_activo.linea_id,'-','') || '-' || v_activo.tipo || '-' ||
    replace(v_activo.id,'-','') || '-' ||
    to_char(v_desde at time zone 'America/Mexico_City','YYYYMMDD-HH24MI') || '-' ||
    upper(substr(md5(p_planta_id::text || p_activo_id || clock_timestamp()::text),1,2));
  insert into public.planta_estados(planta_id,activo_id,estado,desde,causa_id,causa_libre,actualizado_en)
    values(p_planta_id,p_activo_id,'STOP',v_desde,v_causa.id,v_libre,v_desde)
    on conflict(planta_id,activo_id) do update set estado='STOP',desde=excluded.desde,
      causa_id=excluded.causa_id,causa_libre=excluded.causa_libre,actualizado_en=excluded.actualizado_en
    returning * into v_estado;
  insert into public.planta_solicitudes(
    planta_id,folio,activo_id,causa_id,causa_libre,desde,reportado_por,estado,
    causa_validada_id,validada_en,resuelta_por
  ) values(
    p_planta_id,v_folio,p_activo_id,v_causa.id,v_libre,v_desde,
    left(coalesce(p_reportado_por,''),120),'aprobada',v_causa.id,v_desde,
    left(coalesce(p_reportado_por,''),120)
  ) returning * into v_solicitud;

  return jsonb_build_object('estado',to_jsonb(v_estado),'solicitud',to_jsonb(v_solicitud));
end;
$$;

revoke all on function public.planta_cerrar_paro(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.planta_cerrar_paro(uuid,text,text,text) to service_role;
revoke all on function public.planta_reportar_paro_mantenimiento(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.planta_reportar_paro_mantenimiento(uuid,text,text,text,text) to service_role;
revoke all on function public.planta_descartar_solicitud(uuid,text,text) from public,anon,authenticated;
grant execute on function public.planta_descartar_solicitud(uuid,text,text) to service_role;

commit;
