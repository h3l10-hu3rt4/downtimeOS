/**
 * POST /api/planta/estados
 *
 * Cambia el estado operativo de un activo. Solo `RUN` o `STOP`: "Setup" no es
 * un estado sino la acción de capturar un paro que ya terminó, y esa produce un
 * evento en `/api/planta/eventos`, no un cambio aquí.
 *
 * Cuerpo:
 *   { activo_id, estado, causa_id?, causa_libre?, desde? }
 *
 * `desde` existe para DESHACER el cierre de un paro restaurando su marca de
 * tiempo original. Sin él, deshacer reiniciaría el cronómetro en cero y el paro
 * aparecería más corto de lo que realmente fue, que es justo el dato que el
 * producto existe para medir.
 */
import { cambiarEstado } from '../../lib/planta.js';
import { ruta, json, leerCuerpo } from '../../lib/http.js';

export default ruta(['POST'], async (req, res) => {
  const cuerpo = leerCuerpo(req);

  if (!cuerpo.activo_id) {
    return json(res, 400, { ok: false, error: 'Falta `activo_id`.' });
  }

  const estado = await cambiarEstado(cuerpo.activo_id, cuerpo.estado, {
    causa_id: cuerpo.causa_id ?? null,
    causa_libre: cuerpo.causa_libre ?? null,
    desde: cuerpo.desde ?? null,
  });

  return json(res, 200, { ok: true, mensaje: 'Estado actualizado.', estado });
});
