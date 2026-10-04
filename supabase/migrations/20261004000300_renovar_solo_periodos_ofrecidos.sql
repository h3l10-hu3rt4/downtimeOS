-- Las migraciones históricas de solicitudes y renovaciones contemplaban
-- mensual. El producto solo ofrece periodos semestrales y anuales; alinea
-- ambas RPC internas con la API y el trigger de periodicidad.
begin;

create or replace function public.organizacion_solicitar_plan(
  p_organizacion_id uuid,
  p_usuario_id uuid,
  p_plan_codigo text,
  p_periodicidad text,
  p_plantas integer,
  p_orden_compra text default ''
) returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  v_plan public.planes%rowtype;
  v_suscripcion public.organizacion_suscripciones%rowtype;
  v_planta_id uuid;
  v_num_plantas integer;
  v_num_activos integer;
  v_importe numeric(12,2);
begin
  perform pg_advisory_xact_lock(hashtextextended(p_organizacion_id::text, 0));
  update public.organizacion_suscripciones set estado = 'vencida'
    where organizacion_id = p_organizacion_id
      and estado in ('activa', 'piloto', 'cancelacion_programada')
      and termina_en is not null and termina_en <= now();
  if exists (select 1 from public.organizacion_suscripciones s where s.organizacion_id = p_organizacion_id
    and s.estado in ('activa', 'piloto', 'cancelacion_programada')
    and (s.termina_en is null or s.termina_en > now())) then
    raise exception 'Tu empresa ya tiene un plan vigente; contacta a DowntimeOS para solicitar un cambio.' using errcode = '22023';
  end if;
  if p_periodicidad is null or p_periodicidad not in ('semestral', 'anual')
     or p_plantas is null or p_plantas < 1 then
    raise exception 'El periodo o el número de plantas no es válido.' using errcode = '22023';
  end if;
  select * into v_plan from public.planes where codigo = p_plan_codigo and activo;
  if not found then raise exception 'El plan solicitado no está disponible.' using errcode = '22023'; end if;
  if p_plan_codigo='enterprise' and p_plantas<3 then
    raise exception 'Enterprise requiere una cotización mínima de tres plantas.' using errcode='22023';
  end if;
  select count(*) into v_num_plantas from public.plantas where organizacion_id = p_organizacion_id and activa;
  select m.planta_id into v_planta_id from public.planta_membresias m
    where m.organizacion_id=p_organizacion_id and m.user_id=p_usuario_id and m.activo
    order by m.planta_id limit 1;
  if v_planta_id is null then
    raise exception 'Se requiere una membresía activa para solicitar un plan.' using errcode = '42501';
  end if;
  if v_plan.max_plantas is not null and v_num_plantas > v_plan.max_plantas then
    raise exception 'El plan seleccionado no cubre todas las plantas activas.' using errcode = '22023';
  end if;
  if p_plantas < v_num_plantas then raise exception 'La cotización debe cubrir todas las plantas activas.' using errcode = '22023'; end if;
  if v_plan.max_activos is not null then
    select count(*) into v_num_activos from public.planta_activos a
      join public.plantas p on p.id = a.planta_id
      where p.organizacion_id = p_organizacion_id and p.activa and a.activo;
    if v_num_activos > v_plan.max_activos then
      raise exception 'El plan seleccionado no cubre la cantidad de activos configurada.' using errcode = '22023';
    end if;
  end if;
  v_importe := (case p_periodicidad when 'anual' then v_plan.precio_anual_usd
    else v_plan.precio_semestral_usd end) * p_plantas;
  insert into public.organizacion_suscripciones(organizacion_id,plan_codigo,estado,periodicidad,plantas_incluidas,orden_compra,creada_por)
  values (p_organizacion_id,p_plan_codigo,'solicitada',p_periodicidad,p_plantas,left(trim(coalesce(p_orden_compra,'')),100),p_usuario_id)
  returning * into v_suscripcion;
  insert into public.organizacion_pagos(suscripcion_id,estado,importe,moneda,referencia)
  values (v_suscripcion.id,'pendiente',v_importe,'USD',left(trim(coalesce(p_orden_compra,'')),100));
  insert into public.planta_auditoria(organizacion_id,planta_id,actor_id,accion,entidad,entidad_id,detalles)
    values (p_organizacion_id,v_planta_id,p_usuario_id,'plan_solicitado','suscripcion',v_suscripcion.id::text,
      jsonb_build_object('plan',p_plan_codigo,'periodicidad',p_periodicidad,'importe_usd',v_importe,
        'orden_compra',left(trim(coalesce(p_orden_compra,'')),100)));
  return jsonb_build_object('id',v_suscripcion.id,'plan_codigo',v_suscripcion.plan_codigo,'estado',v_suscripcion.estado,
    'periodicidad',v_suscripcion.periodicidad,'plantas_incluidas',v_suscripcion.plantas_incluidas,
    'orden_compra',v_suscripcion.orden_compra,'importe_usd',v_importe);
end;
$$;
revoke all on function public.organizacion_solicitar_plan(uuid,uuid,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.organizacion_solicitar_plan(uuid,uuid,text,text,integer,text) to service_role;

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
  if p_periodicidad is null or p_periodicidad not in ('semestral','anual')
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
  v_importe := (case p_periodicidad when 'anual' then v_plan.precio_anual_usd
    else v_plan.precio_semestral_usd end)*p_plantas;
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

commit;
