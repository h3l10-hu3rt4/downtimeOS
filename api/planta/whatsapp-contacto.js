import { randomBytes } from 'node:crypto';
import { ruta, json, leerCuerpo } from '../../lib/http.js';
import { sesionDesdeEncabezado } from '../../lib/cuenta.js';
import { supabase } from '../../lib/supabase.js';
import { hashCodigoVerificacionWhatsApp, normalizarTelefonoE164 } from '../../lib/whatsapp-contactos.js';

const VENTANA_DESAFIO_MS = 10 * 60 * 1000;
const REINTENTO_SMS_MS = 60 * 1000;
const MAX_INTENTOS_SMS = 5;

function credencialesTwilioVerify() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const apiKeySid = process.env.TWILIO_VERIFY_API_KEY_SID?.trim();
  const apiKeySecret = process.env.TWILIO_VERIFY_API_KEY_SECRET?.trim();
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID?.trim();
  const usaApiKey = /^SK[a-f\d]{32}$/i.test(apiKeySid || '') && Boolean(apiKeySecret);
  if ((!usaApiKey && (!/^AC[a-f\d]{32}$/i.test(accountSid || '') || !authToken)) || !/^VA[a-f\d]{32}$/i.test(serviceSid || '')) {
    throw Object.assign(new Error('La verificación por SMS aún no está configurada. Contacta a soporte.'), { status: 503 });
  }
  return { username: usaApiKey ? apiKeySid : accountSid, password: usaApiKey ? apiKeySecret : authToken, serviceSid };
}

