/**
 * Bandeja de solicitudes de paro que Mantenimiento revisa.
 *
 *   POST   /api/planta/solicitudes                 alias atómico de reporte desde piso
 *   PATCH  /api/planta/solicitudes?folio=...       resolver o reclasificar
 *   DELETE /api/planta/solicitudes?folio=...       rechazado para preservar auditoría
 *
 * POST delega en la misma transacción de STOP + solicitud que `/reportes`;
 * no puede crear una solicitud huérfana sin cambiar el estado del equipo.
 * PATCH acepta dos formas:
 *   { accion: 'resolver',      resolucion: 'aprobada'|'rechazada', causa_id? }
 *   { accion: 'descartar',     por? }   rechaza y deshace el paro (misma regla que WhatsApp)
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
  reportarParo, cerrarParoReportado, resolverSolicitud, descartarSolicitud, reclasificarSolicitud,
} from '../../lib/planta.js';
import { ruta, json, leerCuerpo } from '../../lib/http.js';
import { exigirRolProducto, sesionDesdeEncabezado } from '../../lib/cuenta.js';
import { exigirPlanActivo } from '../../lib/planes.js';

function solicitudVisible(solicitud) {
  if (!solicitud) return solicitud;
  const { reportado_por_user_id, ...visible } = solicitud;
  return visible;
}

export default ruta(['POST', 'PATCH', 'DELETE'], async (req, res) => {
  const sesion = await sesionDesdeEncabezado(req.headers?.authorization, req.headers?.['x-downtimeos-planta']);
  // El plan bloquea nuevos reportes, no la resolución/limpieza de solicitudes
  // que ya estaban abiertas cuando venció.
  if (req.method === 'POST') await exigirPlanActivo(sesion);
  const plantaId = sesion.perfil.planta_id;
  if (req.method === 'POST') {
    exigirRolProducto(sesion, ['operaciones', 'operador']);
    const cuerpo = leerCuerpo(req);
    const reporte = await reportarParo({
      activo_id: cuerpo.activo_id,
      causa_id: cuerpo.causa_id,
      causa_libre: cuerpo.causa_libre ?? null,
      desde: cuerpo.desde ?? null,
      reportado_por: sesion.perfil.nombre || sesion.user.email || '',
      reportado_por_user_id: sesion.user.id,
    }, { plantaId, organizacionId: sesion.perfil.organizacion_id, usuarioId: sesion.user.id });
    console.log(`[downtimeos] SOLICITUD ${reporte.solicitud.folio} -> ${reporte.solicitud.activo_id}`);
    return json(res, 201, {
      ok: true, mensaje: 'Paro reportado a Supervisión.',
      ...reporte, solicitud: solicitudVisible(reporte.solicitud),
    });
  }

  if (req.method === 'DELETE') {
    const folio = req.query?.folio;
    if (!folio) return json(res, 400, { ok: false, error: 'Falta el parámetro `folio`.' });
    exigirRolProducto(sesion, ['operaciones']);
    return json(res, 409, { ok: false, error: 'Las solicitudes no se eliminan para conservar la auditoría. Usa la acción "descartar" si el reporte fue un falso positivo.' });
  }

  const cuerpo = leerCuerpo(req);
  const accion = cuerpo.accion;

  if (accion === 'cerrar') {
    exigirRolProducto(sesion, ['operaciones']);
    if (!cuerpo.activo_id) return json(res, 400, { ok: false, error: 'Falta `activo_id`.' });
    const resultado = await cerrarParoReportado({
      activo_id: cuerpo.activo_id,
      registrado_por: sesion.perfil.nombre || sesion.user.email || '',
      origen: 'mantenimiento',
    }, {
      plantaId,
      organizacionId: sesion.perfil.organizacion_id,
      usuarioId: sesion.user.id,
    });
    return json(res, 200, { ok: true, mensaje: 'Paro cerrado y guardado.', ...resultado });
  }

  const folio = req.query?.folio;
  if (!folio) return json(res, 400, { ok: false, error: 'Falta el parámetro `folio`.' });

  if (accion === 'reclasificar') {
    exigirRolProducto(sesion, ['operaciones']);
    const solicitud = await reclasificarSolicitud(folio, cuerpo.causa_id, cuerpo.causa_libre, { plantaId });
    return json(res, 200, { ok: true, mensaje: 'Causa reclasificada.', solicitud: solicitudVisible(solicitud) });
  }

  if (accion === 'descartar') {
    exigirRolProducto(sesion, ['operaciones']);
    const resultado = await descartarSolicitud(folio, { por: sesion.perfil.nombre || sesion.user.email || '', plantaId });
    return json(res, 200, { ok: true, mensaje: 'Reporte descartado.', ...resultado, solicitud: solicitudVisible(resultado.solicitud) });
  }

  if (accion === 'resolver') {
    exigirRolProducto(sesion, ['operaciones']);
    if (cuerpo.resolucion === 'rechazada') {
      const resultado = await descartarSolicitud(folio, { por: sesion.perfil.nombre || sesion.user.email || '', plantaId });
      return json(res, 200, { ok: true, mensaje: 'Reporte descartado.', ...resultado, solicitud: solicitudVisible(resultado.solicitud) });
    }
    const solicitud = await resolverSolicitud(folio, cuerpo.resolucion, {
      causa_id: cuerpo.causa_id ?? null,
      causa_libre: cuerpo.causa_libre ?? null,
      por: sesion.perfil.nombre || sesion.user.email || '', plantaId,
    });
    return json(res, 200, { ok: true, mensaje: 'Solicitud resuelta.', solicitud: solicitudVisible(solicitud) });
  }

  return json(res, 400, {
    ok: false,
    error: 'La acción debe ser "resolver", "descartar", "reclasificar" o "cerrar".',
  });
});
