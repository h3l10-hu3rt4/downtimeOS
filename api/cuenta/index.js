import { ruta, json, leerCuerpo } from '../../lib/http.js';
import { iniciarSesion, invitarUsuario, registrarEmpresa, sesionDesdeEncabezado } from '../../lib/cuenta.js';

function cookieSesion(token, segundos = 60 * 60 * 8) {
  const seguro = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `downtimeos_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${segundos}${seguro}`;
}

export default ruta(['GET', 'POST'], async (req, res) => {
  if (req.method === 'GET') {
    const sesion = await sesionDesdeEncabezado(req.headers?.authorization);
    return json(res, 200, { ok: true, ...sesion });
  }
  const cuerpo = leerCuerpo(req);
  if (cuerpo.accion === 'registro') return json(res, 201, { ok: true, ...(await registrarEmpresa(cuerpo)) });
  if (cuerpo.accion === 'inicio') {
    const sesion = await iniciarSesion(cuerpo);
    res.setHeader('Set-Cookie', cookieSesion(sesion.access_token));
    return json(res, 200, { ok: true, ...sesion });
  }
  if (cuerpo.accion === 'salir') {
    res.setHeader('Set-Cookie', cookieSesion('', 0));
    return json(res, 200, { ok: true });
  }
  if (cuerpo.accion === 'invitar') {
    const sesion = await sesionDesdeEncabezado(req.headers?.authorization);
    return json(res, 201, { ok: true, usuario: await invitarUsuario(sesion, cuerpo) });
  }
  return json(res, 400, { ok: false, error: 'Acción no válida.' });
});