async function solicitarTwilioVerify(serviceSid, auth, endpoint, parametros) {
  const respuesta = await fetch(`https://verify.twilio.com/v2/Services/${serviceSid}/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(parametros),
    signal: AbortSignal.timeout(10000),
  });
  const datos = await respuesta.json().catch(() => ({}));
  return { respuesta, datos };
}

function errorTwilio(datos, fallback, httpStatus) {
  const status = Number(httpStatus || datos?.status);
  const codigo = Number(datos?.code);
  const esDestinoNoVerificado = codigo === 21608;
  const error = new Error(esDestinoNoVerificado
    ? 'Twilio Trial solo permite enviar a números verificados en su consola. Verifica este número en Twilio e inténtalo de nuevo.'
    : status === 429
      ? 'Alcanzaste el límite temporal de SMS. Espera un minuto e inténtalo otra vez.'
      : fallback);
  error.status = esDestinoNoVerificado ? 403 : status === 429 ? 429 : 502;
  return error;
}

async function enviarCodigoSms({ user, perfil, telefono }) {
  const auth = credencialesTwilioVerify();
  const ahoraMs = Date.now();
  const ahora = new Date(ahoraMs).toISOString();
  const { data: desafioPrevio, error: errorPrevio } = await supabase.from('planta_whatsapp_verificaciones')
    .select('id,expira_en,created_at,intentos').eq('user_id', user.id).eq('planta_id', perfil.planta_id)
    .eq('canal', 'sms').order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (errorPrevio) throw Object.assign(new Error('No fue posible validar el límite de reenvíos.'), { status: 503 });
  if (desafioPrevio && ahoraMs - new Date(desafioPrevio.created_at).getTime() < REINTENTO_SMS_MS) {
    throw Object.assign(new Error('Espera un minuto antes de solicitar otro SMS.'), { status: 429 });
  }

  const { data: contactoActual, error: errorContactoActual } = await supabase.from('planta_whatsapp_contactos')
    .select('telefono_e164').eq('user_id', user.id).eq('planta_id', perfil.planta_id).maybeSingle();
  if (errorContactoActual) throw Object.assign(new Error('No fue posible consultar el número de esta planta.'), { status: 503 });
  if (contactoActual?.telefono_e164 && contactoActual.telefono_e164 !== telefono) {
    const { error } = await supabase.from('planta_whatsapp_contactos').upsert({
      user_id: user.id, planta_id: perfil.planta_id, organizacion_id: perfil.organizacion_id,
      telefono_e164: telefono, consentimiento_en: new Date().toISOString(), verificado_en: null, updated_at: ahora,
    }, { onConflict: 'user_id,planta_id' });
    if (error) throw Object.assign(new Error('No fue posible actualizar el número de la planta.'), { status: 503 });
  } else if (!contactoActual) {
    const { error } = await supabase.from('planta_whatsapp_contactos').insert({
      user_id: user.id, planta_id: perfil.planta_id, organizacion_id: perfil.organizacion_id,
      telefono_e164: telefono, consentimiento_en: new Date().toISOString(), verificado_en: null, updated_at: ahora,
    });
    if (error) throw Object.assign(new Error('No fue posible guardar el número de la planta.'), { status: 503 });
  } else {
    const { error } = await supabase.from('planta_whatsapp_contactos').update({
      consentimiento_en: contactoActual.consentimiento_en || ahora, updated_at: ahora,
    }).eq('user_id', user.id).eq('planta_id', perfil.planta_id);
    if (error) throw Object.assign(new Error('No fue posible guardar el consentimiento.'), { status: 503 });
  }

  // El OTP no se almacena en DowntimeOS: Twilio lo genera, entrega y valida.
  const codigoInterno = randomBytes(32).toString('base64url');
  const expiraEn = new Date(ahoraMs + VENTANA_DESAFIO_MS).toISOString();
  await supabase.from('planta_whatsapp_verificaciones').update({ consumido_en: ahora })
    .eq('user_id', user.id).eq('planta_id', perfil.planta_id).eq('canal', 'whatsapp').is('consumido_en', null);
  if (desafioPrevio) await supabase.from('planta_whatsapp_verificaciones').update({ consumido_en: ahora })
    .eq('id', desafioPrevio.id).is('consumido_en', null);
  const { data: desafio, error: errorInsert } = await supabase.from('planta_whatsapp_verificaciones').insert({
    user_id: user.id, planta_id: perfil.planta_id, canal: 'sms',
    codigo_hash: hashCodigoVerificacionWhatsApp(codigoInterno), expira_en: expiraEn, intentos: 0,
  }).select('id').single();
  if (errorInsert || !desafio?.id) throw Object.assign(new Error('No fue posible iniciar la solicitud de SMS.'), { status: 503 });

  let resultado;
  try {
    resultado = await solicitarTwilioVerify(auth.serviceSid, auth, 'Verifications', { To: telefono, Channel: 'sms' });
  } catch {
    await supabase.from('planta_whatsapp_verificaciones').update({ consumido_en: new Date().toISOString() }).eq('id', desafio.id);
    throw Object.assign(new Error('No pudimos conectar con el servicio SMS. Inténtalo más tarde.'), { status: 503 });
  }
  if (!resultado.respuesta.ok || resultado.datos.status !== 'pending') {
    await supabase.from('planta_whatsapp_verificaciones').update({ consumido_en: new Date().toISOString() }).eq('id', desafio.id);
    throw errorTwilio(resultado.datos, 'Twilio no pudo enviar el SMS. Revisa el número e inténtalo más tarde.', resultado.respuesta.status);
  }
  return { ok: true, canal: 'sms', expira_en: expiraEn, mensaje: 'Enviamos un código por SMS. Escríbelo aquí; no lo compartas con nadie.' };
}

async function verificarCodigoSms({ user, perfil, codigo }) {
  const auth = credencialesTwilioVerify();
  if (!/^\d{4,10}$/.test(codigo)) throw Object.assign(new Error('Escribe el código numérico recibido por SMS.'), { status: 400 });
  const { data: desafio, error } = await supabase.from('planta_whatsapp_verificaciones')
    .select('id,expira_en,intentos').eq('user_id', user.id).eq('planta_id', perfil.planta_id).eq('canal', 'sms')
    .is('consumido_en', null).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw Object.assign(new Error('No fue posible consultar el código pendiente.'), { status: 503 });
  if (!desafio || new Date(desafio.expira_en).getTime() <= Date.now()) {
    if (desafio) await supabase.from('planta_whatsapp_verificaciones').update({ consumido_en: new Date().toISOString() }).eq('id', desafio.id);
    throw Object.assign(new Error('El código venció. Solicita uno nuevo.'), { status: 410 });
  }
  const intentos = Number(desafio.intentos || 0);
  if (intentos >= MAX_INTENTOS_SMS) {
    await supabase.from('planta_whatsapp_verificaciones').update({ consumido_en: new Date().toISOString() }).eq('id', desafio.id);
    throw Object.assign(new Error('Se agotaron los intentos. Solicita un código nuevo en un minuto.'), { status: 429 });
  }
  const { data: contacto, error: errorContacto } = await supabase.from('planta_whatsapp_contactos')
    .select('telefono_e164,consentimiento_en').eq('user_id', user.id).eq('planta_id', perfil.planta_id).maybeSingle();
  if (errorContacto || !contacto?.telefono_e164 || !contacto.consentimiento_en) {
    throw Object.assign(new Error('No encontramos un número con consentimiento para esta planta.'), { status: 409 });
  }
  await supabase.from('planta_whatsapp_verificaciones').update({ intentos: intentos + 1 }).eq('id', desafio.id);
  let resultado;
  try {
    resultado = await solicitarTwilioVerify(auth.serviceSid, auth, 'VerificationCheck', { To: contacto.telefono_e164, Code: codigo });
  } catch {
    throw Object.assign(new Error('No pudimos validar el código con Twilio. Inténtalo de nuevo.'), { status: 503 });
  }
  if (!resultado.respuesta.ok) {
    if (resultado.respuesta.status === 404 || resultado.datos?.code === 20404) {
      await supabase.from('planta_whatsapp_verificaciones').update({ consumido_en: new Date().toISOString() }).eq('id', desafio.id);
      throw Object.assign(new Error('El código venció o ya se usó. Solicita uno nuevo.'), { status: 410 });
    }
    if (resultado.respuesta.status === 429) throw errorTwilio(resultado.datos, 'Espera un momento antes de volver a intentar.', resultado.respuesta.status);
    throw Object.assign(new Error('No pudimos validar el código con Twilio. Revisa el código e inténtalo otra vez.'), { status: 422 });
  }
  if (resultado.datos.status !== 'approved') {
    throw Object.assign(new Error('El código no coincide. Revisa el SMS e inténtalo de nuevo.'), { status: 422 });
  }
  const verificadoEn = new Date().toISOString();
  const { error: errorActualizar } = await supabase.from('planta_whatsapp_contactos').update({ verificado_en: verificadoEn, updated_at: verificadoEn })
    .eq('user_id', user.id).eq('planta_id', perfil.planta_id).eq('telefono_e164', contacto.telefono_e164);
  if (errorActualizar) throw Object.assign(new Error('El código fue aprobado, pero no pudimos guardar el estado. Vuelve a actualizar; no solicites otro código.'), { status: 503 });
  await supabase.from('planta_whatsapp_verificaciones').update({ consumido_en: verificadoEn })
    .eq('user_id', user.id).eq('planta_id', perfil.planta_id).eq('canal', 'sms').is('consumido_en', null);
  return { ok: true, verificado_en: verificadoEn, mensaje: 'Número verificado correctamente por SMS.' };
}

async function numeroEmpresaMeta() {
  const phoneId = process.env.META_WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.META_WHATSAPP_ACCESS_TOKEN?.replace(/^\s*"|"\s*$/g, '').replace(/^Bearer\s+/i, '').trim();
  if (!phoneId || !token) throw Object.assign(new Error('La verificación WhatsApp no está configurada.'), { status: 503 });
  const version = process.env.META_WHATSAPP_GRAPH_VERSION || 'v23.0';
  const response = await fetch(`https://graph.facebook.com/${version}/${encodeURIComponent(phoneId)}?fields=display_phone_number`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000),
  });
  const data = await response.json().catch(() => ({}));
  const digits = String(data.display_phone_number || '').replace(/\D/g, '');
  if (!response.ok || digits.length < 8) throw Object.assign(new Error('Meta no devolvió el número público de WhatsApp.'), { status: 503 });
  return digits;
}

