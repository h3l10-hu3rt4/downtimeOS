begin;

-- Cambia únicamente el nivel de un piloto vigente; preserva fechas y pagos.
create or replace function public.organizacion_admin_cambiar_plan_piloto(
  p_suscripcion_id uuid,
  p_plan_codigo text,
  p_admin text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_suscripcion public.organizacion_suscripciones%rowtype;
  v_plan public.planes%rowtype;
  v_planta_id uuid;
  v_num_plantas integer;
  v_plan_anterior text;
  v_organizacion_id uuid;
begin
  select organizacion_id into v_organizacion_id
    from public.organizacion_suscripciones where id = p_suscripcion_id;
  if v_organizacion_id is null then
    raise exception 'No encontramos el piloto solicitado.' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_organizacion_id::text, 0));
  select * into v_suscripcion from public.organizacion_suscripciones
    where id = p_suscripcion_id for update;
  if not found then raise exception 'No encontramos el piloto solicitado.' using errcode = 'P0002'; end if;
  if v_suscripcion.estado <> 'piloto' or v_suscripcion.inicia_en is null or v_suscripcion.inicia_en > now()
     or v_suscripcion.termina_en is null or v_suscripcion.termina_en <= now() then
    raise exception 'Solo se puede cambiar el plan de un piloto vigente.' using errcode = '22023';
  end if;
  if lower(trim(coalesce(p_plan_codigo, ''))) not in ('starter','pro','enterprise')
     or lower(trim(p_plan_codigo)) = v_suscripcion.plan_codigo then
    raise exception 'El plan debe ser distinto y válido.' using errcode = '22023';
  end if;
  select * into v_plan from public.planes
    where codigo = lower(trim(p_plan_codigo)) and activo for share;
  if not found then raise exception 'El plan seleccionado no está disponible.' using errcode = '22023'; end if;

  select count(*) into v_num_plantas from public.plantas
    where organizacion_id = v_suscripcion.organizacion_id and activa;
  if v_plan.codigo = 'enterprise' and v_num_plantas < 3 then
    raise exception 'Enterprise requiere al menos tres plantas activas.' using errcode = '23514';
  end if;
  if v_num_plantas < 1 or (v_plan.max_plantas is not null and v_num_plantas > v_plan.max_plantas) then
    raise exception 'La empresa supera el límite de plantas del plan elegido.' using errcode = '23514';
  end if;
  if v_plan.max_activos is not null and exists (
    select 1 from public.planta_activos a join public.plantas p on p.id = a.planta_id
    where p.organizacion_id = v_suscripcion.organizacion_id and p.activa and a.activo
    group by p.id having count(*) > v_plan.max_activos
  ) then
    raise exception 'La empresa supera el límite de activos del plan elegido.' using errcode = '23514';
  end if;
  select id into v_planta_id from public.plantas
    where organizacion_id = v_suscripcion.organizacion_id and activa order by id limit 1;

  v_plan_anterior := v_suscripcion.plan_codigo;
  update public.organizacion_suscripciones set plan_codigo = v_plan.codigo, updated_at = now()
    where id = v_suscripcion.id returning * into v_suscripcion;
  insert into public.planta_auditoria(
    organizacion_id, planta_id, actor_externo, accion, entidad, entidad_id, detalles
  ) values (
    v_suscripcion.organizacion_id, v_planta_id, left(coalesce(p_admin, 'administrador'), 254),
    'piloto_plan_cambiado', 'suscripcion', v_suscripcion.id::text,
    jsonb_build_object('plan_anterior', v_plan_anterior, 'plan_nuevo', v_plan.codigo,
      'inicia_en', v_suscripcion.inicia_en, 'termina_en', v_suscripcion.termina_en,
      'sin_cargo', true, 'sin_reinicio_plazo', true)
  );
  return jsonb_build_object('id', v_suscripcion.id, 'plan_codigo', v_plan.codigo,
    'plan_anterior', v_plan_anterior, 'inicia_en', v_suscripcion.inicia_en,
    'termina_en', v_suscripcion.termina_en, 'estado', v_suscripcion.estado);
end;
$$;

revoke all on function public.organizacion_admin_cambiar_plan_piloto(uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.organizacion_admin_cambiar_plan_piloto(uuid,text,text)
  to service_role;

notify pgrst, 'reload schema';
commit;
