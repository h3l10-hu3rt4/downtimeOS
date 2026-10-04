-- Reanuda altas donde Supabase Auth creó al usuario, pero el cliente perdió
-- la respuesta antes de confirmar la RPC que crea organización y planta.
begin;

create or replace function public.organizacion_reanudar_registro_empresa(
  p_usuario_id uuid,
  p_empresa text,
  p_planta text,
  p_nombre text
) returns jsonb
language plpgsql
security invoker
set search_path=public,pg_temp as $$
declare
  v_empresa public.organizaciones%rowtype;
  v_planta public.plantas%rowtype;
begin
  if p_usuario_id is null
     or char_length(trim(coalesce(p_empresa,''))) not between 2 and 160
     or char_length(trim(coalesce(p_planta,''))) not between 2 and 160
     or char_length(trim(coalesce(p_nombre,''))) not between 2 and 120 then
    raise exception 'Los datos de empresa, planta o responsable no son válidos.' using errcode='22023';
  end if;

  -- Comparte el mismo lock que el alta normal. Si la primera RPC aún está en
  -- curso, espera a conocer si confirmó o revirtió antes de reanudar.
  perform pg_advisory_xact_lock(hashtextextended(p_usuario_id::text,0));

  select o.* into v_empresa
  from public.organizaciones o
  join public.planta_membresias m on m.organizacion_id=o.id
    and m.user_id=p_usuario_id and m.activo and m.rol='direccion'
  join public.plantas p on p.id=m.planta_id and p.organizacion_id=o.id
  where o.propietario_id=p_usuario_id
  order by m.created_at asc
  limit 1;

  if found then
    select p.* into v_planta
    from public.plantas p
    join public.planta_membresias m on m.planta_id=p.id
      and m.organizacion_id=p.organizacion_id
      and m.user_id=p_usuario_id and m.activo and m.rol='direccion'
    where p.organizacion_id=v_empresa.id
    order by m.created_at asc
    limit 1;

    if not found then
      raise exception 'La cuenta existe, pero su planta inicial requiere revisión.' using errcode='55000';
    end if;

    return jsonb_build_object(
      'empresa',jsonb_build_object('id',v_empresa.id,'nombre',v_empresa.nombre),
      'planta',jsonb_build_object('id',v_planta.id,'nombre',v_planta.nombre,'codigo',v_planta.codigo),
      'usuario',jsonb_build_object('id',p_usuario_id,'rol','direccion')
    );
  end if;

  -- Una organización propietaria sin una membresía inicial completa no debe
  -- provocar una segunda empresa silenciosa; requiere revisión del estado.
  if exists (select 1 from public.organizaciones where propietario_id=p_usuario_id) then
    raise exception 'La cuenta existe, pero su planta inicial requiere revisión.' using errcode='55000';
  end if;

  return public.organizacion_registrar_empresa(p_usuario_id,p_empresa,p_planta,p_nombre);
end;
$$;

revoke all on function public.organizacion_reanudar_registro_empresa(uuid,text,text,text)
  from public,anon,authenticated;
grant execute on function public.organizacion_reanudar_registro_empresa(uuid,text,text,text)
  to service_role;

commit;
