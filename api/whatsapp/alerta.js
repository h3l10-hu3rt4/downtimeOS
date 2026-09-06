import { alertaDeActivo, enviarWhatsApp } from '../../lib/integraciones.js';
import { ruta, json, leerCuerpo } from '../../lib/http.js';

export default ruta(['POST'], async (req, res) => {
  const cuerpo = leerCuerpo(req);
  const mensaje = cuerpo.activo_id
    ? await alertaDeActivo({ activoId: cuerpo.activo_id, destinatario: cuerpo.destinatario ?? null })
    : await enviarWhatsApp({ destinatario: cuerpo.destinatario, contenido: cuerpo.contenido, reporteId: cuerpo.reporte_id ?? null, eventoFolio: cuerpo.evento_folio ?? null });
  return json(res, 201, { ok: true, mensaje });
});
