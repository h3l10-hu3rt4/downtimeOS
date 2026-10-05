-- Concede un piloto de 14 días desde administración, identificado por el
-- propietario fundador. Solo service_role puede ejecutar este RPC.
begin;

create or replace function public.organizacion_admin_activar_piloto_titular(
  p_organizacion_id uuid,
  p_propietario_id uuid,
  p_admin text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org public.organizaciones%rowtype;
  v_suscripcion public.organizacion_suscripciones%rowtype;
  v_planta_id uuid;
  v_num_plantas integer;
  v_fin timestamptz := now() + interval '14 days';
begin
  perform pg_advisory_xact_lock(hashtextextended(p_organizacion_id::text, 0));

  select * into v_org from public.organizaciones
    where id = p_organizacion_id and propietario_id = p_propietario_id for update;
  if not found then
    raise exception 'No encontramos una empresa cuyo titular coincida con ese correo.' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.planta_perfiles p
    where p.organizacion_id = v_org.id and p.user_id = p_propietario_id
      and p.es_admin_cuenta and p.activo
  ) then
    raise exception 'La cuenta ya no tiene un administrador fundador activo.' using errcode = '42501';
  end if;

  update public.organizacion_suscripciones set estado = 'vencida', updated_at = now()
    where organizacion_id = v_org.id and estado in ('activa','piloto','cancelacion_programada')
      and termina_en is not null and termina_en <= now();
  if exists (
    select 1 from public.organizacion_suscripciones s where s.organizacion_id = v_org.id
      and s.estado in ('solicitada','pendiente_pago','activa','piloto','cancelacion_programada')
      and (s.estado in ('solicitada','pendiente_pago') or s.termina_en is null or s.termina_en > now())
  ) then
    raise exception 'La empresa ya tiene una solicitud pendiente o un plan vigente.' using errcode = '23505';
  end if;

  select count(*) into v_num_plantas
    from public.plantas p where p.organizacion_id = v_org.id and p.activa;
  if v_num_plantas < 1 then
    raise exception 'La empresa debe tener al menos una planta activa para recibir el piloto.' using errcode = '23514';
  end if;
  select p.id into v_planta_id from public.plantas p
    where p.organizacion_id = v_org.id and p.activa order by p.id limit 1;
  if exists (
    select 1 from public.planta_activos a join public.plantas p on p.id = a.planta_id
    where p.organizacion_id = v_org.id and p.activa and a.activo
    group by p.organizacion_id having count(*) > 5
  ) then
    raise exception 'La empresa supera el límite de cinco máquinas del piloto Starter.' using errcode = '23514';
  end if;

  insert into public.organizacion_suscripciones(
    organizacion_id, plan_codigo, estado, periodicidad, inicia_en, termina_en,
    renueva_en, plantas_incluidas, notas_comerciales, creada_por, updated_at
  ) values (
    v_org.id, 'starter', 'piloto', 'semestral', now(), v_fin,
    null, v_num_plantas, 'Piloto de 14 días concedido por administración al titular fundador.',
    p_propietario_id, now()
  ) returning * into v_suscripcion;

  insert into public.planta_auditoria(
    organizacion_id, planta_id, actor_externo, accion, entidad, entidad_id, detalles
  ) values (
    v_org.id, v_planta_id, left(coalesce(p_admin, 'administrador'), 254),
    'piloto_activado', 'suscripcion', v_suscripcion.id::text,
    jsonb_build_object('termina_en', v_fin, 'inicio', now(), 'accion', 'piloto_por_correo',
      'plan', 'starter', 'plantas_incluidas', v_num_plantas, 'propietario_id', p_propietario_id)
  );

  return jsonb_build_object('id', v_suscripcion.id, 'estado', 'piloto', 'plan_codigo', 'starter',
    'inicia_en', v_suscripcion.inicia_en, 'termina_en', v_fin, 'plantas_incluidas', v_num_plantas);
end;
$$;

revoke all on function public.organizacion_admin_activar_piloto_titular(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.organizacion_admin_activar_piloto_titular(uuid,uuid,text) to service_role;

commit;
