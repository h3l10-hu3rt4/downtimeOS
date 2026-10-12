import { randomBytes } from 'node:crypto';
import { ruta, json, leerCuerpo } from '../../lib/http.js';
import { sesionDesdeEncabezado } from '../../lib/cuenta.js';
import { supabase } from '../../lib/supabase.js';
import { hashCodigoVerificacionWhatsApp, normalizarTelefonoE164 } from '../../lib/whatsapp-contactos.js';

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
    const { data, error } = await supabase.from('planta_whatsapp_contactos')
      .select('telefono_e164,consentimiento_en,verificado_en,updated_at')
      .eq('user_id', user.id).eq('planta_id', perfil.planta_id).maybeSingle();
    if (error) throw Object.assign(new Error('No fue posible consultar el contacto WhatsApp.'), { status: 503 });
    return json(res, 200, { ok: true, contacto: data || null });
  }
  if (req.method === 'DELETE') {
    const { error } = await supabase.from('planta_whatsapp_contactos')
      .delete().eq('user_id', user.id).eq('planta_id', perfil.planta_id);
    if (error) throw Object.assign(new Error('No fue posible retirar el consentimiento WhatsApp.'), { status: 503 });
    return json(res, 200, { ok: true, mensaje: 'Contacto y desafíos pendientes eliminados.' });
  }

  const cuerpo = leerCuerpo(req);
  if (cuerpo.consentimiento !== true) return json(res, 400, { ok: false, error: 'Confirma que aceptas recibir notificaciones operativas por WhatsApp.' });
  const telefono = normalizarTelefonoE164(cuerpo.telefono);
  const { data: pendiente, error: errorPendiente } = await supabase.from('planta_whatsapp_verificaciones')
    .select('id,expira_en').eq('user_id', user.id).eq('planta_id', perfil.planta_id).is('consumido_en', null)
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
    expira_en: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  });
  if (errorVerificacion) throw Object.assign(new Error('No fue posible iniciar la verificación de WhatsApp.'), { status: 503 });
  const texto = `DOWNTIMEOS VERIFICAR ${codigo}`;
  const enlace = `https://wa.me/${numeroMeta}?text=${encodeURIComponent(texto)}`;
  return json(res, 201, { ok: true, enlace_verificacion: enlace, expira_en: new Date(Date.now() + 10 * 60 * 1000).toISOString(), instrucciones: 'Abre WhatsApp desde el teléfono que registraste y envía el mensaje prellenado. No compartas el enlace.' });
});
