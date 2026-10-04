-- DowntimeOS · capacidad por etapa y reporte atómico desde piso
-- Ejecutar en Supabase SQL Editor después de 2026-09-05-integraciones.sql.

-- Cada etapa es una capacidad en serie dentro de su línea. Sus equipos son
-- paralelos y equivalentes: detener uno reduce la capacidad en 1 / N; detener
-- el único equipo de una etapa deja la línea sin producción.
create or replace function public.planta_factor_capacidad(p_activo text)
returns numeric language sql stable as $$
  select coalesce(
    1.0 / nullif(count(*) filter (where par.activo), 0),
    0
  )
  from public.planta_activos objetivo
  join public.planta_activos par
    on par.linea_id = objetivo.linea_id
   and par.etapa = objetivo.etapa
 where objetivo.id = p_activo
$$;

comment on function public.planta_factor_capacidad(text) is
  'Pérdida de capacidad de un activo: 1/N para N equipos paralelos de la misma etapa.';

-- Corrige el catálogo heredado: Empaque K-01 es una estación única de L-02.
update public.planta_activos set cuello_botella = true where id = 'K-01';

-- La tarifa de una hora de paro equivale a la tarifa de la línea multiplicada
-- por la porción de capacidad que esa máquina deja fuera. C-01, R-01 y K-01
-- son estaciones únicas (100%); M-01/M-02, P-01/P-02 y E-01/E-02 aportan 50%.
create or replace function public.planta_tarifa_aplicable(p_activo text)
returns numeric language sql stable as $$
  select coalesce((
    select sum(linea.tarifa_hora)
      from public.planta_activos linea
     where linea.linea_id = activo.linea_id
       and linea.activo
  ), 0) * public.planta_factor_capacidad(p_activo)
  from public.planta_activos activo
 where activo.id = p_activo
$$;

-- Una captura de piso no puede quedar "a medias": el estado STOP y su
-- solicitud se escriben en la misma transacción. Esto evita que la tableta
-- muestre un paro que el tablero de Supervisión nunca recibió.
create or replace function public.planta_reportar_paro(
  p_activo_id text,
  p_causa_id text,
  p_causa_libre text default null,
  p_desde timestamptz default null,
  p_reportado_por text default ''
)
returns jsonb
language plpgsql
as $$
declare
  v_activo public.planta_activos%rowtype;
  v_causa public.planta_causas%rowtype;
  v_desde timestamptz := coalesce(p_desde, now());
  v_libre text;
  v_folio text;
  v_estado public.planta_estados%rowtype;
  v_solicitud public.planta_solicitudes%rowtype;
begin
  select * into v_activo from public.planta_activos where id = p_activo_id and activo;
  if not found then raise exception 'El activo % no existe o está inactivo.', p_activo_id using errcode = 'P0001'; end if;

  select * into v_causa from public.planta_causas where id = p_causa_id;
  if not found then raise exception 'La causa % no existe.', p_causa_id using errcode = 'P0001'; end if;

  v_libre := nullif(left(trim(coalesce(p_causa_libre, '')), 120), '');
  if v_causa.requiere_texto and coalesce(length(v_libre), 0) < 3 then
    raise exception 'La causa «Otros» necesita una descripción de al menos 3 caracteres.' using errcode = 'P0001';
  end if;
  if not v_causa.requiere_texto then v_libre := null; end if;

  v_folio := replace(v_activo.linea_id, '-', '') || '-' || v_activo.tipo || '-' ||
    replace(v_activo.id, '-', '') || '-' ||
    to_char(v_desde at time zone 'America/Mexico_City', 'YYYYMMDD-HH24MI') || '-' ||
    upper(substr(md5(p_activo_id || clock_timestamp()::text), 1, 2));

  insert into public.planta_estados (activo_id, estado, desde, causa_id, causa_libre, actualizado_en)
  values (v_activo.id, 'STOP', v_desde, v_causa.id, v_libre, now())
  on conflict (activo_id) do update set
    estado = excluded.estado, desde = excluded.desde, causa_id = excluded.causa_id,
    causa_libre = excluded.causa_libre, actualizado_en = excluded.actualizado_en
  returning * into v_estado;

  insert into public.planta_solicitudes
    (folio, activo_id, causa_id, causa_libre, desde, reportado_por, estado)
  values (v_folio, v_activo.id, v_causa.id, v_libre, v_desde, left(coalesce(p_reportado_por, ''), 120), 'pendiente')
  returning * into v_solicitud;

  return jsonb_build_object('estado', to_jsonb(v_estado), 'solicitud', to_jsonb(v_solicitud));
end;
$$;

comment on function public.planta_reportar_paro(text, text, text, timestamptz, text) is
  'Registra atómicamente un STOP y la solicitud pendiente que debe ver Supervisión.';
