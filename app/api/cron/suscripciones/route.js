import { timingSafeEqual } from 'node:crypto';
import { supabase } from '../../../../lib/supabase.js';
import { crearUrlApp } from '../../../../lib/app-url.js';

export const runtime = 'nodejs';
export const maxDuration = 60;

const RESPUESTA_NO_AUTORIZADA = () => Response.json({ ok: false, error: 'No autorizado.' }, { status: 401 });

export function tipoAvisoVencimiento(milisegundos) {
  if (!Number.isFinite(milisegundos) || milisegundos <= 0) return null;
  const horas = milisegundos / (60 * 60 * 1000);
  // Cron horario: ventanas centradas en 7 y 1 días sin mentir en el texto.
  if (horas >= 18 && horas <= 30) return '1_dia';
  if (horas >= 162 && horas <= 174) return '7_dias';
  return null;
}

const TAMANO_PAGINA_AVISOS = 200;
// Cron corre cada hora y la función de Vercel tiene maxDuration=60s.
const MAX_PAGINAS_AVISOS = 20;
const PRESUPUESTO_AVISOS_MS = 35000;

export function ventanasAvisoVencimiento(ahora) {
  const hora = 60 * 60 * 1000;
  const instante = ahora.getTime();
  return [
    { tipo: '1_dia', desde: new Date(instante + 18 * hora).toISOString(), hasta: new Date(instante + 30 * hora).toISOString() },
    { tipo: '7_dias', desde: new Date(instante + 162 * hora).toISOString(), hasta: new Date(instante + 174 * hora).toISOString() },
  ];
}

export async function cargarAvisosElegibles(ahoraIso, horaInicioMs, cliente = supabase) {
  const pendientes = [];
  const ventanas = ventanasAvisoVencimiento(new Date(ahoraIso));

  for (const ventana of ventanas) {
    let cursor = null;
    for (let pagina = 0; pagina < MAX_PAGINAS_AVISOS; pagina++) {
      if (Date.now() - horaInicioMs >= PRESUPUESTO_AVISOS_MS) {
        return { pendientes, truncado: true };
      }

      let consulta = cliente.from('organizacion_suscripciones')
        .select('id,organizacion_id,plan_codigo,periodicidad,termina_en,organizaciones(nombre,propietario_id)')
        .in('estado', ['activa', 'piloto', 'cancelacion_programada'])
        .gt('termina_en', ahoraIso)
        .gte('termina_en', ventana.desde)
        .lte('termina_en', ventana.hasta)
        .order('termina_en', { ascending: true })
        .order('id', { ascending: true })
        .limit(TAMANO_PAGINA_AVISOS);

      // Keyset pagination avoids increasingly expensive offsets and remains
      // deterministic when multiple subscriptions share termina_en.
      if (cursor) {
        const { terminaEn, id } = cursor;
        consulta = consulta.or(`termina_en.gt.${terminaEn},and(termina_en.eq.${terminaEn},id.gt.${id})`);
      }

      const { data, error } = await consulta;
      if (error) return { pendientes, error };
      if (!data?.length) break;

      for (const suscripcion of data) pendientes.push({ suscripcion, tipo: ventana.tipo });
      const ultima = data[data.length - 1];
      cursor = { terminaEn: ultima.termina_en, id: ultima.id };
      if (data.length < TAMANO_PAGINA_AVISOS) break;
      if (pagina === MAX_PAGINAS_AVISOS - 1) return { pendientes, truncado: true };
    }
  }

  return { pendientes, truncado: false };
}

function secretoValido(autorizacion, secreto) {
  if (!secreto || !autorizacion?.startsWith('Bearer ')) return false;
  const recibido = Buffer.from(autorizacion.slice(7));
  const esperado = Buffer.from(secreto);
  return recibido.length === esperado.length && timingSafeEqual(recibido, esperado);
}

