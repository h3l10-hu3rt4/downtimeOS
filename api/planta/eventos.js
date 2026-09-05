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
import { ruta, json, leerCuerpo } from '../../lib/http.js';

export default ruta(['POST', 'PATCH', 'DELETE'], async (req, res) => {
  if (req.method === 'POST') {
    const evento = await crearEvento(leerCuerpo(req));
    console.log(`[downtimeos] PARO ${evento.folio} -> ${evento.activo_id} (${evento.minutos} min)`);
    return json(res, 201, { ok: true, mensaje: 'Paro registrado.', evento });
  }

  const folio = req.query?.folio;
  if (!folio) {
    return json(res, 400, { ok: false, error: 'Falta el parámetro `folio`.' });
  }

  if (req.method === 'PATCH') {
    const evento = await editarEvento(folio, leerCuerpo(req));
    return json(res, 200, { ok: true, mensaje: 'Evento corregido.', evento });
  }

  // DELETE: el cuerpo es opcional, pero si viene se aprovecha para el rastro.
  let motivo = '';
  let por = '';
  try {
    const cuerpo = leerCuerpo(req);
    motivo = cuerpo.motivo ?? '';
    por = cuerpo.por ?? '';
  } catch {
    /* sin cuerpo: se cancela igual, con motivo vacío */
  }

  const resultado = await eliminarEvento(folio, { motivo, por });
  return json(res, 200, { ok: true, mensaje: 'Evento cancelado.', ...resultado });
});
