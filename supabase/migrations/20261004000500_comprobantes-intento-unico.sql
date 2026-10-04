-- Una sola carga activa por pago incluso si dos solicitudes llegan en paralelo.
-- Las filas históricas de recibidos/verificados/rechazados permanecen intactas.
begin;

create unique index if not exists organizacion_pago_comprobante_un_intento_pendiente_idx
  on public.organizacion_pago_comprobante_intentos(pago_id)
  where estado='carga_pendiente';

commit;
