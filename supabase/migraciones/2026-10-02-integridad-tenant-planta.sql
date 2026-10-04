-- La organización almacenada en cada perfil/membresía/invitación debe ser la
-- misma organización propietaria de la planta referenciada. Sin esta relación
-- compuesta, una escritura privilegiada equivocada podría cruzar tenants.
begin;

do $$
begin
  if exists (
    select 1 from public.planta_membresias m join public.plantas p on p.id=m.planta_id
    where p.organizacion_id is distinct from m.organizacion_id
  ) or exists (
    select 1 from public.planta_perfiles m join public.plantas p on p.id=m.planta_id
    where p.organizacion_id is distinct from m.organizacion_id
  ) or exists (
    select 1 from public.planta_invitaciones m join public.plantas p on p.id=m.planta_id
    where p.organizacion_id is distinct from m.organizacion_id
  ) then
    raise exception 'Hay perfiles, membresías o invitaciones cuyo tenant no coincide con su planta; corrige esas filas antes de aplicar esta migración.';
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='plantas_id_organizacion_id_key'
    and conrelid='public.plantas'::regclass) then
    alter table public.plantas add constraint plantas_id_organizacion_id_key unique (id, organizacion_id);
  end if;
  if not exists (select 1 from pg_constraint where conname='planta_membresias_planta_tenant_fkey'
    and conrelid='public.planta_membresias'::regclass) then
    alter table public.planta_membresias add constraint planta_membresias_planta_tenant_fkey
      foreign key (planta_id, organizacion_id) references public.plantas(id, organizacion_id)
      on delete cascade not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname='planta_perfiles_planta_tenant_fkey'
    and conrelid='public.planta_perfiles'::regclass) then
    alter table public.planta_perfiles add constraint planta_perfiles_planta_tenant_fkey
      foreign key (planta_id, organizacion_id) references public.plantas(id, organizacion_id)
      on delete cascade not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname='planta_invitaciones_planta_tenant_fkey'
    and conrelid='public.planta_invitaciones'::regclass) then
    alter table public.planta_invitaciones add constraint planta_invitaciones_planta_tenant_fkey
      foreign key (planta_id, organizacion_id) references public.plantas(id, organizacion_id)
      on delete cascade not valid;
  end if;
end $$;

alter table public.planta_membresias validate constraint planta_membresias_planta_tenant_fkey;
alter table public.planta_perfiles validate constraint planta_perfiles_planta_tenant_fkey;
alter table public.planta_invitaciones validate constraint planta_invitaciones_planta_tenant_fkey;

commit;
