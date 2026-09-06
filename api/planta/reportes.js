/**
 * POST /api/planta/reportes
 *
 * Entrada única para una captura de paro desde el perfil Operador. El servidor
 * delega a una transacción de Supabase para que STOP y solicitud no diverjan.
 */
import { reportarParo } from '../../lib/planta.js';
import { ruta, json, leerCuerpo } from '../../lib/http.js';

export default ruta(['POST'], async (req, res) => {
  const cuerpo = leerCuerpo(req);
  if (!cuerpo.activo_id || !cuerpo.causa_id) {
    return json(res, 400, { ok: false, error: 'Faltan activo_id o causa_id.' });
  }

  const reporte = await reportarParo(cuerpo);
  return json(res, 201, { ok: true, mensaje: 'Paro reportado a Supervisión.', ...reporte });
});
