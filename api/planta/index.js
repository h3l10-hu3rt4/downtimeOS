/**
 * GET /api/planta
 *
 * Devuelve TODO el estado de la planta en una sola respuesta: catálogo de
 * líneas, causas y activos, estado vivo del piso, bandeja de solicitudes y la
 * bitácora de paros.
 *
 * Va junto a propósito. Los tres tableros necesitan las cinco cosas a la vez
 * para pintar su primera vista, y una función serverless que responde una vez
 * cuesta menos —en latencia y en arranques en frío— que cinco que responden
 * por separado.
 *
 * Query:
 *   ?desde=2026-08-01T00:00:00Z   acota la bitácora (opcional)
 *   ?limite=500                   tope de eventos devueltos
 */
import { estadoPlanta } from '../../lib/planta.js';
import { ruta, json } from '../../lib/http.js';

export default ruta(['GET'], async (req, res) => {
  const { desde, limite } = req.query ?? {};

  const estado = await estadoPlanta({
    desde: desde || null,
    limite: Math.min(Number(limite) || 500, 2000),
  });

  return json(res, 200, {
    ok: true,
    meta: {
      actualizado: new Date().toISOString(),
      lineas: estado.lineas.length,
      activos: estado.activos.length,
      eventos: estado.eventos.length,
      solicitudes_abiertas: estado.solicitudes.length,
    },
    ...estado,
  });
});
