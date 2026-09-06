/**
 * POST /api/whatsapp/alerta
 *
 * Dos usos bajo la misma ruta, para no exceder el límite de funciones
 * serverless del plan (Vercel Hobby: 12). Se distinguen por la presencia de la
 * firma de Twilio, que solo aparece en el callback de estado real:
 *
 *   · Con `x-twilio-signature` → CALLBACK de estado de un mensaje ya enviado.
 *     Antes vivía en `api/webhooks/whatsapp.js`; se fusionó aquí.
 *   · Sin esa cabecera → disparo MANUAL de una alerta (despacho a brigada o
 *     envío de un reporte por WhatsApp), como ya hacía este archivo.
 *
 * La URL de callback que registra `lib/integraciones.js` en cada envío
 * (`PUBLIC_APP_URL + '/api/whatsapp/alerta'`) apunta aquí mismo: no es un
 * webhook fijo dado de alta en el panel de Twilio, así que mover la ruta es
 * seguro mientras las dos cadenas coincidan.
 */
import { alertaDeActivo, enviarWhatsApp } from '../../lib/integraciones.js';
import { resolverSolicitud } from '../../lib/planta.js';
import { supabase } from '../../lib/supabase.js';
import { ruta, json, leerCuerpo } from '../../lib/http.js';
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Verifica la firma HMAC que Twilio agrega a cada callback de estado. */
function firmaValida(req, cuerpo) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  const base = process.env.PUBLIC_APP_URL;
  const recibida = req.headers['x-twilio-signature'];
  if (!token || !base || !recibida) return false;
  const texto = `${base.replace(/\/$/, '')}/api/whatsapp/alerta` + Object.keys(cuerpo).sort()
    .map((clave) => `${clave}${cuerpo[clave]}`).join('');
  const esperada = createHmac('sha1', token).update(texto).digest('base64');
  const a = Buffer.from(esperada);
  const b = Buffer.from(String(recibida));
  return a.length === b.length && timingSafeEqual(a, b);
}

async function callbackTwilio(req, res) {
  const cuerpo = req.body && typeof req.body === 'object' ? req.body : {};
  if (!firmaValida(req, cuerpo)) return json(res, 403, { ok: false, error: 'Firma de webhook no válida.' });

  const sid = cuerpo.MessageSid;
  const estado = String(cuerpo.MessageStatus || '').toLowerCase();
  if (!sid || !['queued', 'sent', 'delivered', 'read', 'failed', 'undelivered'].includes(estado)) {
    return json(res, 400, { ok: false, error: 'Webhook de WhatsApp incompleto.' });
  }

  const { error } = await supabase.from('planta_mensajes').update({
    estado, error: cuerpo.ErrorMessage || null,
    updated_at: new Date().toISOString(), metadatos: cuerpo,
  }).eq('proveedor_id', sid);
  if (error) throw Object.assign(new Error(`No fue posible actualizar el mensaje: ${error.message}`), { status: 500 });

  return json(res, 200, { ok: true });
}

async function disparoManual(req, res) {
  const cuerpo = leerCuerpo(req);
  const mensaje = cuerpo.activo_id
    ? await alertaDeActivo({ activoId: cuerpo.activo_id, destinatario: cuerpo.destinatario ?? null })
    : await enviarWhatsApp({
        destinatario: cuerpo.destinatario, contenido: cuerpo.contenido,
        reporteId: cuerpo.reporte_id ?? null, eventoFolio: cuerpo.evento_folio ?? null,
      });
  return json(res, 201, { ok: true, mensaje });
}

async function callbackMeta(req, res) {
  const secreto = process.env.META_WHATSAPP_WEBHOOK_SECRET;
  if (!secreto || req.query?.token !== secreto) return json(res, 403, { ok: false, error: 'Webhook de Meta no autorizado.' });
  const cuerpo = req.body && typeof req.body === 'object' ? req.body : {};
  for (const entrada of cuerpo.entry ?? []) for (const cambio of entrada.changes ?? []) {
    for (const mensaje of cambio.value?.messages ?? []) {
      const id = mensaje.interactive?.button_reply?.id || '';
      const coincidencia = /^dtos:(aprobar|rechazar):(.+)$/.exec(id);
      if (!coincidencia || process.env.WHATSAPP_APROBACIONES_ACTIVAS !== 'true') continue;
      const resolucion = coincidencia[1] === 'aprobar' ? 'aprobada' : 'rechazada';
      await resolverSolicitud(coincidencia[2], resolucion, { por: `WhatsApp ${mensaje.from || 'Meta'}` });
    }
  }
  return json(res, 200, { ok: true });
}

const post = ruta(['POST'], async (req, res) => {
  if (req.headers['x-twilio-signature']) return callbackTwilio(req, res);
  if (req.body?.object === 'whatsapp_business_account') return callbackMeta(req, res);
  return disparoManual(req, res);
});

export default async function whatsappAlerta(req, res) {
  if (req.method === 'GET') {
    const secreto = process.env.META_WHATSAPP_WEBHOOK_SECRET;
    const modo = req.query?.['hub.mode'];
    const token = req.query?.['hub.verify_token'];
    if (secreto && req.query?.token === secreto && modo === 'subscribe' && token === process.env.META_WHATSAPP_VERIFY_TOKEN) {
      return res.status(200).send(req.query?.['hub.challenge'] || '');
    }
    return res.status(403).send('Webhook no autorizado');
  }
  return post(req, res);
}
