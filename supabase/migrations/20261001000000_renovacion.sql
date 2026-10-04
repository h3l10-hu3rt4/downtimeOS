-- Renovación manual de una suscripción vigente.
-- La solicitud/pago quedan pendientes. El periodo renovado solo se programa
-- cuando administración verifica el pago, y empieza al acabar el actual.
begin;

-- Defensa adicional ante más de una suscripción que se solape en el tiempo.
-- Se usa exclusion por rango temporal, no por estado: una renovacion pendiente
-- puede coexistir con el plan vigente, pero no dos periodos ya concedidos.
create extension if not exists btree_gist;
alter table public.organizacion_suscripciones
  add column if not exists periodo_programado boolean not null default false;
alter table public.organizacion_suscripciones
  add column if not exists inicio_programado_en timestamptz;

-- Mantiene por separado solicitudes normales, renovaciones y pilotos. Un
-- piloto vigente puede solicitar la conversión a plan pagado sin que el índice
-- confunda esa misma cuenta con una segunda solicitud.
drop index if exists public.organizacion_suscripcion_una_pendiente_por_org_idx;
create unique index if not exists organizacion_suscripcion_una_pendiente_por_org_idx
  on public.organizacion_suscripciones(organizacion_id)
  where estado in ('solicitada','pendiente_pago') and not periodo_programado;
create unique index if not exists organizacion_suscripcion_un_piloto_por_org_idx
  on public.organizacion_suscripciones(organizacion_id)
  where estado='piloto' and not periodo_programado;
do $$ begin
  if not exists (select 1 from pg_constraint where conname='organizacion_suscripciones_periodos_sin_traslape') then
    alter table public.organizacion_suscripciones
      add constraint organizacion_suscripciones_periodos_sin_traslape
      exclude using gist (
        organizacion_id with =,
        tstzrange(inicia_en, termina_en, '[)') with &&
      ) where (inicia_en is not null and termina_en is not null and estado in ('activa','piloto','cancelacion_programada'));
  end if;
end $$;

create or replace function public.organizacion_renovar_plan(
  p_organizacion_id uuid,
  p_usuario_id uuid,
  p_suscripcion_actual_id uuid,
  p_plan_codigo text,
  p_periodicidad text,
  p_plantas integer,
  p_orden_compra text default ''
) returns jsonb
language plpgsql security invoker set search_path=public
as $$
declare
  s public.organizacion_suscripciones%rowtype;
  v_nueva public.organizacion_suscripciones%rowtype;
  v_plan public.planes%rowtype;
  v_planta_id uuid;
  v_num_plantas integer;
  v_num_activos integer;
  v_importe numeric(12,2);
  v_inicio timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_organizacion_id::text, 0));
  select * into s from public.organizacion_suscripciones
    where id=p_suscripcion_actual_id and organizacion_id=p_organizacion_id
    for update;
  if not found then raise exception 'No encontramos el plan vigente de tu empresa.' using errcode='P0002'; end if;
  if s.estado not in ('activa','piloto','cancelacion_programada') or s.inicia_en is null or s.inicia_en>now()
     or s.termina_en is null or s.termina_en<=now() then
    raise exception 'Solo puedes renovar anticipadamente un plan vigente.' using errcode='22023';
  end if;
  if not exists(select 1 from public.organizaciones o where o.id=p_organizacion_id and o.propietario_id=p_usuario_id)
     and not exists(select 1 from public.planta_membresias m where m.organizacion_id=p_organizacion_id
       and m.user_id=p_usuario_id and m.activo and m.puede_administrar_facturacion) then
    raise exception 'No tienes permiso para renovar el plan de esta empresa.' using errcode='42501';
  end if;
  if exists(select 1 from public.organizacion_suscripciones x where x.organizacion_id=p_organizacion_id
    and x.id<>s.id and x.estado in ('solicitada','pendiente_pago','piloto') and not x.periodo_programado) then
    raise exception 'Ya existe una solicitud inicial o un piloto pendiente para tu empresa.' using errcode='23505';
  end if;
  if exists(select 1 from public.organizacion_suscripciones x where x.organizacion_id=p_organizacion_id
    and x.estado in ('solicitada','pendiente_pago') and x.periodo_programado) then
    raise exception 'Ya existe una solicitud pendiente para tu empresa.' using errcode='23505';
  end if;
  if exists(select 1 from public.organizacion_suscripciones x where x.organizacion_id=p_organizacion_id
    and x.periodo_programado and x.estado in ('activa','piloto','cancelacion_programada')
    and x.inicia_en>now() and x.termina_en>now()) then
    raise exception 'Ya hay un próximo periodo contratado para esta cuenta.' using errcode='23505';
  end if;
  if p_periodicidad is null or p_periodicidad not in ('mensual','semestral','anual')
     or p_plantas is null or p_plantas<1 then
    raise exception 'El periodo o el número de plantas no es válido.' using errcode='22023';
  end if;
  select * into v_plan from public.planes where codigo=p_plan_codigo and activo;
  if not found then raise exception 'El plan solicitado no está disponible.' using errcode='22023'; end if;
  if p_plan_codigo='enterprise' and p_plantas<3 then
    raise exception 'Enterprise requiere una cotización mínima de tres plantas.' using errcode='22023';
  end if;
  select count(*) into v_num_plantas from public.plantas where organizacion_id=p_organizacion_id and activa;
  if p_plantas < v_num_plantas then raise exception 'La cotización debe cubrir todas las plantas activas.' using errcode='22023'; end if;
  if v_plan.max_plantas is not null and v_num_plantas>v_plan.max_plantas then
    raise exception 'El plan seleccionado no cubre todas las plantas activas.' using errcode='22023';
  end if;
  if v_plan.max_activos is not null then
    select count(*) into v_num_activos from public.planta_activos a join public.plantas p on p.id=a.planta_id
      where p.organizacion_id=p_organizacion_id and p.activa and a.activo;
    if v_num_activos>v_plan.max_activos then raise exception 'El plan seleccionado no cubre la cantidad de activos configurada.' using errcode='22023'; end if;
  end if;
  select m.planta_id into v_planta_id from public.planta_membresias m
    where m.organizacion_id=p_organizacion_id and m.user_id=p_usuario_id and m.activo order by m.planta_id limit 1;
  if v_planta_id is null then raise exception 'Se requiere una membresía activa para renovar.' using errcode='42501'; end if;
  v_importe := (case p_periodicidad when 'mensual' then v_plan.precio_mensual_usd
    when 'anual' then v_plan.precio_anual_usd else v_plan.precio_semestral_usd end)*p_plantas;
  v_inicio := s.termina_en;
  insert into public.organizacion_suscripciones(
    organizacion_id,plan_codigo,estado,periodicidad,plantas_incluidas,orden_compra,creada_por,periodo_programado,inicio_programado_en
  ) values (p_organizacion_id,p_plan_codigo,'solicitada',p_periodicidad,p_plantas,
    left(trim(coalesce(p_orden_compra,'')),100),p_usuario_id,true,v_inicio)
  returning * into v_nueva;
  insert into public.organizacion_pagos(suscripcion_id,estado,importe,moneda,referencia)
    values(v_nueva.id,'pendiente',v_importe,'USD',left(trim(coalesce(p_orden_compra,'')),100));
  insert into public.planta_auditoria(organizacion_id,planta_id,actor_id,accion,entidad,entidad_id,detalles)
    values(p_organizacion_id,v_planta_id,p_usuario_id,'renovacion_solicitada','suscripcion',v_nueva.id::text,
      jsonb_build_object('suscripcion_actual_id',s.id,'inicio_programado',v_inicio,'plan',p_plan_codigo,
        'periodicidad',p_periodicidad,'importe_usd',v_importe,'pago_manual',true));
  return jsonb_build_object('id',v_nueva.id,'plan_codigo',v_nueva.plan_codigo,'estado',v_nueva.estado,
    'periodicidad',v_nueva.periodicidad,'plantas_incluidas',v_nueva.plantas_incluidas,
    'orden_compra',v_nueva.orden_compra,'importe_usd',v_importe,'inicio_programado',v_inicio);
