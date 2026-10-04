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
import { reportarParo, cerrarParoReportado, reportarParoMantenimiento, retirarReporteOperador } from '../../lib/planta.js';
import { crearReporte, enviarSolicitudAprobacion, urlFirmadaReporte } from '../../lib/integraciones.js';
import { ruta, json, leerCuerpo } from '../../lib/http.js';
import { exigirRolProducto, sesionDesdeEncabezado } from '../../lib/cuenta.js';
import { exigirPlanActivo } from '../../lib/planes.js';
import { datosVisiblesPorRol } from '../../lib/visibilidad-financiera.js';

function solicitudVisible(solicitud) {
  if (!solicitud) return solicitud;
  const { reportado_por_user_id, ...visible } = solicitud;
  return visible;
}

export default ruta(['POST', 'PATCH'], async (req, res) => {
  const sesion = await sesionDesdeEncabezado(req.headers?.authorization, req.headers?.['x-downtimeos-planta']);
  const plantaId = sesion.perfil.planta_id;
  const cuerpo = leerCuerpo(req);
  let plan = null;

  // Se detienen nuevas operaciones al vencer el plan, no las acciones que
  // resuelven un paro ya abierto y protegen la continuidad de la planta.
  if (req.method === 'POST' || (req.method === 'PATCH' && cuerpo.accion === 'mantenimiento')) {
    ({ plan } = await exigirPlanActivo(sesion));
  }

  if (req.method === 'PATCH' && cuerpo.accion === 'cerrar') {
    exigirRolProducto(sesion, ['operaciones', 'operador', 'direccion']);
    if (!cuerpo.activo_id) return json(res, 400, { ok: false, error: 'Falta `activo_id`.' });
    const cierre = await cerrarParoReportado({
      activo_id: cuerpo.activo_id,
      registrado_por: sesion.perfil.nombre || sesion.user.email || '',
      origen: sesion.perfil.rol === 'operador' ? 'piso' : 'mantenimiento',
    }, { plantaId, organizacionId: sesion.perfil.organizacion_id, usuarioId: sesion.user.id });
    return json(res, 200, datosVisiblesPorRol({ ok: true, mensaje: 'Paro cerrado y guardado.', ...cierre }, sesion.perfil));
  }

  if (req.method === 'PATCH' && cuerpo.accion === 'retirar') {
    exigirRolProducto(sesion, ['operador']);
    if (!cuerpo.folio) return json(res, 400, { ok: false, error: 'Falta `folio`.' });
    const resultado = await retirarReporteOperador(cuerpo.folio, sesion.user.id, { plantaId });
    return json(res, 200, { ok: true, mensaje: 'Reporte retirado.', ...resultado, solicitud: solicitudVisible(resultado.solicitud) });
  }

  if (req.method === 'POST' && cuerpo.accion === 'mantenimiento') {
    exigirRolProducto(sesion, ['operaciones']);
    if (!cuerpo.activo_id || !cuerpo.causa_id) {
      return json(res, 400, { ok: false, error: 'Faltan `activo_id` o `causa_id`.' });
    }
    const reporte = await reportarParoMantenimiento({
      activo_id: cuerpo.activo_id,
      causa_id: cuerpo.causa_id,
      causa_libre: cuerpo.causa_libre ?? null,
      reportado_por: sesion.perfil.nombre || sesion.user.email || '',
    }, { plantaId });
    return json(res, 201, { ok: true, mensaje: 'Paro de Mantenimiento registrado.', ...reporte, solicitud: solicitudVisible(reporte.solicitud) });
  }

  if (req.method !== 'POST') return json(res, 400, { ok: false, error: 'Acción de reporte no válida.' });

  if (cuerpo.activo_id && cuerpo.causa_id) {
    exigirRolProducto(sesion, ['operaciones', 'operador']);
    const reporte = await reportarParo({
      ...cuerpo,
      reportado_por: sesion.perfil.nombre || sesion.user.email || '',
      reportado_por_user_id: sesion.user.id,
    }, { plantaId });
    let alerta = null;
    if (process.env.WHATSAPP_ALERTAS_ACTIVAS === 'true' && plan.funciones?.whatsapp === true && reporte.solicitud) {
      try { alerta = await enviarSolicitudAprobacion(reporte.solicitud, null, { plantaId }); }
      catch (error) {
        console.error('[downtimeos] no se pudo enviar aprobación WhatsApp:', error.message);
        // El paro ya quedó persistido. Informa el fallo de notificación sin
        // convertirlo en fallo del reporte ni revelar datos del proveedor.
        alerta = { ok: false, estado: 'error' };
      }
    }
    return json(res, 201, { ok: true, mensaje: 'Paro reportado a Supervisión.', ...reporte, solicitud: solicitudVisible(reporte.solicitud), alerta });
  }

  exigirRolProducto(sesion, ['direccion', 'finanzas']);
  await exigirPlanActivo(sesion, 'pdf_mensual');
  const reporte = await crearReporte({ desde: cuerpo.desde ?? null, hasta: cuerpo.hasta ?? null, plantaId });
  const url = await urlFirmadaReporte(reporte);
  return json(res, 201, { ok: true, reporte: { ...reporte, url } });
});
