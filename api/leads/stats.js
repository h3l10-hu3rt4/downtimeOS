/**
 * GET /api/leads/stats
 * Agregados para los contadores del hero. Lee la vista `leads_stats`.
 */
import { obtenerStats } from '../../lib/repositorio.js';
import { ruta, json } from '../../lib/http.js';

export default ruta(['GET'], async (req, res) => {
  const stats = await obtenerStats();
  return json(res, 200, { ok: true, stats });
});