function escaparHtml(valor) {
  return String(valor || '').replace(/[&<>"']/g, (caracter) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[caracter]);
}

async function enviarAviso({ apiKey, remitente, destinatario, asunto, html, llave }) {
  const respuesta = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': llave,
    },
    body: JSON.stringify({ from: remitente, to: [destinatario], subject: asunto, html }),
    signal: AbortSignal.timeout(12000),
  });
  const cuerpo = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok || !cuerpo.id) throw new Error(cuerpo.message || `Resend respondió HTTP ${respuesta.status}.`);
  return cuerpo.id;
}

export async function GET(request) {
  const secreto = process.env.CRON_SECRET;
  if (!secreto) return Response.json({ ok: false, error: 'Falta configurar CRON_SECRET.' }, { status: 503 });
  if (!secretoValido(request.headers.get('authorization'), secreto)) return RESPUESTA_NO_AUTORIZADA();

  // Validar toda la configuración antes de mutar ciclos: una ejecución sin
  // proveedor de correo no debe vencer/activar períodos y luego abortar.
  const apiKey = process.env.RESEND_API_KEY;
  const remitente = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !remitente) {
    return Response.json({ ok: false, error: 'Falta configurar RESEND_API_KEY y RESEND_FROM_EMAIL para avisos de renovación.' }, { status: 503 });
  }
  let urlSuscripcion;
  try {
    urlSuscripcion = crearUrlApp('/suscripcion').toString();
  } catch (error) {
    console.error('[downtimeos] cron: falta una URL segura para el enlace de suscripción:', error.message);
    return Response.json({ ok: false, error: 'Falta configurar la URL pública de DowntimeOS.' }, { status: 503 });
  }

  const ahora = new Date();
  const ahoraIso = ahora.toISOString();
  const { data: vencidas, error: errorVencidas } = await supabase.from('organizacion_suscripciones')
    .update({ estado: 'vencida', updated_at: ahoraIso })
    .in('estado', ['activa', 'piloto', 'cancelacion_programada'])
    .not('termina_en', 'is', null)
    .lte('termina_en', ahoraIso)
    .select('id');
  if (errorVencidas) {
    console.error('[downtimeos] cron: no se pudieron vencer suscripciones:', errorVencidas.message);
    return Response.json({ ok: false, error: 'No se pudo actualizar el ciclo de suscripciones.' }, { status: 503 });
  }

  const { data: periodosIniciados, error: errorPeriodosIniciados } = await supabase.from('organizacion_suscripciones')
    .update({ periodo_programado: false, updated_at: ahoraIso })
    .eq('periodo_programado', true).in('estado', ['activa', 'piloto', 'cancelacion_programada'])
    .not('inicia_en', 'is', null).lte('inicia_en', ahoraIso).select('id');
  if (errorPeriodosIniciados) {
    console.error('[downtimeos] cron: no se pudieron iniciar periodos programados:', errorPeriodosIniciados.message);
    return Response.json({ ok: false, vencidas: vencidas?.length || 0, error: 'No se pudieron actualizar periodos contratados.' }, { status: 503 });
  }

  const inicioCargaAvisos = Date.now();
  const { pendientes, error: errorPorVencer, truncado } = await cargarAvisosElegibles(ahoraIso, inicioCargaAvisos);
  if (errorPorVencer) {
    console.error('[downtimeos] cron: no se pudieron cargar vencimientos:', errorPorVencer.message);
    return Response.json({ ok: false, vencidas: vencidas?.length || 0, error: 'No se pudieron cargar avisos.' }, { status: 503 });
  }

  let enviadas = 0;
  let fallidas = 0;
  let omitidas = 0;
  let cursor = 0;
  async function procesarAviso(item) {
    const s = item.suscripcion;
    const organizacion = Array.isArray(s.organizaciones) ? s.organizaciones[0] : s.organizaciones;
    const propietario = organizacion?.propietario_id;
    if (!propietario) { omitidas++; return; }
    const { data: resultadoUsuario, error: errorUsuario } = await supabase.auth.admin.getUserById(propietario);
    const usuario = resultadoUsuario?.user;
    if (errorUsuario || !usuario?.email) { fallidas++; return; }

    // The RPC returns a fresh fencing token for this lease, not the row ID.
    // A worker whose lease expired cannot overwrite the result of its successor.
    const { data: tokenReserva, error: reservaError } = await supabase.rpc('organizacion_reservar_aviso_suscripcion', {
      p_organizacion_id: s.organizacion_id, p_suscripcion_id: s.id, p_tipo: item.tipo, p_destinatario: usuario.email,
    });
    if (reservaError) { fallidas++; return; }
    if (!tokenReserva) { omitidas++; return; }

    const fecha = new Intl.DateTimeFormat('es-MX', {
      timeZone: 'America/Mexico_City', dateStyle: 'long',
    }).format(new Date(s.termina_en));
    const dias = item.tipo === '7_dias' ? '7 días' : '1 día';
    const nombre = escaparHtml(organizacion.nombre || 'tu empresa');
    const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#17202a"><p style="font-size:12px;letter-spacing:.18em;color:#9a6700">DOWNTIMEOS · SUSCRIPCIÓN</p><h1 style="font-size:24px">Tu plan vence pronto</h1><p>Hola, te avisamos que el plan <b>${escaparHtml(s.plan_codigo.toUpperCase())}</b> de <b>${nombre}</b> vence el <b>${escaparHtml(fecha)}</b> (en ${dias}).</p><p>El acceso operativo se detendrá al terminar el periodo. No hay renovación automática: entra a tu panel para solicitar la renovación y validar el pago.</p><p><a href="${escaparHtml(urlSuscripcion)}" style="display:inline-block;background:#ffb627;color:#090b0e;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Revisar suscripción</a></p><p style="font-size:12px;color:#697586">Este aviso se envió al propietario de la cuenta.</p></div>`;
    try {
      const proveedorId = await enviarAviso({
        apiKey, remitente, destinatario: usuario.email,
        asunto: `DowntimeOS: ${s.plan_codigo.toUpperCase()} vence el ${fecha}`,
        html, llave: `suscripcion/${s.id}/${item.tipo}`,
      });
      const { data: actualizacion, error: actualizarError } = await supabase.from('organizacion_suscripcion_avisos')
        .update({ estado: 'enviada', enviado_en: new Date().toISOString(), proveedor_id: proveedorId, ultimo_error: '', lease_token: null, lease_until: null })
        .eq('lease_token', tokenReserva).select('id').maybeSingle();
      if (actualizarError) {
        // Resend ya aceptó el mensaje. No marcar error/reabrir: la siguiente
        // ejecución repetiría un correo que sí salió. Dejar procesando para
        // investigación manual; la llave de idempotencia del proveedor evita
        // duplicado mientras su ventana siga vigente.
        console.error('[downtimeos] cron: Resend aceptó aviso pero no se guardó el resultado:', actualizarError.message);
        fallidas++;
        return;
      }
      if (!actualizacion) {
        // Another cron recovered this lease; its fencing token owns the row now.
        omitidas++;
        return;
      }
      enviadas++;
    } catch (error) {
      const { error: registroError } = await supabase.from('organizacion_suscripcion_avisos')
        .update({ estado: 'error', ultimo_error: String(error.message || error).slice(0, 500), lease_token: null, lease_until: null })
        .eq('lease_token', tokenReserva);
      if (registroError) console.error('[downtimeos] cron: tampoco se pudo guardar el error del aviso:', registroError.message);
      fallidas++;
    }
  }

  const trabajadores = Array.from({ length: Math.min(5, pendientes.length) }, async () => {
    while (cursor < pendientes.length) {
      const indice = cursor++;
      await procesarAviso(pendientes[indice]);
    }
  });
  await Promise.all(trabajadores);
  const respuesta = {
    ok: fallidas === 0 && !truncado,
    vencidas: vencidas?.length || 0,
    periodos_iniciados: periodosIniciados?.length || 0,
    avisos_enviados: enviadas,
    omitidos: omitidas,
    fallidos: fallidas,
    ...(truncado ? { avisos_pendientes_de_siguiente_ejecucion: true } : {}),
  };
  return Response.json(respuesta, { status: fallidas || truncado ? 503 : 200, headers: { 'Cache-Control': 'no-store' } });
}
