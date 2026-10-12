-- Las tablas se consultan solo desde APIs server-side con service_role.
-- Denegar explícitamente cualquier rol de cliente además de retirar grants.
begin;

drop policy if exists whatsapp_contactos_solo_backend on public.planta_whatsapp_contactos;
create policy whatsapp_contactos_solo_backend
  on public.planta_whatsapp_contactos for all to anon, authenticated
  using (false) with check (false);

drop policy if exists whatsapp_verificaciones_solo_backend on public.planta_whatsapp_verificaciones;
create policy whatsapp_verificaciones_solo_backend
  on public.planta_whatsapp_verificaciones for all to anon, authenticated
  using (false) with check (false);

create index if not exists planta_whatsapp_contactos_org_idx
  on public.planta_whatsapp_contactos(organizacion_id);
create index if not exists planta_whatsapp_contactos_planta_usuario_idx
  on public.planta_whatsapp_contactos(planta_id, user_id);
create index if not exists planta_whatsapp_verificaciones_usuario_planta_idx
  on public.planta_whatsapp_verificaciones(user_id, planta_id);

commit;
