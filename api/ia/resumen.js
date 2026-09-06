import { generarAnalisis } from '../../lib/integraciones.js';
import { ruta, json, leerCuerpo } from '../../lib/http.js';

// Claude con análisis financiero profundo puede tardar más que el modelo rápido
// de Gemini; evitamos que la función termine antes de devolver el JSON.
export const maxDuration = 60;

export default ruta(['POST'], async (req, res) => {
  const cuerpo = leerCuerpo(req);
  const enfoque = cuerpo.enfoque === 'operaciones' ? 'operaciones' : 'finanzas';
  const analisis = await generarAnalisis({
    desde: cuerpo.desde ?? null, hasta: cuerpo.hasta ?? null, enfoque,
  });
  return json(res, 201, { ok: true, analisis });
});
