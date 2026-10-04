-- Amplía los folios nuevos para que reportes/cierres rápidos de la misma
-- máquina no choquen por el sufijo aleatorio original de solo 8 bits.
begin;

alter table public.planta_eventos
  drop constraint if exists planta_eventos_folio_formato;
alter table public.planta_eventos
  add constraint planta_eventos_folio_formato check (
    folio ~ '^L[0-9]{2}-[A-Z]{2}-[A-Z][0-9]{2}-[0-9]{8}-[0-9]{4}-[0-9A-Z]{2,12}$'
  );

create or replace function public.planta_folio_resistente_colisiones()
returns trigger
language plpgsql
set search_path=public
as $$
declare
  v_sufijo text;
  v_prefijo text;
  v_folio text;
  v_intento integer;
  v_duplicado boolean;
begin
  v_sufijo := substring(new.folio from '-([0-9A-Z]{2,12})$');
  if v_sufijo is null then
    return new;
  end if;
  v_prefijo := regexp_replace(new.folio,'-[0-9A-Z]{2,12}$','');

  -- Los folios antiguos se conservan. Los sufijos cortos que generan las
  -- RPC vigentes se reemplazan por 48 bits aleatorios; un intento duplicado
  -- se reintenta y el índice UNIQUE queda como última barrera concurrente.
  if length(v_sufijo) = 12 then
    if tg_table_name = 'planta_eventos' then
      select exists(select 1 from public.planta_eventos e
        where e.planta_id=new.planta_id and e.folio=new.folio) into v_duplicado;
    else
      select exists(select 1 from public.planta_solicitudes s
        where s.planta_id=new.planta_id and s.folio=new.folio) into v_duplicado;
    end if;
    if not v_duplicado then return new; end if;
  end if;

  for v_intento in 1..10 loop
    v_folio := v_prefijo || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
    if tg_table_name = 'planta_eventos' then
      select exists(select 1 from public.planta_eventos e
        where e.planta_id=new.planta_id and e.folio=v_folio) into v_duplicado;
    else
      select exists(select 1 from public.planta_solicitudes s
        where s.planta_id=new.planta_id and s.folio=v_folio) into v_duplicado;
    end if;
    if not v_duplicado then
      new.folio := v_folio;
      return new;
    end if;
  end loop;

  raise exception 'No fue posible generar un folio único; vuelve a intentar.'
    using errcode='23505';
end;
$$;

drop trigger if exists planta_eventos_folio_unico on public.planta_eventos;
create trigger planta_eventos_folio_unico
before insert on public.planta_eventos
for each row execute function public.planta_folio_resistente_colisiones();

drop trigger if exists planta_solicitudes_folio_unico on public.planta_solicitudes;
create trigger planta_solicitudes_folio_unico
before insert on public.planta_solicitudes
for each row execute function public.planta_folio_resistente_colisiones();

commit;
