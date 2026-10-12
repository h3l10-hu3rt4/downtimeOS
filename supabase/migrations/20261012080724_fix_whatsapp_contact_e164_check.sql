begin;

alter table public.planta_whatsapp_contactos
  drop constraint if exists planta_whatsapp_contactos_telefono_e164_check;
alter table public.planta_whatsapp_contactos
  add constraint planta_whatsapp_contactos_telefono_e164_check
  check (telefono_e164 ~ '^\+[1-9][0-9]{7,14}$');

commit;
