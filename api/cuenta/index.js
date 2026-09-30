import { ruta, json, leerCuerpo } from '../../lib/http.js';
import { iniciarSesion, invitarUsuario, registrarEmpresa, sesionDesdeEncabezado } from '../../lib/cuenta.js';

export default ruta(['GET', 'POST'], async (req, res) => {
  if (req.method === 'GET') {
    const sesion = await sesionDesdeEncabezado(req.headers?.authorization);
    return json(res, 200, { ok: true, ...sesion });
  }
  const cuerpo = leerCuerpo(req);
  if (cuerpo.accion === 'registro') return json(res, 201, { ok: true, ...(await registrarEmpresa(cuerpo)) });
  if (cuerpo.accion === 'inicio') return json(res, 200, { ok: true, ...(await iniciarSesion(cuerpo)) });
  if (cuerpo.accion === 'invitar') {
    const sesion = await sesionDesdeEncabezado(req.headers?.authorization);
    return json(res, 201, { ok: true, usuario: await invitarUsuario(sesion, cuerpo) });
  }
  return json(res, 400, { ok: false, error: 'Acción no válida.' });
});
