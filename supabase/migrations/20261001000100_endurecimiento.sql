-- Cierra permisos de lectura sobre el perfil legado y evita encadenar una
-- segunda renovación sobre un periodo futuro ya pagado.
-- Ejecutar después de 2026-10-01-renovacion-suscripcion.sql.
begin;

-- Las membresías son la única fuente vigente de autorización. El perfil
-- histórico permanece para compatibilidad interna del servidor, pero no debe
-- seguir expuesto por PostgREST con una fila que puede estar revocada/desfasada.
drop policy if exists "usuario lee su perfil" on public.planta_perfiles;

-- Defensa para datos legados o estados que se hubieran creado antes de los
-- índices de renovación: nunca encadenar sobre una suscripción futura. Si ya
-- existe un siguiente periodo confirmado, se conserva su fecha y se rechaza
-- esta solicitud duplicada para revisión humana.
create or replace function public.organizacion_admin_resolver_solicitud(
  p_suscripcion_id uuid,p_accion text,p_admin text
) returns jsonb
language plpgsql security invoker set search_path=public
as $$
declare
  s public.organizacion_suscripciones%rowtype;
  v_organizacion_id uuid;
  v_inicio timestamptz := now();
  v_fin timestamptz;
  v_pago_id uuid;
begin
  select organizacion_id into v_organizacion_id
  from public.organizacion_suscripciones where id=p_suscripcion_id;
  if v_organizacion_id is null then
    raise exception 'No encontramos esa solicitud.' using errcode='P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_organizacion_id::text,0));
  select * into s from public.organizacion_suscripciones
  where id=p_suscripcion_id for update;
  if not found then
    raise exception 'No encontramos esa solicitud.' using errcode='P0002';
  end if;
  if s.estado not in ('solicitada','pendiente_pago') then
    raise exception 'La solicitud ya no está pendiente.' using errcode='23505';
  end if;
  if p_accion is null or p_accion not in ('activar','piloto','rechazar') then
    raise exception 'Acción no válida.' using errcode='22023';
  end if;
  if s.periodo_programado and p_accion<>'activar' then
    raise exception 'Una renovación solo puede activarse tras verificar el pago; no se puede convertir en piloto.' using errcode='22023';
  end if;
  if p_accion='activar' then
    select id into v_pago_id from public.organizacion_pagos
    where suscripcion_id=s.id and estado='pendiente'
    order by created_at desc limit 1 for update;
    if v_pago_id is null then
      raise exception 'No hay un pago pendiente vinculado para verificar.' using errcode='23514';
    end if;
    if s.periodo_programado then
      if exists (
        select 1 from public.organizacion_suscripciones x
        where x.organizacion_id=s.organizacion_id and x.id<>s.id
          and x.estado in ('activa','piloto','cancelacion_programada')
          and x.inicia_en>now() and x.termina_en>now()
      ) then
        raise exception 'Ya existe un próximo periodo contratado; revisa esta solicitud antes de validar otro pago.' using errcode='23505';
      end if;
      v_inicio:=now();
      select greatest(v_inicio, termina_en) into v_inicio
      from public.organizacion_suscripciones
      where organizacion_id=s.organizacion_id and id<>s.id
        and estado in ('activa','piloto','cancelacion_programada')
        and termina_en>v_inicio and (inicia_en is null or inicia_en<=v_inicio)
      order by termina_en desc limit 1;
      v_inicio:=coalesce(v_inicio,now());
    end if;
    v_fin:=v_inicio+case s.periodicidad
      when 'mensual' then interval '1 month'
      when 'anual' then interval '12 months'
      else interval '6 months' end;
    update public.organizacion_pagos set estado='verificado',verificado_en=now(),
      verificado_por_admin=left(p_admin,254) where id=v_pago_id;
    update public.organizacion_suscripciones set estado='activa',inicia_en=v_inicio,
      termina_en=v_fin,renueva_en=v_fin,periodo_programado=(v_inicio>now()),
      inicio_programado_en=v_inicio,updated_at=now() where id=s.id;
  elsif p_accion='piloto' then
    v_fin:=v_inicio+interval '14 days';
    update public.organizacion_pagos set estado='anulado',
      verificado_por_admin=left(p_admin,254),
      notas=case when notas='' then 'Pago anulado al conceder piloto.'
        else notas || E'\nPago anulado al conceder piloto.' end
    where suscripcion_id=s.id and estado in ('pendiente','comprobante_recibido');
    update public.organizacion_suscripciones set estado='piloto',inicia_en=v_inicio,
      termina_en=v_fin,renueva_en=null,updated_at=v_inicio where id=s.id;
  else
    update public.organizacion_pagos set estado='rechazado',
      verificado_por_admin=left(p_admin,254)
    where suscripcion_id=s.id and estado in ('pendiente','comprobante_recibido');
    update public.organizacion_suscripciones set estado='cancelada',
      periodo_programado=false,updated_at=v_inicio where id=s.id;
  end if;
  insert into public.planta_auditoria(organizacion_id,actor_externo,accion,
    entidad,entidad_id,detalles)
  values(s.organizacion_id,left(p_admin,254),
    case when p_accion='piloto' then 'piloto_activado'
      when p_accion='activar' and s.periodo_programado then 'renovacion_pago_verificado'
      when p_accion='activar' then 'pago_verificado_plan_activado'
      else 'solicitud_plan_rechazada' end,
    'suscripcion',s.id::text,
    jsonb_build_object('termina_en',v_fin,'inicio',v_inicio,'accion',p_accion));
  return jsonb_build_object('id',s.id,'accion',p_accion,'termina_en',v_fin,
    'renovacion_programada',s.periodo_programado,'inicia_en',v_inicio);
end $$;

revoke all on function public.organizacion_admin_resolver_solicitud(uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.organizacion_admin_resolver_solicitud(uuid,text,text)
  to service_role;

commit;
