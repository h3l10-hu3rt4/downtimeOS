-- Defensa en profundidad: estas tablas no tienen políticas RLS y la app solo
-- las consulta desde APIs de servidor con service_role. El rol authenticated
-- no debe conservar permisos REST que, aunque hoy no exponen filas por RLS,
-- producen grants redundantes y pueden volverse efectivos si cambia la RLS.
begin;

revoke select on table
  public.planta_causas,
  public.planta_eventos_respaldo_duraciones
from authenticated;

commit;
