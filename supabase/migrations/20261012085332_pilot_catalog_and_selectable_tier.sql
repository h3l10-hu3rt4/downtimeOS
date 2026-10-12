begin;

-- Restaura el catálogo inicial si los datos semilla se perdieron. Los importes
-- son los ya publicados en la migración de onboarding; nunca se sobrescriben
-- configuraciones existentes ni se crea un pago/cargo.
insert into public.planes(
  codigo, nombre, precio_mensual_usd, precio_semestral_usd, precio_anual_usd,
  max_activos, max_plantas, funciones
) values
  ('starter', 'Starter', 49, 294, 588, 5, 1, '{"exportacion":true}'::jsonb),
  ('pro', 'Pro', 149, 894, 1788, 20, 1, '{"finanzas":true,"whatsapp":true,"pdf_mensual":true,"ai_finanzas":true,"ai_operaciones":true,"exportacion":true}'::jsonb),
  ('enterprise', 'Enterprise', 299, 1794, 3588, null, null, '{"multiplanta":true,"erp":true,"telemetria_opcional":true,"finanzas":true,"whatsapp":true,"pdf_mensual":true,"ai_finanzas":true,"ai_operaciones":true,"exportacion":true}'::jsonb)
on conflict (codigo) do nothing;

-- Pilotos internos de 14 días para poder validar cada nivel sin pagos. El
-- backend recibe el plan elegido y vuelve a imponer sus límites reales.
create or replace function public.organizacion_admin_activar_piloto_titular(
  p_organizacion_id uuid,
  p_propietario_id uuid,
  p_plan_codigo text,
  p_admin text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org public.organizaciones%rowtype;
  v_plan public.planes%rowtype;
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

  select * into v_plan from public.planes
    where codigo = lower(trim(coalesce(p_plan_codigo, ''))) and activo for share;
  if not found then
    raise exception 'El plan solicitado no está disponible para piloto.' using errcode = '22023';
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
  if v_plan.codigo = 'enterprise' and v_num_plantas < 3 then
    raise exception 'El piloto Enterprise requiere al menos tres plantas activas.' using errcode = '23514';
  end if;
  if v_plan.max_plantas is not null and v_num_plantas > v_plan.max_plantas then
    raise exception 'La empresa supera el límite de plantas del plan elegido.' using errcode = '23514';
  end if;
  select p.id into v_planta_id from public.plantas p
    where p.organizacion_id = v_org.id and p.activa order by p.id limit 1;

  if v_plan.max_activos is not null and exists (
    select 1 from public.planta_activos a join public.plantas p on p.id = a.planta_id
    where p.organizacion_id = v_org.id and p.activa and a.activo
    group by p.id having count(*) > v_plan.max_activos
  ) then
    raise exception 'La empresa supera el límite de activos del plan elegido.' using errcode = '23514';
  end if;

  insert into public.organizacion_suscripciones(
    organizacion_id, plan_codigo, estado, periodicidad, inicia_en, termina_en,
    renueva_en, plantas_incluidas, notas_comerciales, creada_por, updated_at
  ) values (
    v_org.id, v_plan.codigo, 'piloto', null, now(), v_fin,
    null, v_num_plantas, format('Piloto de 14 días del plan %s concedido por administración al titular fundador.', v_plan.nombre),
    p_propietario_id, now()
  ) returning * into v_suscripcion;

  insert into public.planta_auditoria(
    organizacion_id, planta_id, actor_externo, accion, entidad, entidad_id, detalles
  ) values (
    v_org.id, v_planta_id, left(coalesce(p_admin, 'administrador'), 254),
    'piloto_activado', 'suscripcion', v_suscripcion.id::text,
    jsonb_build_object('termina_en', v_fin, 'inicio', now(), 'accion', 'piloto_por_correo',
      'plan', v_plan.codigo, 'plantas_incluidas', v_num_plantas, 'propietario_id', p_propietario_id)
  );

  return jsonb_build_object('id', v_suscripcion.id, 'estado', 'piloto',
    'plan_codigo', v_plan.codigo, 'inicia_en', v_suscripcion.inicia_en,
    'termina_en', v_fin, 'plantas_incluidas', v_num_plantas);
end;
$$;

revoke all on function public.organizacion_admin_activar_piloto_titular(uuid,uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.organizacion_admin_activar_piloto_titular(uuid,uuid,text,text)
  to service_role;

commit;
