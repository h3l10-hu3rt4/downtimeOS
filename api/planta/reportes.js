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
 *   · Sin esos campos → genera el REPORTE EJECUTIVO con su propio análisis
 *     (proveedor activo para Finanzas, razonamiento low) para el periodo. Antes vivía en `api/reportes/index.js`;
 *     se fusionó aquí porque es la misma familia de "reportes" y el cliente
 *     que lo llama (Dirección) ya distingue el caso por su propio flujo.
 */
import { reportarParo } from '../../lib/planta.js';
import { crearReporte, enviarSolicitudAprobacion, urlFirmadaReporte } from '../../lib/integraciones.js';
import { ruta, json, leerCuerpo } from '../../lib/http.js';
import { exigirRolProducto, sesionDesdeEncabezado } from '../../lib/cuenta.js';

export default ruta(['POST'], async (req, res) => {
  const sesion = await sesionDesdeEncabezado(req.headers?.authorization);
  const plantaId = sesion.perfil.planta_id;
  const cuerpo = leerCuerpo(req);

  if (cuerpo.activo_id && cuerpo.causa_id) {
    exigirRolProducto(sesion, ['operaciones', 'operador']);
    const reporte = await reportarParo(cuerpo, { plantaId });
    let alerta = null;
    if (process.env.WHATSAPP_ALERTAS_ACTIVAS === 'true' && reporte.solicitud) {
      try { alerta = await enviarSolicitudAprobacion(reporte.solicitud, null, { plantaId }); }
      catch (error) { console.error('[downtimeos] no se pudo enviar aprobación WhatsApp:', error.message); }
    }
    return json(res, 201, { ok: true, mensaje: 'Paro reportado a Supervisión.', ...reporte, alerta });
  }

  exigirRolProducto(sesion, ['direccion']);
  const reporte = await crearReporte({ desde: cuerpo.desde ?? null, hasta: cuerpo.hasta ?? null, plantaId });
  const url = await urlFirmadaReporte(reporte);
  return json(res, 201, { ok: true, reporte: { ...reporte, url } });
});
