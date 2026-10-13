alter table public.planta_whatsapp_verificaciones
  add column if not exists canal text not null default 'whatsapp';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'planta_whatsapp_verificaciones_canal_check'
      and conrelid = 'public.planta_whatsapp_verificaciones'::regclass
  ) then
    alter table public.planta_whatsapp_verificaciones
      add constraint planta_whatsapp_verificaciones_canal_check
      check (canal in ('whatsapp', 'sms'));
  end if;
end $$;

comment on column public.planta_whatsapp_verificaciones.canal is
  'Canal que entrega y valida el desafío; los códigos OTP de SMS permanecen en Twilio Verify.';
