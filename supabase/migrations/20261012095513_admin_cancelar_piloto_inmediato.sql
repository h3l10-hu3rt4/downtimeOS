begin;

-- Finaliza un piloto de forma inmediata para QA comercial. Conserva el
-- registro histórico y deja la empresa elegible para activar otro nivel.
create or replace function public.organizacion_admin_cancelar_piloto(
  p_suscripcion_id uuid,
  p_admin text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_organizacion_id uuid;
  v_suscripcion public.organizacion_suscripciones%rowtype;
  v_planta_id uuid;
  v_termina_en timestamptz;
begin
  select organizacion_id into v_organizacion_id
    from public.organizacion_suscripciones where id = p_suscripcion_id;
  if v_organizacion_id is null then
    raise exception 'No encontramos el piloto solicitado.' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_organizacion_id::text, 0));
  select * into v_suscripcion from public.organizacion_suscripciones
    where id = p_suscripcion_id for update;
  if not found then
    raise exception 'No encontramos el piloto solicitado.' using errcode = 'P0002';
  end if;
  if v_suscripcion.estado <> 'piloto'
     or v_suscripcion.inicia_en is null or v_suscripcion.inicia_en > now()
     or v_suscripcion.termina_en is null or v_suscripcion.termina_en <= now() then
    raise exception 'Solo se puede cancelar un piloto vigente.' using errcode = '22023';
  end if;

  v_termina_en := v_suscripcion.termina_en;
  select id into v_planta_id from public.plantas
    where organizacion_id = v_organizacion_id and activa order by id limit 1;

  update public.organizacion_suscripciones
    set estado = 'cancelada', termina_en = now(), renueva_en = null,
        periodo_programado = false, updated_at = now()
    where id = v_suscripcion.id;

  insert into public.planta_auditoria(
    organizacion_id, planta_id, actor_externo, accion, entidad, entidad_id, detalles
  ) values (
    v_organizacion_id, v_planta_id, left(coalesce(p_admin, 'administrador'), 254),
    'piloto_cancelado_admin', 'suscripcion', v_suscripcion.id::text,
    jsonb_build_object('plan', v_suscripcion.plan_codigo,
      'termina_en_original', v_termina_en, 'cancelado_en', now(),
      'sin_cargo', true, 'reactivable_para_qa', true)
  );

  return jsonb_build_object('id', v_suscripcion.id, 'estado', 'cancelada',
    'plan_codigo', v_suscripcion.plan_codigo, 'termina_en', now());
end;
$$;

revoke all on function public.organizacion_admin_cancelar_piloto(uuid, text)
  from public, anon, authenticated;
grant execute on function public.organizacion_admin_cancelar_piloto(uuid, text)
  to service_role;

notify pgrst, 'reload schema';
commit;
