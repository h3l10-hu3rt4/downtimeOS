/** Callback de estado de Twilio. Debe registrarse como webhook de WhatsApp. */
import { supabase } from '../../lib/supabase.js';
import { ruta, json } from '../../lib/http.js';
import { createHmac, timingSafeEqual } from 'node:crypto';

function firmaValida(req, cuerpo) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  const base = process.env.PUBLIC_APP_URL;
  const recibida = req.headers['x-twilio-signature'];
  if (!token || !base || !recibida) return false;
  const texto = `${base.replace(/\/$/, '')}/api/webhooks/whatsapp` + Object.keys(cuerpo).sort()
    .map((clave) => `${clave}${cuerpo[clave]}`).join('');
  const esperada = createHmac('sha1', token).update(texto).digest('base64');
  const a = Buffer.from(esperada);
  const b = Buffer.from(String(recibida));
  return a.length === b.length && timingSafeEqual(a, b);
}

export default ruta(['POST'], async (req, res) => {
  const cuerpo = req.body && typeof req.body === 'object' ? req.body : {};
  if (!firmaValida(req, cuerpo)) return json(res, 403, { ok: false, error: 'Firma de webhook no válida.' });
  const sid = cuerpo.MessageSid;
  const estado = String(cuerpo.MessageStatus || '').toLowerCase();
  if (!sid || !['queued', 'sent', 'delivered', 'read', 'failed', 'undelivered'].includes(estado)) {
    return json(res, 400, { ok: false, error: 'Webhook de WhatsApp incompleto.' });
  }
  const { error } = await supabase.from('planta_mensajes').update({ estado, error: cuerpo.ErrorMessage || null, updated_at: new Date().toISOString(), metadatos: cuerpo }).eq('proveedor_id', sid);
  if (error) throw Object.assign(new Error(`No fue posible actualizar el mensaje: ${error.message}`), { status: 500 });
  return json(res, 200, { ok: true });
});
