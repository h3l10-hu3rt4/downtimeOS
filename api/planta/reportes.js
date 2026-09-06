/**
 * POST /api/planta/reportes
 *
 * Dos usos bajo la misma ruta, para no exceder el límite de funciones
 * serverless del plan (Vercel Hobby: 12). Se distinguen por la forma del
 * cuerpo, el mismo criterio que ya usa `api/whatsapp/alerta.js`:
 *
 *   · Con `activo_id` y `causa_id` → captura ATÓMICA de un paro desde el
 *     perfil Operador (lo que este archivo hacía originalmente). El servidor
 *     delega a una transacción de Supabase para que STOP y solicitud no
 *     diverjan.
 *   · Sin esos campos → genera el REPORTE EJECUTIVO en PDF a partir de un
 *     análisis de IA o de un periodo. Antes vivía en `api/reportes/index.js`;
 *     se fusionó aquí porque es la misma familia de "reportes" y el cliente
 *     que lo llama (Dirección) ya distingue el caso por su propio flujo.
 */
import { reportarParo } from '../../lib/planta.js';
import { crearReporte, urlFirmadaReporte } from '../../lib/integraciones.js';
import { ruta, json, leerCuerpo } from '../../lib/http.js';

export default ruta(['POST'], async (req, res) => {
  const cuerpo = leerCuerpo(req);

  if (cuerpo.activo_id && cuerpo.causa_id) {
    const reporte = await reportarParo(cuerpo);
    return json(res, 201, { ok: true, mensaje: 'Paro reportado a Supervisión.', ...reporte });
  }

  const reporte = await crearReporte({
    analisisId: cuerpo.analisis_id ?? null, desde: cuerpo.desde ?? null, hasta: cuerpo.hasta ?? null,
  });
  const url = await urlFirmadaReporte(reporte);
  return json(res, 201, { ok: true, reporte: { ...reporte, url } });
});
