-- Comprobantes de pago privados, ligados a un pago/suscripción/organización.
-- Ejecutar después de 2026-10-01-endurecimiento-final-mvp.sql.
begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comprobantes-suscripcion', 'comprobantes-suscripcion', false, 10485760,
  array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update set public=false, file_size_limit=10485760,
  allowed_mime_types=excluded.allowed_mime_types;

create table if not exists public.organizacion_pago_comprobante_intentos (
  id uuid primary key,
  organizacion_id uuid not null references public.organizaciones(id) on delete cascade,
  suscripcion_id uuid not null references public.organizacion_suscripciones(id) on delete restrict,
  pago_id uuid not null references public.organizacion_pagos(id) on delete restrict,
  usuario_id uuid not null references auth.users(id) on delete restrict,
  storage_path text not null unique,
  content_type text not null check (content_type in ('application/pdf','image/jpeg','image/png')),
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  estado text not null default 'carga_pendiente'
    check (estado in ('carga_pendiente','recibido','verificado','rechazado')),
  created_at timestamptz not null default now(),
  uploaded_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by text not null default ''
);
create index if not exists organizacion_pago_comprobante_pago_fecha_idx
  on public.organizacion_pago_comprobante_intentos(pago_id, created_at desc);
alter table public.organizacion_pago_comprobante_intentos enable row level security;
revoke all on public.organizacion_pago_comprobante_intentos from public, anon, authenticated;
grant select, insert, update, delete on public.organizacion_pago_comprobante_intentos to service_role;

