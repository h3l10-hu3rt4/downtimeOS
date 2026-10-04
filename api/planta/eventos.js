/**
 * Bitácora de paros.
 *
 *   POST   /api/planta/eventos              alta de un paro
 *   PATCH  /api/planta/eventos?folio=...    corrección de causa, minutos o nota
 *   DELETE /api/planta/eventos?folio=...    borrado con rastro
 *
 * El cuerpo del POST manda `activo_id`, `causa_id`, `minutos` e `inicio`.
 * NUNCA manda el costo: eso lo calcula `lib/planta.js` con la tarifa que la
 * base considera aplicable, igual que `POST /api/leads` recalcula la aritmética
 * financiera de un prospecto.
 */
import { crearEvento, editarEvento, eliminarEvento } from '../../lib/planta.js';
import { alertaDeActivo } from '../../lib/integraciones.js';
import { ruta, json, leerCuerpo } from '../../lib/http.js';
import { exigirRolProducto, sesionDesdeEncabezado } from '../../lib/cuenta.js';
import { exigirPlanActivo } from '../../lib/planes.js';
import { datosVisiblesPorRol } from '../../lib/visibilidad-financiera.js';

export default ruta(['POST', 'PATCH', 'DELETE'], async (req, res) => {
  const sesion = await sesionDesdeEncabezado(req.headers?.authorization, req.headers?.['x-downtimeos-planta']);
  // Si el plan vence, se detienen nuevas operaciones, pero el equipo conserva
  // capacidad de corregir o anular historial existente con su rol autorizado.
  const { plan } = req.method === 'POST' ? await exigirPlanActivo(sesion) : { plan: null };
  const plantaId = sesion.perfil.planta_id;
  if (req.method === 'POST') {
    exigirRolProducto(sesion, ['operaciones', 'operador']);
    const cuerpo = leerCuerpo(req);
    // Autoría y procedencia provienen de la sesión autenticada, nunca del
    // cliente. `retroactivo` sí es un dato de captura permitido al operador.
    const evento = await crearEvento({
      ...cuerpo,
      origen: sesion.perfil.rol === 'operador' ? 'piso' : 'mantenimiento',
      registrado_por: sesion.perfil.nombre || sesion.user.email || '',
    }, { plantaId });
    let alerta = null;
    if (process.env.WHATSAPP_ALERTAS_ACTIVAS === 'true' && plan.funciones?.whatsapp === true) {
      try {
        alerta = await alertaDeActivo({ activoId: evento.activo_id, plantaId });
      } catch (error) {
        // El paro ya quedó guardado. Una falla de proveedor no debe deshacerlo.
        console.error('[downtimeos] no se pudo despachar alerta WhatsApp:', error.message);
      }
    }
    console.log(`[downtimeos] PARO ${evento.folio} -> ${evento.activo_id} (${evento.minutos} min)`);
    return json(res, 201, datosVisiblesPorRol({ ok: true, mensaje: 'Paro registrado.', evento, alerta }, sesion.perfil));
  }

  const folio = req.query?.folio;
  if (!folio) {
    return json(res, 400, { ok: false, error: 'Falta el parámetro `folio`.' });
  }

  if (req.method === 'PATCH') {
    exigirRolProducto(sesion, ['operaciones']);
    const evento = await editarEvento(folio, leerCuerpo(req), { plantaId });
    return json(res, 200, datosVisiblesPorRol({ ok: true, mensaje: 'Evento corregido.', evento }, sesion.perfil));
  }

  // DELETE: el cuerpo es opcional, pero si viene se aprovecha para el rastro.
  let motivo = '';
  try {
    const cuerpo = leerCuerpo(req);
    motivo = cuerpo.motivo ?? '';
  } catch {
    /* sin cuerpo: se cancela igual, con motivo vacío */
  }

  exigirRolProducto(sesion, ['operaciones']);
  const resultado = await eliminarEvento(folio, { motivo, por: sesion.perfil.nombre || sesion.user.email || '', plantaId });
  return json(res, 200, { ok: true, mensaje: 'Evento cancelado.', ...resultado });
});
