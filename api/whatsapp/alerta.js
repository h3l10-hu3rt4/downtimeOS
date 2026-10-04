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
import { alertaDeActivo, alertaDeParos, enviarWhatsApp } from '../../lib/integraciones.js';
import { resolverPendiente } from '../../lib/planta.js';
import { supabase } from '../../lib/supabase.js';
import { ruta, json } from '../../lib/http.js';
import { exigirRolProducto, sesionDesdeEncabezado } from '../../lib/cuenta.js';
import { exigirPlanActivo } from '../../lib/planes.js';
import { createHmac, timingSafeEqual } from 'node:crypto';

// Se conserva el cuerpo byte por byte: Meta firma el JSON original, no el
// objeto ya parseado/re-serializado por el runtime.
export const config = { api: { bodyParser: false } };

async function leerEntradaWebhook(req) {
  let raw;
  if (Buffer.isBuffer(req.rawBody)) raw = req.rawBody;
  else if (typeof req.rawBody === 'string') raw = Buffer.from(req.rawBody);
  else if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) raw = Buffer.from(req.body);
  else if (req.body && typeof req.body === 'object') raw = Buffer.from(JSON.stringify(req.body)); // tests/adapters
  else {
    const partes = [];
    let total = 0;
    for await (const parte of req) {
      total += parte.length;
      if (total > 64 * 1024) throw Object.assign(new Error('El webhook excede el límite permitido.'), { status: 413 });
      partes.push(parte);
    }
    raw = Buffer.concat(partes);
  }
  if (!raw.length) throw Object.assign(new Error('El cuerpo del webhook está vacío.'), { status: 400 });
  if (raw.length > 64 * 1024) throw Object.assign(new Error('El webhook excede el límite permitido.'), { status: 413 });
  const tipo = String(req.headers?.['content-type'] || '').toLowerCase();
  try {
    if (tipo.includes('application/x-www-form-urlencoded')) {
      return { raw, cuerpo: Object.fromEntries(new URLSearchParams(raw.toString('utf8'))) };
    }
    return { raw, cuerpo: JSON.parse(raw.toString('utf8')) };
  } catch {
    throw Object.assign(new Error('El cuerpo del webhook no es válido.'), { status: 400 });
  }
}

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

async function callbackTwilio(req, res, cuerpo) {
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

async function disparoManual(req, res, cuerpo) {
  const sesion = await sesionDesdeEncabezado(req.headers?.authorization, req.headers?.['x-downtimeos-planta']);
  const plantaId = sesion.perfil.planta_id;
  const esReporte = Boolean(cuerpo.reporte_id);
  exigirRolProducto(sesion, esReporte ? ['direccion', 'finanzas'] : ['operaciones']);
  if (esReporte) await exigirPlanActivo(sesion, 'pdf_mensual');
  else await exigirPlanActivo(sesion, 'whatsapp');
  const mensaje = cuerpo.alerta === 'paros'
    ? await alertaDeParos({ destinatario: cuerpo.destinatario ?? null, plantaId })
    : cuerpo.activo_id
      ? await alertaDeActivo({ activoId: cuerpo.activo_id, destinatario: cuerpo.destinatario ?? null, plantaId })
      : await enviarWhatsApp({
        destinatario: cuerpo.destinatario, contenido: cuerpo.contenido,
        reporteId: cuerpo.reporte_id ?? null, eventoFolio: cuerpo.evento_folio ?? null,
        plantaId,
      });
  return json(res, 201, { ok: true, mensaje });
}

async function callbackMeta(req, res, cuerpo) {
  const secreto = process.env.META_WHATSAPP_APP_SECRET
    || process.env.META_WHATSAPP_WEBHOOK_SECRET
    || process.env.META_APP_SECRET;
  const recibida = String(req.headers?.['x-hub-signature-256'] || '');
  const raw = req._metaRawBody;
  if (!secreto || !raw || !/^sha256=[a-f0-9]{64}$/i.test(recibida)) {
    return json(res, 403, { ok: false, error: 'Webhook de Meta no autorizado.' });
  }
  const esperada = `sha256=${createHmac('sha256', secreto).update(raw).digest('hex')}`;
  const firmaA = Buffer.from(esperada);
  const firmaB = Buffer.from(recibida);
  if (firmaA.length !== firmaB.length || !timingSafeEqual(firmaA, firmaB)) {
    return json(res, 403, { ok: false, error: 'Firma de webhook no válida.' });
  }
  for (const entrada of cuerpo.entry ?? []) for (const cambio of entrada.changes ?? []) {
    for (const estado of cambio.value?.statuses ?? []) {
      const valor = String(estado.status || '').toLowerCase();
      if (!estado.id || !['sent', 'delivered', 'read', 'failed'].includes(valor)) continue;
      await supabase.from('planta_mensajes').update({
        estado: valor,
        error: estado.errors?.map((e) => e.title || e.message || e.code).filter(Boolean).join('; ') || null,
        updated_at: new Date().toISOString(), metadatos: estado,
      }).eq('proveedor_id', estado.id);
    }
    for (const mensaje of cambio.value?.messages ?? []) {
      // Mensaje interactivo → `interactive.button_reply.id`; botón de una
      // plantilla aprobada (quick reply) → `button.payload`.
      const id = mensaje.interactive?.button_reply?.id || mensaje.button?.payload || '';
      const coincidencia = /^dtos:(aprobar|rechazar):([0-9a-f-]{36}):(.+)$/i.exec(id);
      if (!coincidencia || process.env.WHATSAPP_APROBACIONES_ACTIVAS !== 'true') continue;
      const resolucion = coincidencia[1] === 'aprobar' ? 'aprobada' : 'rechazada';
      const resultado = await resolverPendiente(coincidencia[3], resolucion, {
        por: `WhatsApp ${mensaje.from || 'Meta'}`, plantaId: coincidencia[2],
      });
      console.log(`[downtimeos] WhatsApp ${resolucion} ${coincidencia[3]}${resultado.ignorada ? ` ignorada (ya ${resultado.estado})` : ''}`);
    }
  }
  return json(res, 200, { ok: true });
}

const post = ruta(['POST'], async (req, res) => {
  const { cuerpo, raw } = await leerEntradaWebhook(req);
  req._metaRawBody = raw;
  if (req.headers['x-twilio-signature']) return callbackTwilio(req, res, cuerpo);
  if (cuerpo?.object === 'whatsapp_business_account' || req.headers['x-hub-signature-256']) {
    return callbackMeta(req, res, cuerpo);
  }
  return disparoManual(req, res, cuerpo);
});

export default async function whatsappAlerta(req, res) {
  if (req.method === 'GET') {
    const modo = req.query?.['hub.mode'];
    const token = req.query?.['hub.verify_token'];
    if (process.env.META_WHATSAPP_VERIFY_TOKEN && modo === 'subscribe' && token === process.env.META_WHATSAPP_VERIFY_TOKEN) {
      return res.status(200).send(req.query?.['hub.challenge'] || '');
    }
    return res.status(403).send('Webhook no autorizado');
  }
  return post(req, res);
}
