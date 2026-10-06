-- HIST-15 · Mejora inmediata a un plan superior (p. ej. Starter -> Pro).
-- Regla comercial: el plan superior se solicita y paga por el flujo normal
-- (periodo completo, sin prorrateo). Al verificar el pago, administración lo
-- activa y reemplaza de inmediato al plan vigente; el tiempo restante del plan
-- anterior no se acredita ni se reembolsa.
begin;

alter table public.organizacion_suscripciones
  add column if not exists mejora_de_suscripcion_id uuid references public.organizacion_suscripciones(id);

-- 'reemplazada' distingue un plan sustituido por una mejora de uno cancelado
-- o vencido. No participa en la exclusión de periodos traslapados.
alter table public.organizacion_suscripciones
  drop constraint if exists organizacion_suscripciones_estado_check;
alter table public.organizacion_suscripciones
  add constraint organizacion_suscripciones_estado_check
  check (estado in ('solicitada','piloto','pendiente_pago','activa','vencida','cancelacion_programada','cancelada','suspendida','reemplazada'));

create or replace function public.organizacion_mejorar_plan(
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
  v_plan_actual public.planes%rowtype;
  v_planta_id uuid;
  v_num_plantas integer;
  v_num_activos integer;
  v_importe numeric(12,2);
begin
  perform pg_advisory_xact_lock(hashtextextended(p_organizacion_id::text, 0));
  select * into s from public.organizacion_suscripciones
    where id=p_suscripcion_actual_id and organizacion_id=p_organizacion_id
    for update;
  if not found then raise exception 'No encontramos el plan vigente de tu empresa.' using errcode='P0002'; end if;
  if s.estado not in ('activa','cancelacion_programada') or s.inicia_en is null or s.inicia_en>now()
     or s.termina_en is null or s.termina_en<=now() then
    raise exception 'Solo puedes mejorar un plan pagado que esté vigente.' using errcode='22023';
  end if;
  if not exists(select 1 from public.organizaciones o where o.id=p_organizacion_id and o.propietario_id=p_usuario_id)
     and not exists(select 1 from public.planta_membresias m where m.organizacion_id=p_organizacion_id
       and m.user_id=p_usuario_id and m.activo and m.puede_administrar_facturacion) then
    raise exception 'No tienes permiso para cambiar el plan de esta empresa.' using errcode='42501';
  end if;
  if exists(select 1 from public.organizacion_suscripciones x where x.organizacion_id=p_organizacion_id
    and x.estado in ('solicitada','pendiente_pago')) then
    raise exception 'Ya existe una solicitud pendiente para tu empresa. Cancélala antes de pedir la mejora.' using errcode='23505';
  end if;
  if exists(select 1 from public.organizacion_suscripciones x where x.organizacion_id=p_organizacion_id
    and x.id<>s.id and x.estado in ('activa','piloto','cancelacion_programada')
    and x.inicia_en>now() and x.termina_en>now()) then
    raise exception 'Ya hay un próximo periodo contratado. Cancélalo antes de pedir la mejora inmediata.' using errcode='23505';
  end if;
  if p_periodicidad is null or p_periodicidad not in ('semestral','anual')
     or p_plantas is null or p_plantas<1 then
    raise exception 'El periodo o el número de plantas no es válido.' using errcode='22023';
  end if;
  select * into v_plan from public.planes where codigo=p_plan_codigo and activo;
  if not found then raise exception 'El plan solicitado no está disponible.' using errcode='22023'; end if;
  select * into v_plan_actual from public.planes where codigo=s.plan_codigo;
  if not found or v_plan.precio_semestral_usd<=v_plan_actual.precio_semestral_usd then
    raise exception 'La mejora inmediata solo aplica a un plan superior al vigente.' using errcode='22023';
  end if;
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
  if v_planta_id is null then raise exception 'Se requiere una membresía activa para mejorar el plan.' using errcode='42501'; end if;
  -- Sin prorrateo: se cobra el periodo completo del plan nuevo.
  v_importe := (case p_periodicidad when 'anual' then v_plan.precio_anual_usd
    else v_plan.precio_semestral_usd end)*p_plantas;
  insert into public.organizacion_suscripciones(
    organizacion_id,plan_codigo,estado,periodicidad,plantas_incluidas,orden_compra,creada_por,mejora_de_suscripcion_id
  ) values (p_organizacion_id,p_plan_codigo,'solicitada',p_periodicidad,p_plantas,
    left(trim(coalesce(p_orden_compra,'')),100),p_usuario_id,s.id)
  returning * into v_nueva;
  insert into public.organizacion_pagos(suscripcion_id,estado,importe,moneda,referencia)
    values(v_nueva.id,'pendiente',v_importe,'USD',left(trim(coalesce(p_orden_compra,'')),100));
  insert into public.planta_auditoria(organizacion_id,planta_id,actor_id,accion,entidad,entidad_id,detalles)
    values(p_organizacion_id,v_planta_id,p_usuario_id,'mejora_plan_solicitada','suscripcion',v_nueva.id::text,
      jsonb_build_object('suscripcion_actual_id',s.id,'plan_actual',s.plan_codigo,'plan',p_plan_codigo,
        'periodicidad',p_periodicidad,'importe_usd',v_importe,'prorrateo',false,'pago_manual',true));
  return jsonb_build_object('id',v_nueva.id,'plan_codigo',v_nueva.plan_codigo,'estado',v_nueva.estado,
    'periodicidad',v_nueva.periodicidad,'plantas_incluidas',v_nueva.plantas_incluidas,
    'orden_compra',v_nueva.orden_compra,'importe_usd',v_importe,'mejora_de_suscripcion_id',s.id);
end $$;

revoke all on function public.organizacion_mejorar_plan(uuid,uuid,uuid,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.organizacion_mejorar_plan(uuid,uuid,uuid,text,text,integer,text) to service_role;

-- La verificación del pago de una mejora cierra el plan vigente como
-- 'reemplazada' y activa el nuevo desde ese instante, en la misma transacción.
create or replace function public.organizacion_admin_resolver_solicitud(
  p_suscripcion_id uuid,p_accion text,p_admin text
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare
  s public.organizacion_suscripciones%rowtype;
  v_anterior public.organizacion_suscripciones%rowtype;
  v_organizacion_id uuid;
  v_inicio timestamptz:=now();
  v_fin timestamptz;
  v_pago_id uuid;
  v_estado_pago text;
  v_mejora boolean;
  v_reemplazadas jsonb:='[]'::jsonb;
begin
  select organizacion_id into v_organizacion_id from public.organizacion_suscripciones where id=p_suscripcion_id;
  if v_organizacion_id is null then raise exception 'No encontramos esa solicitud.' using errcode='P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_organizacion_id::text,0));
  select * into s from public.organizacion_suscripciones where id=p_suscripcion_id for update;
  if not found then raise exception 'No encontramos esa solicitud.' using errcode='P0002'; end if;
  if s.estado not in ('solicitada','pendiente_pago') then raise exception 'La solicitud ya no está pendiente.' using errcode='23505'; end if;
  if p_accion is null or p_accion not in ('activar','piloto','rechazar','rechazar_comprobante') then raise exception 'Acción no válida.' using errcode='22023'; end if;
  if s.periodo_programado and p_accion not in ('activar','rechazar_comprobante') then
    raise exception 'Una renovación solo puede activarse tras verificar el pago; no se puede convertir en piloto.' using errcode='22023';
  end if;
  v_mejora:=s.mejora_de_suscripcion_id is not null;
  if v_mejora and p_accion='piloto' then
    raise exception 'Una mejora de plan solo puede activarse tras verificar el pago; no se puede convertir en piloto.' using errcode='22023';
  end if;
  if p_accion='activar' then
    select id,estado into v_pago_id,v_estado_pago from public.organizacion_pagos
      where suscripcion_id=s.id and estado in ('pendiente','comprobante_recibido')
      order by created_at desc limit 1 for update;
    if v_pago_id is null then raise exception 'No hay un pago pendiente vinculado para verificar.' using errcode='23514'; end if;
    if s.periodo_programado then
      if exists(select 1 from public.organizacion_suscripciones x where x.organizacion_id=s.organizacion_id
        and x.id<>s.id and x.estado in ('activa','piloto','cancelacion_programada') and x.inicia_en>now() and x.termina_en>now()) then
        raise exception 'Ya existe un próximo periodo contratado; revisa esta solicitud antes de validar otro pago.' using errcode='23505';
      end if;
      select greatest(v_inicio,termina_en) into v_inicio from public.organizacion_suscripciones
        where organizacion_id=s.organizacion_id and id<>s.id and estado in ('activa','piloto','cancelacion_programada')
          and termina_en>v_inicio and (inicia_en is null or inicia_en<=v_inicio)
        order by termina_en desc limit 1;
      v_inicio:=coalesce(v_inicio,now());
    elsif v_mejora then
      if exists(select 1 from public.organizacion_suscripciones x where x.organizacion_id=s.organizacion_id
        and x.id<>s.id and x.estado in ('activa','piloto','cancelacion_programada') and x.inicia_en>now() and x.termina_en>now()) then
        raise exception 'Hay un próximo periodo contratado que se traslaparía con la mejora; debe cancelarse antes de validar este pago.' using errcode='23505';
      end if;
      -- Se cierra cualquier periodo vigente (normalmente solo el plan que se
      -- mejora) antes de activar el nuevo: la exclusión no admite traslapes.
      for v_anterior in select * from public.organizacion_suscripciones x
        where x.organizacion_id=s.organizacion_id and x.id<>s.id
          and x.estado in ('activa','piloto','cancelacion_programada')
          and (x.termina_en is null or x.termina_en>v_inicio)
        for update
      loop
        update public.organizacion_suscripciones set estado='reemplazada',termina_en=v_inicio,renueva_en=null,
          periodo_programado=false,updated_at=now() where id=v_anterior.id;
        v_reemplazadas:=v_reemplazadas||jsonb_build_object('id',v_anterior.id,'plan',v_anterior.plan_codigo,
          'estado_anterior',v_anterior.estado,'termina_en_original',v_anterior.termina_en);
      end loop;
    end if;
    v_fin:=v_inicio+case s.periodicidad when 'mensual' then interval '1 month'
      when 'anual' then interval '12 months' else interval '6 months' end;
    update public.organizacion_pagos set estado='verificado',verificado_en=now(),verificado_por_admin=left(p_admin,254)
      where id=v_pago_id;
    update public.organizacion_pago_comprobante_intentos set estado='verificado',reviewed_at=now(),reviewed_by=left(p_admin,254)
      where pago_id=v_pago_id and estado='recibido';
    update public.organizacion_suscripciones set estado='activa',inicia_en=v_inicio,termina_en=v_fin,renueva_en=v_fin,
      periodo_programado=(v_inicio>now()),inicio_programado_en=v_inicio,updated_at=now() where id=s.id;
  elsif p_accion='rechazar_comprobante' then
    select id into v_pago_id from public.organizacion_pagos
      where suscripcion_id=s.id and estado='comprobante_recibido'
      order by recibido_en desc nulls last,created_at desc limit 1 for update;
    if v_pago_id is null then raise exception 'No hay un comprobante pendiente de revisión.' using errcode='23514'; end if;
    update public.organizacion_pago_comprobante_intentos set estado='rechazado',reviewed_at=now(),reviewed_by=left(p_admin,254)
      where pago_id=v_pago_id and estado='recibido';
    update public.organizacion_pagos set estado='pendiente',comprobante_path=null,recibido_en=null
      where id=v_pago_id;
  elsif p_accion='piloto' then
    v_fin:=v_inicio+interval '14 days';
    update public.organizacion_pagos set estado='anulado',verificado_por_admin=left(p_admin,254),
      notas=case when notas='' then 'Pago anulado al conceder piloto.' else notas||E'\nPago anulado al conceder piloto.' end
      where suscripcion_id=s.id and estado in ('pendiente','comprobante_recibido');
    update public.organizacion_pago_comprobante_intentos set estado='rechazado',reviewed_at=now(),reviewed_by=left(p_admin,254)
      where suscripcion_id=s.id and estado in ('carga_pendiente','recibido');
    update public.organizacion_suscripciones set estado='piloto',inicia_en=v_inicio,termina_en=v_fin,renueva_en=null,updated_at=v_inicio where id=s.id;
  else
    update public.organizacion_pagos set estado='rechazado',verificado_por_admin=left(p_admin,254)
      where suscripcion_id=s.id and estado in ('pendiente','comprobante_recibido');
    update public.organizacion_pago_comprobante_intentos set estado='rechazado',reviewed_at=now(),reviewed_by=left(p_admin,254)
      where suscripcion_id=s.id and estado in ('carga_pendiente','recibido');
    update public.organizacion_suscripciones set estado='cancelada',periodo_programado=false,updated_at=v_inicio where id=s.id;
  end if;
  insert into public.planta_auditoria(organizacion_id,actor_externo,accion,entidad,entidad_id,detalles)
  values(s.organizacion_id,left(p_admin,254),case when p_accion='rechazar_comprobante' then 'comprobante_pago_rechazado'
    when p_accion='piloto' then 'piloto_activado'
    when p_accion='activar' and s.periodo_programado then 'renovacion_pago_verificado'
    when p_accion='activar' and v_mejora then 'mejora_pago_verificado_plan_reemplazado'
    when p_accion='activar' then 'pago_verificado_plan_activado'
    when v_mejora then 'mejora_plan_rechazada' else 'solicitud_plan_rechazada' end,
    'suscripcion',s.id::text,jsonb_build_object('termina_en',v_fin,'inicio',v_inicio,'accion',p_accion,
      'comprobante_presentado',coalesce(v_estado_pago='comprobante_recibido',false))
      ||case when v_mejora then jsonb_build_object('mejora_de_suscripcion_id',s.mejora_de_suscripcion_id,
        'plan',s.plan_codigo,'reemplazadas',v_reemplazadas,'prorrateo',false) else '{}'::jsonb end);
  return jsonb_build_object('id',s.id,'accion',p_accion,'termina_en',v_fin,
    'renovacion_programada',s.periodo_programado,'inicia_en',v_inicio,
    'mejora_inmediata',v_mejora and p_accion='activar','reemplazadas',v_reemplazadas);
end $$;
revoke all on function public.organizacion_admin_resolver_solicitud(uuid,text,text) from public,anon,authenticated;
grant execute on function public.organizacion_admin_resolver_solicitud(uuid,text,text) to service_role;

notify pgrst, 'reload schema';

commit;
