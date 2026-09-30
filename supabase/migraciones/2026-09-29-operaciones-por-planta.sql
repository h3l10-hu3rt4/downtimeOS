-- Toda escritura operativa debe conocer la planta. Esta sobrecarga conserva
-- la transacción atómica de captura y elimina la ambigüedad de códigos como
-- M-01, que ahora pueden existir en varias empresas.
create or replace function public.planta_reportar_paro(
  p_planta_id uuid,
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
  select * into v_activo from public.planta_activos
    where planta_id = p_planta_id and id = p_activo_id and activo;
  if not found then
    raise exception 'El activo % no existe o está inactivo en esta planta.', p_activo_id using errcode = 'P0001';
  end if;

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
    upper(substr(md5(p_planta_id::text || p_activo_id || clock_timestamp()::text), 1, 2));

  insert into public.planta_estados
    (planta_id, activo_id, estado, desde, causa_id, causa_libre, actualizado_en)
  values (p_planta_id, v_activo.id, 'STOP', v_desde, v_causa.id, v_libre, now())
  on conflict (planta_id, activo_id) do update set
    estado = excluded.estado, desde = excluded.desde, causa_id = excluded.causa_id,
    causa_libre = excluded.causa_libre, actualizado_en = excluded.actualizado_en
  returning * into v_estado;

  insert into public.planta_solicitudes
    (planta_id, folio, activo_id, causa_id, causa_libre, desde, reportado_por, estado)
  values (p_planta_id, v_folio, v_activo.id, v_causa.id, v_libre, v_desde,
    left(coalesce(p_reportado_por, ''), 120), 'pendiente')
  returning * into v_solicitud;

  return jsonb_build_object('estado', to_jsonb(v_estado), 'solicitud', to_jsonb(v_solicitud));
end;
$$;

comment on function public.planta_reportar_paro(uuid, text, text, text, timestamptz, text) is
  'Registra atómicamente un STOP y solicitud, aislados dentro de una planta.';
