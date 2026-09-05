/**
 * Bandeja de solicitudes de paro que Mantenimiento revisa.
 *
 *   POST   /api/planta/solicitudes                 alta desde piso
 *   PATCH  /api/planta/solicitudes?folio=...       resolver o reclasificar
 *   DELETE /api/planta/solicitudes?folio=...       deshacer un reporte
 *
 * PATCH acepta dos formas:
 *   { accion: 'resolver',      resolucion: 'aprobada'|'rechazada', causa_id?, por? }
 *   { accion: 'reclasificar',  causa_id, causa_libre? }
 *   { accion: 'cerrar' }       al volver el activo a producción
 *
 * ⚠️ Ninguna de ellas toca `desde`. El cronómetro y la pérdida de un paro
 * corren desde que el OPERADOR lo reportó, no desde que Mantenimiento lo
 * valida: si el reloj esperara a la validación, la planta perdería tiempo
 * auditable justo en los paros peor atendidos, que son los que más importa
 * medir.
 */
import {
  crearSolicitud, resolverSolicitud, reclasificarSolicitud,
  cerrarSolicitudesDe, eliminarSolicitud,
} from '../../lib/planta.js';
import { ruta, json, leerCuerpo } from '../../lib/http.js';

export default ruta(['POST', 'PATCH', 'DELETE'], async (req, res) => {
  if (req.method === 'POST') {
    const solicitud = await crearSolicitud(leerCuerpo(req));
    console.log(`[downtimeos] SOLICITUD ${solicitud.folio} -> ${solicitud.activo_id}`);
    return json(res, 201, { ok: true, mensaje: 'Solicitud registrada.', solicitud });
  }

  if (req.method === 'DELETE') {
    const folio = req.query?.folio;
    if (!folio) return json(res, 400, { ok: false, error: 'Falta el parámetro `folio`.' });
    const resultado = await eliminarSolicitud(folio);
    return json(res, 200, { ok: true, mensaje: 'Solicitud eliminada.', ...resultado });
  }

  const cuerpo = leerCuerpo(req);
  const accion = cuerpo.accion;

  if (accion === 'cerrar') {
    if (!cuerpo.activo_id) return json(res, 400, { ok: false, error: 'Falta `activo_id`.' });
    const resultado = await cerrarSolicitudesDe(cuerpo.activo_id);
    return json(res, 200, { ok: true, mensaje: 'Solicitudes cerradas.', ...resultado });
  }

  const folio = req.query?.folio;
  if (!folio) return json(res, 400, { ok: false, error: 'Falta el parámetro `folio`.' });

  if (accion === 'reclasificar') {
    const solicitud = await reclasificarSolicitud(folio, cuerpo.causa_id, cuerpo.causa_libre);
    return json(res, 200, { ok: true, mensaje: 'Causa reclasificada.', solicitud });
  }

  if (accion === 'resolver') {
    const solicitud = await resolverSolicitud(folio, cuerpo.resolucion, {
      causa_id: cuerpo.causa_id ?? null,
      causa_libre: cuerpo.causa_libre ?? null,
      por: cuerpo.por ?? '',
    });
    return json(res, 200, { ok: true, mensaje: 'Solicitud resuelta.', solicitud });
  }

  return json(res, 400, {
    ok: false,
    error: 'La acción debe ser "resolver", "reclasificar" o "cerrar".',
  });
});
