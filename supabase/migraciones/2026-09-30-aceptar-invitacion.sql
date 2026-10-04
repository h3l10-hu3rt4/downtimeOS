-- Activación explícita y ligada a una sola invitación.
-- Ejecutar tras 2026-09-30-onboarding-y-base-mvp.sql.
begin;

alter table public.planta_invitaciones
  add column if not exists acceptance_token_hash text,
  add column if not exists expires_at timestamptz;

-- Las invitaciones pendientes existentes reciben como máximo 72 horas desde
-- su envío original; no se prolonga su vigencia al aplicar esta migración.
update public.planta_invitaciones
set expires_at = coalesce(enviada_en, created_at, now()) + interval '72 hours'
where expires_at is null;

alter table public.planta_invitaciones
  alter column expires_at set default (now() + interval '72 hours'),
  alter column expires_at set not null;

create index if not exists planta_invitaciones_pendiente_expiracion_idx
  on public.planta_invitaciones(expires_at)
  where estado = 'pendiente';

-- Las invitaciones emitidas antes de disponer de un token ligado al enlace no
-- se pueden asociar inequívocamente a su callback. Se revocan y desactivan;
-- el administrador deberá volver a invitarlas para emitir un enlace seguro.
update public.planta_membresias m
set activo = false
from public.planta_invitaciones i
where i.estado = 'pendiente'
  and i.acceptance_token_hash is null
  and i.auth_user_id = m.user_id
  and i.organizacion_id = m.organizacion_id
  and i.planta_id = m.planta_id;

update public.planta_perfiles p
set activo = false
from public.planta_invitaciones i
where i.estado = 'pendiente'
  and i.acceptance_token_hash is null
  and i.auth_user_id = p.user_id
  and i.organizacion_id = p.organizacion_id
  and i.planta_id = p.planta_id;

update public.planta_invitaciones
set estado = 'revocada'
where estado = 'pendiente'
  and acceptance_token_hash is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.planta_invitaciones'::regclass
      and conname = 'planta_invitaciones_pendiente_token_check'
  ) then
    alter table public.planta_invitaciones
      add constraint planta_invitaciones_pendiente_token_check
      check (estado <> 'pendiente' or acceptance_token_hash is not null);
  end if;
end $$;

create or replace function public.planta_aceptar_invitacion(
  p_invitacion_id uuid,
  p_usuario_id uuid,
  p_email text,
  p_token_hash text
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  i public.planta_invitaciones%rowtype;
  m public.planta_membresias%rowtype;
begin
  if p_usuario_id is null or p_email is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'El enlace de invitación no es válido.' using errcode = '42501';
  end if;

  select * into i
  from public.planta_invitaciones
  where id = p_invitacion_id
  for update;

  if not found
    or i.auth_user_id is distinct from p_usuario_id
    or lower(trim(i.email)) is distinct from lower(trim(p_email))
    or i.acceptance_token_hash is distinct from p_token_hash then
    raise exception 'El enlace de invitación no corresponde a esta cuenta.' using errcode = '42501';
  end if;

  if i.estado = 'aceptada' then
    select * into m from public.planta_membresias
    where user_id = i.auth_user_id
      and organizacion_id = i.organizacion_id
      and planta_id = i.planta_id
      and activo
    for update;
    if not found then raise exception 'La invitación ya no está activa.' using errcode = 'P0002'; end if;
    return jsonb_build_object('invitacion_id', i.id, 'planta_id', i.planta_id, 'estado', 'aceptada');
  end if;

  if i.estado <> 'pendiente' then
    raise exception 'La invitación ya no está vigente.' using errcode = 'P0002';
  end if;

  -- La comparación ocurre en la transacción de aceptación, no en el cliente.
  -- En el límite exacto la invitación ya está vencida.
  if i.expires_at <= clock_timestamp() then
    raise exception 'La invitación venció; solicita que la reenvíen.' using errcode = 'P0002';
  end if;

  update public.planta_membresias
  set activo = true,
      rol = i.rol,
      nombre = i.nombre,
      es_admin_cuenta = i.es_admin_cuenta,
      puede_administrar_facturacion = i.puede_administrar_facturacion
  where user_id = i.auth_user_id
    and organizacion_id = i.organizacion_id
    and planta_id = i.planta_id
    and not activo;

  if not found then
    raise exception 'No existe una membresía pendiente para esta invitación.' using errcode = 'P0002';
  end if;

  -- Membresías son la fuente de autorización. Actualiza la fila de
  -- compatibilidad heredada solo si existe para esta misma planta; un usuario
  -- multiplanta puede no tener una fila legacy por cada membresía.
  update public.planta_perfiles
  set activo = true,
      rol = i.rol,
      nombre = i.nombre,
      es_admin_cuenta = i.es_admin_cuenta,
      puede_administrar_facturacion = i.puede_administrar_facturacion
  where user_id = i.auth_user_id
    and organizacion_id = i.organizacion_id
    and planta_id = i.planta_id;

  update public.planta_invitaciones
  set estado = 'aceptada', aceptada_en = now()
  where id = i.id and estado = 'pendiente';

  insert into public.planta_auditoria(
    organizacion_id, planta_id, actor_id, accion, entidad, entidad_id, detalles
  ) values (
    i.organizacion_id, i.planta_id, i.auth_user_id,
    'invitacion_aceptada', 'invitacion', i.id::text,
    jsonb_build_object('rol', i.rol)
  );

  return jsonb_build_object('invitacion_id', i.id, 'planta_id', i.planta_id, 'estado', 'aceptada');
end
$$;

revoke all on function public.planta_aceptar_invitacion(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.planta_aceptar_invitacion(uuid, uuid, text, text)
  to service_role;

commit;
