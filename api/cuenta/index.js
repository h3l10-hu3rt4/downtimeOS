import { ruta, json, leerCuerpo } from '../../lib/http.js';
import { aceptarInvitacion, iniciarSesion, invitarUsuario, registrarEmpresa, solicitarRecuperacion, reenviarConfirmacionRegistro, sesionDesdeEncabezado, renovarSesion } from '../../lib/cuenta.js';
import { supabase } from '../../lib/supabase.js';

function cookieSesion(token, segundos = 60 * 60 * 8) {
  const seguro = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `downtimeos_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${segundos}${seguro}`;
}

export default ruta(['GET', 'POST'], async (req, res) => {
  if (req.method === 'GET') {
    const sesion = await sesionDesdeEncabezado(req.headers?.authorization, req.headers?.['x-downtimeos-planta']);
    const token = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '').trim();
    res.setHeader('Set-Cookie', cookieSesion(token));
    return json(res, 200, { ok: true, ...sesion });
  }
  const cuerpo = leerCuerpo(req);
  if (cuerpo.accion === 'refrescar') {
    const sesion = await renovarSesion(cuerpo.refresh_token, req.headers?.['x-downtimeos-planta'] || null);
    res.setHeader('Set-Cookie', cookieSesion(sesion.access_token));
    return json(res, 200, { ok: true, ...sesion });
  }
  if (cuerpo.accion === 'registro') {
    await registrarEmpresa(cuerpo);
    // Keep status and body identical whether Auth accepted a new identity or
    // suppressed a duplicate-email signup. The user can then confirm or sign
    // in; no account/organization details or Auth tokens are exposed here.
    return json(res, 201, { ok: true, siguiente: 'confirmar_o_iniciar_sesion' });
  }
  if (cuerpo.accion === 'inicio') {
    const sesion = await iniciarSesion(cuerpo);
    res.setHeader('Set-Cookie', cookieSesion(sesion.access_token));
    return json(res, 200, { ok: true, ...sesion });
  }
  if (cuerpo.accion === 'reenviar-confirmacion') {
    return json(res, 200, { ok: true, ...(await reenviarConfirmacionRegistro(cuerpo.email)) });
  }
  if (cuerpo.accion === 'recuperar') return json(res, 200, { ok: true, ...(await solicitarRecuperacion(cuerpo.email)) });
  if (cuerpo.accion === 'aceptar-invitacion') {
    const sesion = await aceptarInvitacion(req.headers?.authorization, cuerpo.invitacion_id, cuerpo.token);
    const token = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '').trim();
    res.setHeader('Set-Cookie', cookieSesion(token));
    return json(res, 200, { ok: true, ...sesion });
  }
  if (cuerpo.accion === 'salir') {
    const token = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '').trim();
    let sesionRevocada = false;
    if (token) {
      try {
        const { error } = await supabase.auth.admin.signOut(token, 'local');
        sesionRevocada = !error;
      } catch {
        // El navegador igualmente eliminará el refresh token local. El rechazo
        // del servidor no debe impedir cerrar la sesión visible del producto.
      }
    }
    res.setHeader('Set-Cookie', cookieSesion('', 0));
    return json(res, 200, { ok: true, sesion_revocada: sesionRevocada });
  }
  if (cuerpo.accion === 'invitar') {
    const sesion = await sesionDesdeEncabezado(req.headers?.authorization, req.headers?.['x-downtimeos-planta']);
    return json(res, 201, { ok: true, usuario: await invitarUsuario(sesion, cuerpo) });
  }
  return json(res, 400, { ok: false, error: 'Acción no válida.' });
});