create or replace function public.organizacion_pago_crear_comprobante_intento(
  p_organizacion_id uuid,p_usuario_id uuid,p_pago_id uuid,p_intento_id uuid,
  p_storage_path text,p_content_type text,p_size_bytes bigint
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare
  pago public.organizacion_pagos%rowtype;
  sub public.organizacion_suscripciones%rowtype;
  v_planta_id uuid;
  v_extension text;
begin
  if p_content_type not in ('application/pdf','image/jpeg','image/png')
     or p_size_bytes is null or p_size_bytes<1 or p_size_bytes>10485760 then
    raise exception 'Tipo o tamaño de comprobante no permitido.' using errcode='22023';
  end if;
  v_extension:=case p_content_type when 'application/pdf' then 'pdf'
    when 'image/jpeg' then 'jpg' when 'image/png' then 'png' end;
  select * into pago from public.organizacion_pagos where id=p_pago_id for update;
  if not found then raise exception 'No encontramos ese pago.' using errcode='P0002'; end if;
  select * into sub from public.organizacion_suscripciones where id=pago.suscripcion_id for update;
  if not found or sub.organizacion_id<>p_organizacion_id then
    raise exception 'No encontramos ese pago.' using errcode='P0002';
  end if;
  if pago.estado<>'pendiente' or pago.comprobante_path is not null then
    raise exception 'Este pago ya no acepta comprobantes.' using errcode='23505';
  end if;
  if not exists(select 1 from public.organizaciones o where o.id=p_organizacion_id and o.propietario_id=p_usuario_id)
     and not exists(select 1 from public.planta_membresias m where m.organizacion_id=p_organizacion_id
       and m.user_id=p_usuario_id and m.activo and (m.puede_administrar_facturacion or m.es_admin_cuenta)) then
    raise exception 'No tienes permiso para adjuntar comprobantes.' using errcode='42501';
  end if;
  if p_storage_path !~ ('^'||p_organizacion_id::text||'/'||sub.id::text||'/'||pago.id::text||'/'||p_intento_id::text||'\.'||v_extension||'$') then
    raise exception 'La ruta de almacenamiento no corresponde al pago.' using errcode='22023';
  end if;
  select m.planta_id into v_planta_id from public.planta_membresias m
    where m.organizacion_id=p_organizacion_id and m.user_id=p_usuario_id and m.activo limit 1;
  insert into public.organizacion_pago_comprobante_intentos(
    id,organizacion_id,suscripcion_id,pago_id,usuario_id,storage_path,content_type,size_bytes
  ) values(p_intento_id,p_organizacion_id,sub.id,pago.id,p_usuario_id,p_storage_path,p_content_type,p_size_bytes);
  insert into public.planta_auditoria(organizacion_id,planta_id,actor_id,accion,entidad,entidad_id,detalles)
  values(p_organizacion_id,v_planta_id,p_usuario_id,'comprobante_carga_iniciada','pago',pago.id::text,
    jsonb_build_object('content_type',p_content_type,'size_bytes',p_size_bytes));
  return jsonb_build_object('id',p_intento_id,'pago_id',pago.id,'storage_path',p_storage_path);
end $$;
revoke all on function public.organizacion_pago_crear_comprobante_intento(uuid,uuid,uuid,uuid,text,text,bigint)
  from public,anon,authenticated;
grant execute on function public.organizacion_pago_crear_comprobante_intento(uuid,uuid,uuid,uuid,text,text,bigint)
  to service_role;

create or replace function public.organizacion_pago_confirmar_comprobante(
  p_organizacion_id uuid,p_usuario_id uuid,p_intento_id uuid
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare
  i public.organizacion_pago_comprobante_intentos%rowtype;
  pago public.organizacion_pagos%rowtype;
  v_planta_id uuid;
begin
  select * into i from public.organizacion_pago_comprobante_intentos
    where id=p_intento_id and organizacion_id=p_organizacion_id and usuario_id=p_usuario_id for update;
  if not found then raise exception 'No encontramos esa carga.' using errcode='P0002'; end if;
  if i.estado<>'carga_pendiente' or i.created_at<now()-interval '20 minutes' then
    raise exception 'La carga venció o ya fue procesada.' using errcode='23505';
  end if;
  if not exists(select 1 from public.organizaciones o where o.id=p_organizacion_id and o.propietario_id=p_usuario_id)
     and not exists(select 1 from public.planta_membresias m where m.organizacion_id=p_organizacion_id
       and m.user_id=p_usuario_id and m.activo and (m.puede_administrar_facturacion or m.es_admin_cuenta)) then
    raise exception 'No tienes permiso para adjuntar comprobantes.' using errcode='42501';
  end if;
  select * into pago from public.organizacion_pagos where id=i.pago_id and suscripcion_id=i.suscripcion_id for update;
  if not found or pago.estado<>'pendiente' or pago.comprobante_path is not null then
    raise exception 'El pago ya no acepta comprobantes.' using errcode='23505';
  end if;
  update public.organizacion_pago_comprobante_intentos set estado='recibido',uploaded_at=now()
    where id=i.id;
  update public.organizacion_pagos set estado='comprobante_recibido',comprobante_path=i.storage_path,recibido_en=now()
    where id=pago.id;
  select m.planta_id into v_planta_id from public.planta_membresias m
    where m.organizacion_id=p_organizacion_id and m.user_id=p_usuario_id and m.activo limit 1;
  insert into public.planta_auditoria(organizacion_id,planta_id,actor_id,accion,entidad,entidad_id,detalles)
  values(p_organizacion_id,v_planta_id,p_usuario_id,'comprobante_pago_recibido','pago',pago.id::text,
    jsonb_build_object('content_type',i.content_type,'size_bytes',i.size_bytes));
  return jsonb_build_object('pago_id',pago.id,'estado','comprobante_recibido');
end $$;
revoke all on function public.organizacion_pago_confirmar_comprobante(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.organizacion_pago_confirmar_comprobante(uuid,uuid,uuid) to service_role;

-- La aprobación manual acepta igualmente pagos con comprobante recibido y
-- pagos por OC/transferencia sin documento. Adjuntar nunca activa un plan.
create or replace function public.organizacion_admin_resolver_solicitud(
  p_suscripcion_id uuid,p_accion text,p_admin text
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare
  s public.organizacion_suscripciones%rowtype;
  v_organizacion_id uuid;
  v_inicio timestamptz:=now();
  v_fin timestamptz;
  v_pago_id uuid;
  v_estado_pago text;
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
    when p_accion='activar' then 'pago_verificado_plan_activado' else 'solicitud_plan_rechazada' end,
    'suscripcion',s.id::text,jsonb_build_object('termina_en',v_fin,'inicio',v_inicio,'accion',p_accion,
      'comprobante_presentado',coalesce(v_estado_pago='comprobante_recibido',false)));
  return jsonb_build_object('id',s.id,'accion',p_accion,'termina_en',v_fin,
    'renovacion_programada',s.periodo_programado,'inicia_en',v_inicio);
end $$;
revoke all on function public.organizacion_admin_resolver_solicitud(uuid,text,text) from public,anon,authenticated;
grant execute on function public.organizacion_admin_resolver_solicitud(uuid,text,text) to service_role;

commit;
