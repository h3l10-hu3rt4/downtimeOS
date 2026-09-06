import { generarAnalisis } from '../../lib/integraciones.js';
import { ruta, json, leerCuerpo } from '../../lib/http.js';

export default ruta(['POST'], async (req, res) => {
  const cuerpo = leerCuerpo(req);
  const enfoque = cuerpo.enfoque === 'operaciones' ? 'operaciones' : 'finanzas';
  const analisis = await generarAnalisis({
    desde: cuerpo.desde ?? null, hasta: cuerpo.hasta ?? null, enfoque,
  });
  return json(res, 201, { ok: true, analisis });
});