export default ruta(['GET', 'POST', 'DELETE'], async (req, res) => {
  const sesion = await sesionDesdeEncabezado(req.headers?.authorization, req.headers?.['x-downtimeos-planta']);
  const { user, perfil } = sesion;
  if (req.method === 'GET') {
    const [contactoResult, verificacionResult] = await Promise.all([
      supabase.from('planta_whatsapp_contactos')
        .select('telefono_e164,consentimiento_en,verificado_en,updated_at')
        .eq('user_id', user.id).eq('planta_id', perfil.planta_id).maybeSingle(),
      supabase.from('planta_whatsapp_verificaciones')
        .select('expira_en,canal').eq('user_id', user.id).eq('planta_id', perfil.planta_id)
        .is('consumido_en', null).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (contactoResult.error) throw Object.assign(new Error('No fue posible consultar el contacto WhatsApp.'), { status: 503 });
    if (verificacionResult.error) throw Object.assign(new Error('No fue posible consultar el estado de verificación WhatsApp.'), { status: 503 });
    const expiraEn = verificacionResult.data?.expira_en || null;
    const estadoVerificacion = !expiraEn ? 'sin_desafio' : new Date(expiraEn).getTime() > Date.now() ? 'pendiente' : 'expirada';
    return json(res, 200, {
      ok: true,
      contacto: contactoResult.data || null,
      verificacion: { estado: estadoVerificacion, expira_en: expiraEn, canal: verificacionResult.data?.canal || null },
    });
  }
  if (req.method === 'DELETE') {
    await supabase.from('planta_whatsapp_verificaciones').update({ consumido_en: new Date().toISOString() })
      .eq('user_id', user.id).eq('planta_id', perfil.planta_id).is('consumido_en', null);
    const { error } = await supabase.from('planta_whatsapp_contactos')
      .delete().eq('user_id', user.id).eq('planta_id', perfil.planta_id);
    if (error) throw Object.assign(new Error('No fue posible retirar el consentimiento WhatsApp.'), { status: 503 });
    return json(res, 200, { ok: true, mensaje: 'Contacto y desafíos pendientes eliminados.' });
  }

  const cuerpo = leerCuerpo(req);
  if (cuerpo.accion === 'enviar_sms') {
    if (cuerpo.consentimiento !== true) return json(res, 400, { ok: false, error: 'Confirma que aceptas recibir notificaciones en este número.' });
    const telefono = normalizarTelefonoE164(cuerpo.telefono);
    return json(res, 201, await enviarCodigoSms({ user, perfil, telefono }));
  }
  if (cuerpo.accion === 'verificar_sms') {
    const resultado = await verificarCodigoSms({ user, perfil, codigo: String(cuerpo.codigo || '').trim() });
    return json(res, 200, resultado);
  }
  if (cuerpo.consentimiento !== true) return json(res, 400, { ok: false, error: 'Confirma que aceptas recibir notificaciones operativas por WhatsApp.' });
  const telefono = normalizarTelefonoE164(cuerpo.telefono);
  if (cuerpo.accion === 'guardar_contacto') {
    const ahora = new Date().toISOString();
    const { data: contactoActual, error: errorLectura } = await supabase.from('planta_whatsapp_contactos')
      .select('telefono_e164,consentimiento_en,verificado_en')
      .eq('user_id', user.id).eq('planta_id', perfil.planta_id).maybeSingle();
    if (errorLectura) throw Object.assign(new Error('No fue posible consultar tu contacto de esta planta.'), { status: 503 });
    const mismoNumero = contactoActual?.telefono_e164 === telefono;
    const { error } = await supabase.from('planta_whatsapp_contactos').upsert({
      user_id: user.id, planta_id: perfil.planta_id, organizacion_id: perfil.organizacion_id,
      telefono_e164: telefono, consentimiento_en: contactoActual?.consentimiento_en || ahora,
      verificado_en: mismoNumero ? contactoActual?.verificado_en || null : null, updated_at: ahora,
    }, { onConflict: 'user_id,planta_id' });
    if (error) throw Object.assign(new Error('No fue posible guardar el contacto WhatsApp.'), { status: 503 });
    await supabase.from('planta_whatsapp_verificaciones').update({ consumido_en: ahora })
      .eq('user_id', user.id).eq('planta_id', perfil.planta_id).is('consumido_en', null);
    return json(res, 200, {
      ok: true,
      contacto: { telefono_e164: telefono, consentimiento_en: contactoActual?.consentimiento_en || ahora, verificado_en: mismoNumero ? contactoActual?.verificado_en || null : null },
      mensaje: 'Número guardado con tu consentimiento. Aún no está verificado; los mensajes de WhatsApp podrían no entregarse si el número es incorrecto.',
    });
  }
  const { data: pendiente, error: errorPendiente } = await supabase.from('planta_whatsapp_verificaciones')
    .select('id,expira_en').eq('user_id', user.id).eq('planta_id', perfil.planta_id).eq('canal', 'whatsapp').is('consumido_en', null)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (errorPendiente) throw Object.assign(new Error('No fue posible validar verificaciones pendientes.'), { status: 503 });
  if (pendiente && new Date(pendiente.expira_en).getTime() > Date.now()) {
    return json(res, 409, { ok: false, error: 'Ya existe una verificación pendiente; envía el mensaje de WhatsApp o espera a que caduque.' });
  }
  // Comprueba primero la configuración externa: una caída de Meta no debe
  // borrar por accidente la verificación válida que ya tuviera esta persona.
  const numeroMeta = await numeroEmpresaMeta();
  const ahora = new Date().toISOString();
  const { error: errorContacto } = await supabase.from('planta_whatsapp_contactos').upsert({
    user_id: user.id, planta_id: perfil.planta_id, organizacion_id: perfil.organizacion_id,
    telefono_e164: telefono, consentimiento_en: ahora, verificado_en: null, updated_at: ahora,
  }, { onConflict: 'user_id,planta_id' });
  if (errorContacto) throw Object.assign(new Error('No fue posible guardar el contacto WhatsApp.'), { status: 503 });

  await supabase.from('planta_whatsapp_verificaciones').update({ consumido_en: ahora })
    .eq('user_id', user.id).eq('planta_id', perfil.planta_id).is('consumido_en', null);
  const codigo = randomBytes(32).toString('base64url');
  const { error: errorVerificacion } = await supabase.from('planta_whatsapp_verificaciones').insert({
    user_id: user.id, planta_id: perfil.planta_id, codigo_hash: hashCodigoVerificacionWhatsApp(codigo),
    expira_en: new Date(Date.now() + VENTANA_DESAFIO_MS).toISOString(), canal: 'whatsapp',
  });
  if (errorVerificacion) throw Object.assign(new Error('No fue posible iniciar la verificación de WhatsApp.'), { status: 503 });
  const texto = `DOWNTIMEOS VERIFICAR ${codigo}`;
  const enlace = `https://wa.me/${numeroMeta}?text=${encodeURIComponent(texto)}`;
  return json(res, 201, { ok: true, enlace_verificacion: enlace, expira_en: new Date(Date.now() + 10 * 60 * 1000).toISOString(), instrucciones: 'Abre WhatsApp desde el teléfono que registraste y envía el mensaje prellenado. No compartas el enlace.' });
});
