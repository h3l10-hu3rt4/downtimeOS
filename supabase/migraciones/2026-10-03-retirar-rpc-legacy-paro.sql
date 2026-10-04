-- Retira la RPC histórica sin ámbito de planta. La aplicación usa la firma
-- tenant-scoped que valida la planta y persiste la identidad del operador.
-- La función antigua tiene un ON CONFLICT incompatible con el índice actual
-- y no debe quedar disponible ni siquiera para service_role.
begin;

drop function if exists public.planta_reportar_paro(text,text,text,timestamptz,text);

commit;
