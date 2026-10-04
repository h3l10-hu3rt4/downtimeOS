-- La vista enriquecida también debe conservar el tenant.
-- Ejecutar después de 2026-09-29-mvp-multitenant.sql.
begin;

drop view if exists public.planta_bitacora;

create view public.planta_bitacora as
select
  e.planta_id,
  e.folio,
  e.activo_id,
  a.linea_id,
  a.nombre as activo_nombre,
  a.etapa,
  a.cuello_botella,
  e.causa_id,
  c.etiqueta as causa_etiqueta,
  e.causa_libre,
  case when c.requiere_texto and e.causa_libre is not null
       then e.causa_libre || ' (otros)' else c.etiqueta end as causa_mostrada,
  e.minutos,
  e.inicio,
  e.jornada,
  e.turno,
  e.retroactivo,
  e.tarifa_aplicada,
  e.costo_mxn,
  e.origen,
  e.registrado_por,
  e.created_at
from public.planta_eventos e
join public.planta_activos a
  on a.planta_id = e.planta_id and a.id = e.activo_id
join public.planta_causas c on c.id = e.causa_id;

commit;
