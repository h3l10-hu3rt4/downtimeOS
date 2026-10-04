begin;

-- Edita únicamente los atributos operativos del equipo. Los eventos y las
-- solicitudes conservan sus tarifas, costos y demás datos congelados.
create or replace function public.planta_editar_activo(
  p_planta_id uuid,
  p_usuario_id uuid,
  p_activo jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_activo_id text;
  v_linea_id text;
  v_tipo text;
  v_nombre text;
  v_etapa text;
  v_etapa_orden smallint;
  v_tarifa_hora numeric(12,2);
  v_cuello_botella boolean;
  v_organizacion_id uuid;
  v_actual public.planta_activos%rowtype;
begin
  if p_planta_id is null or p_usuario_id is null or jsonb_typeof(p_activo) is distinct from 'object' then
    raise exception 'Los datos del equipo no son válidos.' using errcode = '22023';
  end if;

  -- El formato de id identifica al equipo; nunca se reasigna en una edición.
  if jsonb_typeof(p_activo->'id') is distinct from 'string' then
    raise exception 'El código del equipo es obligatorio.' using errcode = '22023';
  end if;
  v_activo_id := p_activo->>'id';
  if v_activo_id !~ '^[A-Z]-[0-9]{2}$' then
    raise exception 'El código del equipo no es válido.' using errcode = '22023';
  end if;

  if jsonb_typeof(p_activo->'linea_id') is distinct from 'string'
     or jsonb_typeof(p_activo->'tipo') is distinct from 'string'
     or jsonb_typeof(p_activo->'nombre') is distinct from 'string'
     or jsonb_typeof(p_activo->'etapa') is distinct from 'string'
     or (jsonb_typeof(p_activo->'etapa_orden') is distinct from 'number'
         and jsonb_typeof(p_activo->'etapa_orden') is distinct from 'string')
     or (jsonb_typeof(p_activo->'tarifa_hora') is distinct from 'number'
         and jsonb_typeof(p_activo->'tarifa_hora') is distinct from 'string')
     or jsonb_typeof(p_activo->'cuello_botella') is distinct from 'boolean' then
    raise exception 'Completa todos los campos operativos con valores válidos.' using errcode = '22023';
  end if;

  v_linea_id := upper(btrim(p_activo->>'linea_id'));
  v_tipo := upper(btrim(p_activo->>'tipo'));
  v_nombre := btrim(p_activo->>'nombre');
  v_etapa := btrim(p_activo->>'etapa');

  if v_linea_id !~ '^L-[0-9]{2}$'
     or v_tipo !~ '^[A-Z]{2}$'
     or char_length(v_nombre) not between 2 and 120
     or char_length(v_etapa) not between 2 and 120 then
    raise exception 'Línea, tipo, nombre o etapa no cumplen el formato permitido.' using errcode = '22023';
  end if;

  if (p_activo->>'etapa_orden') !~ '^[0-9]{1,2}$' then
    raise exception 'El orden de etapa debe ser un entero entre 1 y 99.' using errcode = '22023';
  end if;
  v_etapa_orden := (p_activo->>'etapa_orden')::smallint;
  if v_etapa_orden not between 1 and 99 then
    raise exception 'El orden de etapa debe ser un entero entre 1 y 99.' using errcode = '22023';
  end if;

  if (p_activo->>'tarifa_hora') !~ '^[0-9]{1,10}([.][0-9]{1,2})?$' then
    raise exception 'La tarifa por hora debe ser un importe positivo con hasta dos decimales.' using errcode = '22023';
  end if;
  v_tarifa_hora := (p_activo->>'tarifa_hora')::numeric;
  if v_tarifa_hora not between 1 and 1000000 then
    raise exception 'La tarifa por hora debe estar entre 1 y 1,000,000.' using errcode = '22023';
  end if;
  v_cuello_botella := (p_activo->>'cuello_botella')::boolean;

  -- Igual que el resto de operaciones de estructura: solo Dirección/admin
  -- con membresía activa puede modificar la configuración de la planta.
  select p.organizacion_id into v_organizacion_id
    from public.plantas p
    join public.planta_membresias m
      on m.planta_id = p.id
     and m.organizacion_id = p.organizacion_id
     and m.user_id = p_usuario_id
     and m.activo
     and m.rol in ('direccion', 'admin')
   where p.id = p_planta_id
     and p.activa
   for share of p, m;
  if not found then
    raise exception 'No tienes permiso para editar equipos de esta planta.' using errcode = '42501';
  end if;

  -- Comparte el lock de estructura con las altas y el archivo de líneas para
  -- que la línea no pueda archivarse entre su validación y el cambio del activo.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_organizacion_id::text, 0)
  );

  -- Bloqueo compartido con los RPC de paro y archivo: no permite editar un
  -- activo mientras una operación concurrente lo está deteniendo/cerrando.
  select a.* into v_actual
    from public.planta_activos a
   where a.planta_id = p_planta_id
     and a.id = v_activo_id
   for update;
  if not found or not v_actual.activo or v_actual.archivado_en is not null then
    raise exception 'El equipo no existe o está archivado.' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.planta_estados e
     where e.planta_id = p_planta_id
       and e.activo_id = v_activo_id
       and e.estado = 'STOP'
  ) then
    raise exception 'Cierra el paro vigente antes de editar este equipo.' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.planta_solicitudes s
     where s.planta_id = p_planta_id
       and s.activo_id = v_activo_id
       and not s.cerrada
  ) then
    raise exception 'Resuelve los reportes abiertos antes de editar este equipo.' using errcode = '23514';
  end if;

  if not exists (
    select 1 from public.planta_lineas l
     where l.planta_id = p_planta_id
       and l.id = v_linea_id
       and l.activa
       and l.archivado_en is null
  ) then
    raise exception 'La línea elegida no existe o está archivada en esta planta.' using errcode = '23503';
  end if;

  update public.planta_activos
     set linea_id = v_linea_id,
         tipo = v_tipo,
         nombre = v_nombre,
         etapa = v_etapa,
         etapa_orden = v_etapa_orden,
         tarifa_hora = v_tarifa_hora,
         cuello_botella = v_cuello_botella
   where planta_id = p_planta_id
     and id = v_activo_id;

  return jsonb_build_object(
    'accion', 'actualizar_activo',
    'activo_id', v_activo_id,
    'linea_id', v_linea_id
  );
end;
$$;

revoke all on function public.planta_editar_activo(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.planta_editar_activo(uuid, uuid, jsonb)
  to service_role;

notify pgrst, 'reload schema';

commit;
