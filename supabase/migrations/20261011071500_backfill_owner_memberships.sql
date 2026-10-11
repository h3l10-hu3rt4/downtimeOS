-- Backfill existing accounts into the current owner/membership model.
-- No plan prices, subscriptions, payments, or charges are created or changed.
begin;

with propietarios_faltantes as (
  select distinct on (p.organizacion_id) p.organizacion_id, p.user_id
  from public.planta_perfiles p
  where p.organizacion_id is not null
    and p.activo
    and p.rol in ('admin', 'direccion')
    and not exists (
      select 1
      from public.planta_perfiles x
      where x.organizacion_id = p.organizacion_id
        and x.activo
        and x.es_admin_cuenta
    )
  order by p.organizacion_id, p.created_at asc
)
update public.planta_perfiles p
set es_admin_cuenta = true,
    puede_administrar_facturacion = true
from propietarios_faltantes f
where p.organizacion_id = f.organizacion_id
  and p.user_id = f.user_id;

update public.organizaciones o
set propietario_id = (
  select p.user_id
  from public.planta_perfiles p
  where p.organizacion_id = o.id
    and p.activo
    and p.es_admin_cuenta
  order by p.created_at asc
  limit 1
)
where o.propietario_id is null
  and exists (
    select 1
    from public.planta_perfiles p
    where p.organizacion_id = o.id
      and p.activo
      and p.es_admin_cuenta
  );

insert into public.planta_membresias (
  user_id, organizacion_id, planta_id, rol, nombre,
  es_admin_cuenta, puede_administrar_facturacion, activo,
  onboarding_completado_en
)
select user_id, organizacion_id, planta_id, rol, nombre,
       es_admin_cuenta, puede_administrar_facturacion, activo,
       onboarding_completado_en
from public.planta_perfiles
where organizacion_id is not null
  and planta_id is not null
on conflict (user_id, planta_id) do nothing;

update public.planta_perfiles p
set onboarding_completado_en = coalesce(p.onboarding_completado_en, now())
where p.planta_id is not null
  and exists (select 1 from public.planta_lineas l where l.planta_id = p.planta_id)
  and exists (select 1 from public.planta_activos a where a.planta_id = p.planta_id);

update public.planta_membresias m
set onboarding_completado_en = coalesce(m.onboarding_completado_en, now())
where m.planta_id is not null
  and exists (select 1 from public.planta_lineas l where l.planta_id = m.planta_id)
  and exists (select 1 from public.planta_activos a where a.planta_id = m.planta_id);

commit;
