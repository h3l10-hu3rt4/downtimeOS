import { crearReporte, urlFirmadaReporte } from '../../lib/integraciones.js';
import { ruta, json, leerCuerpo } from '../../lib/http.js';

export default ruta(['POST'], async (req, res) => {
  const cuerpo = leerCuerpo(req);
  const reporte = await crearReporte({ analisisId: cuerpo.analisis_id ?? null, desde: cuerpo.desde ?? null, hasta: cuerpo.hasta ?? null });
  const url = await urlFirmadaReporte(reporte);
  return json(res, 201, { ok: true, reporte: { ...reporte, url } });
});
