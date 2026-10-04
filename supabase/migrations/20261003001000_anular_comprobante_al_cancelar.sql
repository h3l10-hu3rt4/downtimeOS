-- No dejes un comprobante como "recibido" cuando su pago se anuló.
-- El archivo se conserva en Storage para auditoría, pero queda ligado a un
-- intento anulado y no se puede usar para confirmar un pago distinto.
begin;

alter table public.organizacion_pago_comprobante_intentos
  drop constraint if exists organizacion_pago_comprobante_intentos_estado_check;
alter table public.organizacion_pago_comprobante_intentos
  add constraint organizacion_pago_comprobante_intentos_estado_check
  check (estado in ('carga_pendiente','recibido','verificado','rechazado','anulado'));

create or replace function public.organizacion_cancelar_suscripcion(
  p_organizacion_id uuid,p_suscripcion_id uuid,p_planta_id uuid,p_actor_id uuid
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
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
    update public.organizacion_pago_comprobante_intentos set estado='anulado',reviewed_at=now(),reviewed_by='Sistema'
      where suscripcion_id=s.id and estado in ('carga_pendiente','recibido');
  elsif s.estado in ('activa','piloto') and s.termina_en is not null and s.termina_en>now() then
    v_estado:='cancelacion_programada'; v_accion:='cancelacion_programada';
  elsif s.estado in ('solicitada','pendiente_pago','activa','piloto','vencida','suspendida') then
    v_estado:='cancelada'; v_accion:='suscripcion_cancelada';
    update public.organizacion_pagos set estado='anulado',notas=case when notas='' then 'Solicitud de plan cancelada.' else notas || E'\nSolicitud de plan cancelada.' end
      where suscripcion_id=s.id and estado in ('pendiente','comprobante_recibido');
    update public.organizacion_pago_comprobante_intentos set estado='anulado',reviewed_at=now(),reviewed_by='Sistema'
      where suscripcion_id=s.id and estado in ('carga_pendiente','recibido');
  else
    raise exception 'El estado actual no permite cancelar esta suscripción.' using errcode='22023';
  end if;
  update public.organizacion_suscripciones set estado=v_estado,periodo_programado=false,updated_at=now() where id=s.id;
  insert into public.planta_auditoria(organizacion_id,planta_id,actor_id,accion,entidad,entidad_id,detalles)
    values(p_organizacion_id,p_planta_id,p_actor_id,v_accion,'suscripcion',s.id::text,
      jsonb_build_object('estado_anterior',s.estado,'estado_nuevo',v_estado,'termina_en',s.termina_en,'reembolso_manual',v_reembolso_manual));
  return jsonb_build_object('id',s.id,'estado',v_estado,'termina_en',s.termina_en,'reembolso_manual',v_reembolso_manual);
end $$;

revoke all on function public.organizacion_cancelar_suscripcion(uuid,uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.organizacion_cancelar_suscripcion(uuid,uuid,uuid,uuid)
  to service_role;

commit;
