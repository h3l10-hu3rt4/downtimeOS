-- Recupera avisos cuyo worker murió, manteniendo un único propietario de lease.
-- Ejecutar solo después de revisar el historial de migraciones de la base destino.
alter table public.organizacion_suscripcion_avisos
  add column if not exists lease_until timestamptz,
  add column if not exists lease_token uuid;

-- Filas procesando previas a esta migración quedan recuperables tras dos minutos
-- desde su última reserva. No se modifican filas enviadas ni las fallidas.
update public.organizacion_suscripcion_avisos
set lease_until = iniciada_en + interval '2 minutes'
where estado = 'procesando' and lease_until is null;

create or replace function public.organizacion_reservar_aviso_suscripcion(
  p_organizacion_id uuid,p_suscripcion_id uuid,p_tipo text,p_destinatario text
) returns uuid
language plpgsql security invoker set search_path=public as $$
declare
  v_token uuid;
  v_ahora timestamptz := clock_timestamp();
begin
  if p_tipo not in ('7_dias','1_dia') or left(p_destinatario,254) = '' then
    raise exception 'Los datos del aviso de suscripción no son válidos.' using errcode='22023';
  end if;
  if not exists (
    select 1 from public.organizacion_suscripciones s
    where s.id=p_suscripcion_id and s.organizacion_id=p_organizacion_id
  ) then
    raise exception 'La suscripción no pertenece a la organización indicada.' using errcode='23503';
  end if;

  insert into public.organizacion_suscripcion_avisos(
    organizacion_id,suscripcion_id,tipo,destinatario,estado,iniciada_en,intentos,lease_token,lease_until
  ) values (
    p_organizacion_id,p_suscripcion_id,p_tipo,left(p_destinatario,254),'procesando',v_ahora,1,gen_random_uuid(),v_ahora + interval '2 minutes'
  )
  on conflict(suscripcion_id,tipo) do update set
    estado='procesando',
    destinatario=excluded.destinatario,
    iniciada_en=v_ahora,
    ultimo_error='',
    intentos=organizacion_suscripcion_avisos.intentos+1,
    lease_token=gen_random_uuid(),
    lease_until=v_ahora + interval '2 minutes'
  where organizacion_suscripcion_avisos.estado='error'
     or (organizacion_suscripcion_avisos.estado='procesando'
         and (organizacion_suscripcion_avisos.lease_until is null
              or organizacion_suscripcion_avisos.lease_until <= v_ahora))
  returning lease_token into v_token;

  return v_token;
end $$;

revoke all on function public.organizacion_reservar_aviso_suscripcion(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.organizacion_reservar_aviso_suscripcion(uuid,uuid,text,text) to service_role;
