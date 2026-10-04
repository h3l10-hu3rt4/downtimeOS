-- Permite al operador retirar únicamente su reporte pendiente, sin dejar el
-- estado STOP separado de la solicitud ni permitir cancelar el de un colega.
begin;

alter table public.planta_solicitudes
  add column if not exists reportado_por_user_id uuid;

-- La identidad autenticada se persiste al reportar. Se reemplaza la función
-- anterior para que PostgREST reciba el UUID como argumento obligatorio.
drop function if exists public.planta_reportar_paro(uuid,text,text,text,timestamptz,text);
create function public.planta_reportar_paro(
  p_planta_id uuid,
  p_activo_id text,
  p_causa_id text,
  p_causa_libre text,
  p_desde timestamptz,
  p_reportado_por text,
  p_reportado_por_user_id uuid
) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare
  v_activo public.planta_activos%rowtype;
  v_causa public.planta_causas%rowtype;
  v_desde timestamptz := coalesce(p_desde,clock_timestamp());
  v_libre text;
  v_folio text;
  v_estado public.planta_estados%rowtype;
  v_solicitud public.planta_solicitudes%rowtype;
begin
  if p_reportado_por_user_id is null then
    raise exception 'Se requiere la identidad autenticada del operador.' using errcode='22023';
  end if;
  -- Evita crear un STOP futuro o tan antiguo que planta_cerrar_paro no pueda
  -- cerrar (límite de 72 h). La ventana de retroactividad es deliberadamente
  -- acotada; el servidor conserva el reloj oficial.
  if v_desde > clock_timestamp() + interval '5 minutes'
     or v_desde < clock_timestamp() - interval '72 hours' then
    raise exception 'La hora del paro debe estar entre ahora y las últimas 72 horas.' using errcode='22023';
  end if;
  select * into v_activo from public.planta_activos
    where planta_id=p_planta_id and id=p_activo_id and activo for update;
  if not found then raise exception 'El activo % no existe o está inactivo en esta planta.',p_activo_id using errcode='P0001'; end if;
  if exists(select 1 from public.planta_estados where planta_id=p_planta_id and activo_id=p_activo_id and estado='STOP')
     or exists(select 1 from public.planta_solicitudes where planta_id=p_planta_id and activo_id=p_activo_id and not cerrada) then
    raise exception 'Este equipo ya tiene un paro o reporte abierto.' using errcode='23505';
  end if;
  select * into v_causa from public.planta_causas where id=p_causa_id;
  if not found then raise exception 'La causa % no existe.',p_causa_id using errcode='P0001'; end if;
  v_libre := nullif(left(trim(coalesce(p_causa_libre,'')),120),'');
  if v_causa.requiere_texto and coalesce(length(v_libre),0)<3 then
    raise exception 'La causa «Otros» necesita una descripción de al menos 3 caracteres.' using errcode='P0001';
  end if;
  if not v_causa.requiere_texto then v_libre := null; end if;
  v_folio := replace(v_activo.linea_id,'-','') || '-' || v_activo.tipo || '-' ||
    replace(v_activo.id,'-','') || '-' ||
    to_char(v_desde at time zone 'America/Mexico_City','YYYYMMDD-HH24MI') || '-' ||
    upper(substr(md5(p_planta_id::text || p_activo_id || clock_timestamp()::text),1,2));
  insert into public.planta_estados(planta_id,activo_id,estado,desde,causa_id,causa_libre,actualizado_en)
    values(p_planta_id,v_activo.id,'STOP',v_desde,v_causa.id,v_libre,clock_timestamp())
    on conflict(planta_id,activo_id) do update set estado=excluded.estado,desde=excluded.desde,
      causa_id=excluded.causa_id,causa_libre=excluded.causa_libre,actualizado_en=excluded.actualizado_en
    returning * into v_estado;
  insert into public.planta_solicitudes(
    planta_id,folio,activo_id,causa_id,causa_libre,desde,reportado_por,reportado_por_user_id,estado
  ) values(
    p_planta_id,v_folio,v_activo.id,v_causa.id,v_libre,v_desde,
    left(coalesce(p_reportado_por,''),120),p_reportado_por_user_id,'pendiente'
  ) returning * into v_solicitud;
  return jsonb_build_object('estado',to_jsonb(v_estado),'solicitud',to_jsonb(v_solicitud));
end;
$$;
revoke all on function public.planta_reportar_paro(uuid,text,text,text,timestamptz,text,uuid) from public,anon,authenticated;
grant execute on function public.planta_reportar_paro(uuid,text,text,text,timestamptz,text,uuid) to service_role;

create or replace function public.planta_retirar_reporte_operador(
  p_planta_id uuid,
  p_folio text,
  p_user_id uuid
) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare
  v_activo public.planta_activos%rowtype;
  v_solicitud public.planta_solicitudes%rowtype;
  v_estado public.planta_estados%rowtype;
  v_liberado boolean := false;
  v_ahora timestamptz := clock_timestamp();
begin
  select * into v_activo from public.planta_activos
    where planta_id=p_planta_id and id=(select activo_id from public.planta_solicitudes
      where planta_id=p_planta_id and folio=p_folio) and activo for update;
  if not found then raise exception 'El activo del reporte no existe o está inactivo.' using errcode='P0002'; end if;
  select * into v_solicitud from public.planta_solicitudes
    where planta_id=p_planta_id and folio=p_folio for update;
  if not found or v_solicitud.reportado_por_user_id is distinct from p_user_id then
    raise exception 'Solo puedes retirar un reporte que tú hayas enviado.' using errcode='42501';
  end if;
  if v_solicitud.estado <> 'pendiente' or v_solicitud.cerrada then
    raise exception 'El reporte ya fue atendido y no se puede retirar.' using errcode='23505';
  end if;

  update public.planta_solicitudes set estado='rechazada',causa_validada_id=causa_id,
    validada_en=v_ahora,resuelta_por='Retirado por el operador',cerrada=true
    where planta_id=p_planta_id and folio=p_folio returning * into v_solicitud;

  if not exists(select 1 from public.planta_solicitudes
      where planta_id=p_planta_id and activo_id=v_solicitud.activo_id
        and not cerrada and estado<>'rechazada') then
    select * into v_estado from public.planta_estados
      where planta_id=p_planta_id and activo_id=v_solicitud.activo_id for update;
    if found and v_estado.estado='STOP' then
      update public.planta_estados set estado='RUN',desde=v_ahora,causa_id=null,
        causa_libre=null,actualizado_en=v_ahora
        where planta_id=p_planta_id and activo_id=v_solicitud.activo_id;
    end if;
    v_liberado := true;
  end if;

  return jsonb_build_object('solicitud',to_jsonb(v_solicitud),'maquina_liberada',v_liberado);
end;
$$;
revoke all on function public.planta_retirar_reporte_operador(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.planta_retirar_reporte_operador(uuid,text,uuid) to service_role;

commit;
