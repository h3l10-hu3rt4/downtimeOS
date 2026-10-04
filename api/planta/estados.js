/**
 * POST /api/planta/estados
 *
 * Ruta heredada, conservada para responder con una migración clara a clientes
 * antiguos. Los cambios RUN/STOP deben usar los flujos transaccionales de
 * `/api/planta/reportes`, que también guardan solicitudes y eventos.
 */
import { ruta, json } from '../../lib/http.js';
import { exigirRolProducto, sesionDesdeEncabezado } from '../../lib/cuenta.js';
import { exigirPlanActivo } from '../../lib/planes.js';

export default ruta(['POST'], async (req, res) => {
  const sesion = await sesionDesdeEncabezado(req.headers?.authorization, req.headers?.['x-downtimeos-planta']);
  await exigirPlanActivo(sesion);
  exigirRolProducto(sesion, ['operaciones', 'direccion']);
  return json(res, 409, {
    ok: false,
    error: 'El estado no se puede cambiar directamente. Usa el flujo de reporte o cierre de paro para conservar el historial.',
  });
});
