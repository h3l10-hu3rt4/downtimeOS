-- Crea organización, planta inicial, perfil y membresía en una sola transacción.
-- Ejecutar después de 2026-09-30-onboarding-y-base-mvp.sql.
begin;

create or replace function public.organizacion_registrar_empresa(
  p_usuario_id uuid,
  p_empresa text,
  p_planta text,
  p_nombre text
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
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

  perform pg_advisory_xact_lock(hashtextextended(p_usuario_id::text,0));
  insert into public.organizaciones(nombre,propietario_id)
    values(trim(p_empresa),p_usuario_id) returning * into v_empresa;
  insert into public.plantas(organizacion_id,nombre)
    values(v_empresa.id,trim(p_planta)) returning * into v_planta;
  insert into public.planta_perfiles(
    user_id,organizacion_id,planta_id,rol,nombre,planta_codigo,
    es_admin_cuenta,puede_administrar_facturacion,activo
  ) values(
    p_usuario_id,v_empresa.id,v_planta.id,'direccion',trim(p_nombre),v_planta.codigo,
    true,true,true
  );
  insert into public.planta_membresias(
    user_id,organizacion_id,planta_id,rol,nombre,es_admin_cuenta,
    puede_administrar_facturacion,activo
  ) values(
    p_usuario_id,v_empresa.id,v_planta.id,'direccion',trim(p_nombre),true,true,true
  );
  insert into public.planta_auditoria(
    organizacion_id,planta_id,actor_id,accion,entidad,entidad_id,detalles
  ) values(
    v_empresa.id,v_planta.id,p_usuario_id,'empresa_registrada','organizacion',
    v_empresa.id::text,jsonb_build_object('planta_id',v_planta.id)
  );

  return jsonb_build_object(
    'empresa',jsonb_build_object('id',v_empresa.id,'nombre',v_empresa.nombre),
    'planta',jsonb_build_object('id',v_planta.id,'nombre',v_planta.nombre,'codigo',v_planta.codigo),
    'usuario',jsonb_build_object('id',p_usuario_id,'rol','direccion')
  );
end $$;

revoke all on function public.organizacion_registrar_empresa(uuid,text,text,text)
  from public,anon,authenticated;
grant execute on function public.organizacion_registrar_empresa(uuid,text,text,text)
  to service_role;

commit;
