-- El onboarding de estructura pertenece a la planta, no a cada miembro.
-- Al completar por primera vez líneas y equipos, libera a todos los miembros
-- activos; una invitación posterior hereda el estado ya configurado.
begin;

create or replace function public.planta_marcar_onboarding_configurada()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.activo and new.onboarding_completado_en is null
     and exists (
       select 1 from public.planta_lineas l
       where l.planta_id = new.planta_id
     )
     and exists (
       select 1 from public.planta_activos a
       where a.planta_id = new.planta_id
     ) then
    new.onboarding_completado_en := clock_timestamp();
  end if;
  return new;
end;
$$;

revoke all on function public.planta_marcar_onboarding_configurada() from public, anon, authenticated;

drop trigger if exists planta_membresias_onboarding_configurada_ins on public.planta_membresias;
create trigger planta_membresias_onboarding_configurada_ins
before insert on public.planta_membresias
for each row execute function public.planta_marcar_onboarding_configurada();

drop trigger if exists planta_membresias_onboarding_configurada_upd on public.planta_membresias;
create trigger planta_membresias_onboarding_configurada_upd
before update of activo, planta_id on public.planta_membresias
for each row execute function public.planta_marcar_onboarding_configurada();

-- Backfill para membresías activas creadas antes de esta corrección.
update public.planta_membresias m
set onboarding_completado_en = clock_timestamp()
where m.activo and m.onboarding_completado_en is null
  and exists (select 1 from public.planta_lineas l where l.planta_id = m.planta_id)
  and exists (select 1 from public.planta_activos a where a.planta_id = m.planta_id);

update public.planta_perfiles p
set onboarding_completado_en = coalesce(p.onboarding_completado_en, m.onboarding_completado_en)
from public.planta_membresias m
where m.user_id = p.user_id and m.organizacion_id = p.organizacion_id
  and m.planta_id = p.planta_id and m.activo
  and m.onboarding_completado_en is not null
  and p.onboarding_completado_en is null;

-- Cuando la primera máquina se inserta en la transacción atómica de alta,
-- estructura y estados ya quedan creados en el mismo commit. Sincroniza todos
-- los miembros activos preexistentes de esa planta.
create or replace function public.planta_completar_onboarding_miembros_activos()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from public.planta_lineas l where l.planta_id = new.planta_id) then
    update public.planta_membresias m
    set onboarding_completado_en = coalesce(m.onboarding_completado_en, clock_timestamp())
    where m.planta_id = new.planta_id and m.activo and m.onboarding_completado_en is null;

    update public.planta_perfiles p
    set onboarding_completado_en = coalesce(p.onboarding_completado_en, clock_timestamp())
    where p.planta_id = new.planta_id and p.activo and p.onboarding_completado_en is null;
  end if;
  return new;
end;
$$;

revoke all on function public.planta_completar_onboarding_miembros_activos() from public, anon, authenticated;

drop trigger if exists planta_activos_completar_onboarding_miembros on public.planta_activos;
create trigger planta_activos_completar_onboarding_miembros
after insert on public.planta_activos
for each row execute function public.planta_completar_onboarding_miembros_activos();

commit;
