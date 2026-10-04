begin;

-- Mantiene el mismo límite (1–99) tanto en el onboarding como al editar la
-- estructura. El trigger permite conservar filas históricas fuera de rango,
-- pero impide insertar o cambiar una etapa a un valor inválido.
create or replace function public.planta_validar_orden_etapa()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.etapa_orden not between 1 and 99 then
      raise exception 'El orden de etapa debe estar entre 1 y 99.' using errcode = '23514';
    end if;
  elsif new.etapa_orden is distinct from old.etapa_orden then
    if new.etapa_orden not between 1 and 99 then
      raise exception 'El orden de etapa debe estar entre 1 y 99.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists planta_activos_validar_orden_etapa on public.planta_activos;
create trigger planta_activos_validar_orden_etapa
  before insert or update on public.planta_activos
  for each row execute function public.planta_validar_orden_etapa();

revoke all on function public.planta_validar_orden_etapa() from public, anon, authenticated;

commit;
