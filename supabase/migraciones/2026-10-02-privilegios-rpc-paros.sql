-- Retira el acceso REST heredado a la firma de planta_reportar_paro que no
-- recibe planta_id. La app usa la RPC tenant-scoped con service_role.
-- RLS ya bloquea escrituras por esta firma; esto elimina el permiso público
-- innecesario y reduce el riesgo de una futura política demasiado amplia.
begin;

do $$
begin
  if to_regprocedure('public.planta_reportar_paro(text,text,text,timestamptz,text)') is not null then
    execute 'revoke all on function public.planta_reportar_paro(text,text,text,timestamptz,text) from public, anon, authenticated';
    execute 'grant execute on function public.planta_reportar_paro(text,text,text,timestamptz,text) to service_role';
  end if;
end $$;

commit;