end $$;
revoke all on function public.organizacion_renovar_plan(uuid,uuid,uuid,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.organizacion_renovar_plan(uuid,uuid,uuid,text,text,integer,text) to service_role;

-- Activación administrativa de una renovación: valida pago y fija su intervalo
-- futuro atómicamente. No captura dinero ni desplaza la suscripción vigente.
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
  select organizacion_id into v_organizacion_id from public.organizacion_suscripciones where id=p_suscripcion_id;
  if v_organizacion_id is null then raise exception 'No encontramos esa solicitud.' using errcode='P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_organizacion_id::text,0));
  select * into s from public.organizacion_suscripciones where id=p_suscripcion_id for update;
  if not found then raise exception 'No encontramos esa solicitud.' using errcode='P0002'; end if;
  if s.estado not in ('solicitada','pendiente_pago') then raise exception 'La solicitud ya no está pendiente.' using errcode='23505'; end if;
  if p_accion is null or p_accion not in ('activar','piloto','rechazar') then raise exception 'Acción no válida.' using errcode='22023'; end if;
  if s.periodo_programado and p_accion<>'activar' then
    raise exception 'Una renovación solo puede activarse tras verificar el pago; no se puede convertir en piloto.' using errcode='22023';
  end if;
  if p_accion='activar' then
    select id into v_pago_id from public.organizacion_pagos where suscripcion_id=s.id and estado='pendiente'
      order by created_at desc limit 1 for update;
    if v_pago_id is null then raise exception 'No hay un pago pendiente vinculado para verificar.' using errcode='23514'; end if;
    if s.periodo_programado then
      v_inicio:=now();
      select greatest(v_inicio, termina_en) into v_inicio from public.organizacion_suscripciones
        where organizacion_id=s.organizacion_id and id<>s.id
          and estado in ('activa','piloto','cancelacion_programada') and termina_en>v_inicio
        order by termina_en desc limit 1;
      v_inicio:=coalesce(v_inicio,now());
    end if;
    v_fin:=v_inicio+case s.periodicidad when 'mensual' then interval '1 month' when 'anual' then interval '12 months' else interval '6 months' end;
    update public.organizacion_pagos set estado='verificado',verificado_en=now(),verificado_por_admin=left(p_admin,254) where id=v_pago_id;
    update public.organizacion_suscripciones set estado='activa',inicia_en=v_inicio,termina_en=v_fin,renueva_en=v_fin,
      periodo_programado=(v_inicio>now()),inicio_programado_en=v_inicio,updated_at=now() where id=s.id;
  elsif p_accion='piloto' then
    v_fin:=v_inicio+interval '14 days';
    update public.organizacion_suscripciones set estado='piloto',inicia_en=v_inicio,termina_en=v_fin,renueva_en=null,updated_at=v_inicio where id=s.id;
  else
    update public.organizacion_pagos set estado='rechazado',verificado_por_admin=left(p_admin,254)
      where suscripcion_id=s.id and estado in ('pendiente','comprobante_recibido');
    update public.organizacion_suscripciones set estado='cancelada',periodo_programado=false,updated_at=v_inicio where id=s.id;
  end if;
  insert into public.planta_auditoria(organizacion_id,actor_externo,accion,entidad,entidad_id,detalles)
    values(s.organizacion_id,left(p_admin,254),case when p_accion='piloto' then 'piloto_activado'
      when p_accion='activar' and s.periodo_programado then 'renovacion_pago_verificado'
      when p_accion='activar' then 'pago_verificado_plan_activado' else 'solicitud_plan_rechazada' end,
      'suscripcion',s.id::text,jsonb_build_object('termina_en',v_fin,'inicio',v_inicio,'accion',p_accion));
  return jsonb_build_object('id',s.id,'accion',p_accion,'termina_en',v_fin,
    'renovacion_programada',s.periodo_programado,'inicia_en',v_inicio);
end $$;
revoke all on function public.organizacion_admin_resolver_solicitud(uuid,text,text) from public,anon,authenticated;
grant execute on function public.organizacion_admin_resolver_solicitud(uuid,text,text) to service_role;

-- Permite desistir de una renovación ya verificada antes de su fecha de inicio.
-- El estado de pago no se altera: cualquier devolución requiere gestión humana.
create or replace function public.organizacion_cancelar_suscripcion(
  p_organizacion_id uuid,p_suscripcion_id uuid,p_planta_id uuid,p_actor_id uuid
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare
  s public.organizacion_suscripciones%rowtype;
  v_estado text;
  v_accion text;
  v_reembolso_manual boolean := false;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_organizacion_id::text,0));
  select * into s from public.organizacion_suscripciones
    where id=p_suscripcion_id and organizacion_id=p_organizacion_id for update;
  if not found then raise exception 'No encontramos la suscripción de tu empresa.' using errcode='P0002'; end if;
  if s.estado in ('cancelada','cancelacion_programada') then
    raise exception 'La suscripción ya está cancelada o tiene cancelación programada.' using errcode='23505';
  end if;
  if s.inicia_en is not null and s.inicia_en>now() and s.termina_en>now() then
    v_estado:='cancelada'; v_accion:='renovacion_programada_cancelada';
    select exists(select 1 from public.organizacion_pagos where suscripcion_id=s.id and estado='verificado') into v_reembolso_manual;
    update public.organizacion_pagos set estado='anulado',notas=case when notas='' then 'Solicitud de renovación cancelada antes del inicio.' else notas || E'\nSolicitud de renovación cancelada antes del inicio.' end
      where suscripcion_id=s.id and estado in ('pendiente','comprobante_recibido');
  elsif s.estado in ('activa','piloto') and s.termina_en is not null and s.termina_en>now() then
    v_estado:='cancelacion_programada'; v_accion:='cancelacion_programada';
  elsif s.estado in ('solicitada','pendiente_pago','activa','piloto','vencida','suspendida') then
    v_estado:='cancelada'; v_accion:='suscripcion_cancelada';
    update public.organizacion_pagos set estado='anulado',notas=case when notas='' then 'Solicitud de plan cancelada.' else notas || E'\nSolicitud de plan cancelada.' end
      where suscripcion_id=s.id and estado in ('pendiente','comprobante_recibido');
  else
    raise exception 'El estado actual no permite cancelar esta suscripción.' using errcode='22023';
  end if;
  update public.organizacion_suscripciones set estado=v_estado,periodo_programado=false,updated_at=now() where id=s.id;
  insert into public.planta_auditoria(organizacion_id,planta_id,actor_id,accion,entidad,entidad_id,detalles)
    values(p_organizacion_id,p_planta_id,p_actor_id,v_accion,'suscripcion',s.id::text,
      jsonb_build_object('estado_anterior',s.estado,'estado_nuevo',v_estado,'termina_en',s.termina_en,'reembolso_manual',v_reembolso_manual));
  return jsonb_build_object('id',s.id,'estado',v_estado,'termina_en',s.termina_en,'reembolso_manual',v_reembolso_manual);
end $$;
revoke all on function public.organizacion_cancelar_suscripcion(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.organizacion_cancelar_suscripcion(uuid,uuid,uuid,uuid) to service_role;

commit;
