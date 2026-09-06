/** Integraciones externas: Gemini, PDF en Storage y WhatsApp por Twilio. */
import { GoogleGenAI } from '@google/genai';
import PDFDocument from 'pdfkit';
import { supabase } from './supabase.js';
import { estadoPlanta } from './planta.js';

const BUCKET_REPORTES = 'reportes';

function errorPeticion(mensaje, status = 400) {
  const error = new Error(mensaje);
  error.status = status;
  return error;
}

function configuracion(nombre) {
  const valor = process.env[nombre];
  if (!valor) throw errorPeticion(`La integración no está configurada: falta ${nombre}.`, 503);
  return valor;
}

function numero(valor) { return Number(valor ?? 0); }

function resumenDeEventos(eventos) {
  const porCausa = new Map();
  const porActivo = new Map();
  let minutos = 0;
  let costo = 0;
  for (const evento of eventos) {
    const min = numero(evento.minutos);
    const monto = numero(evento.costo_mxn);
    minutos += min;
    costo += monto;
    const causa = evento.causa_mostrada || evento.causa_id || 'Sin clasificar';
    const actual = porCausa.get(causa) ?? { causa, eventos: 0, minutos: 0, costo_mxn: 0 };
    actual.eventos += 1; actual.minutos += min; actual.costo_mxn += monto;
    porCausa.set(causa, actual);
    const activo = evento.activo_id || 'Sin activo';
    const activoActual = porActivo.get(activo) ?? { activo, eventos: 0, minutos: 0, costo_mxn: 0 };
    activoActual.eventos += 1; activoActual.minutos += min; activoActual.costo_mxn += monto;
    porActivo.set(activo, activoActual);
  }
  const ordenar = (a, b) => b.costo_mxn - a.costo_mxn;
  return {
    eventos: eventos.length,
    minutos_paro: Math.round(minutos * 100) / 100,
    costo_total_mxn: Math.round(costo * 100) / 100,
    mttr_minutos: eventos.length ? Math.round((minutos / eventos.length) * 100) / 100 : 0,
    causas_principales: [...porCausa.values()].sort(ordenar).slice(0, 5),
    activos_principales: [...porActivo.values()].sort(ordenar).slice(0, 5),
  };
}

/** Datos sin dinero para el radar de Operaciones y Mantenimiento. */
function resumenOperativo(eventos, planta) {
  const resumen = resumenDeEventos(eventos);
  // Las líneas trabajan por etapas en serie. Dentro de una etapa, los equipos
  // equivalentes trabajan en paralelo: si se detiene uno de dos, la etapa
  // conserva 50%; si se detiene el único, la línea queda sin capacidad.
  const estadosPorActivo = new Map(planta.estados.map((estado) => [estado.activo_id, estado]));
  const etapasPorLinea = new Map();
  for (const activo of planta.activos) {
    const llave = `${activo.linea_id}:${activo.etapa}`;
    const grupo = etapasPorLinea.get(llave) ?? {
      linea: activo.linea_id, etapa: activo.etapa, equipos: 0, operando: 0, detenidos: [],
    };
    grupo.equipos += 1;
    const estado = estadosPorActivo.get(activo.id);
    if (!estado || estado.estado === 'RUN') grupo.operando += 1;
    else grupo.detenidos.push(activo.id);
    etapasPorLinea.set(llave, grupo);
  }
  const capacidadPorLinea = new Map();
  for (const grupo of etapasPorLinea.values()) {
    const capacidad = grupo.equipos ? grupo.operando / grupo.equipos : 1;
    const actual = capacidadPorLinea.get(grupo.linea) ?? { linea: grupo.linea, capacidad: 1, etapas_limitantes: [] };
    if (capacidad < actual.capacidad) {
      actual.capacidad = capacidad;
      actual.etapas_limitantes = [grupo];
    } else if (capacidad === actual.capacidad && capacidad < 1) {
      actual.etapas_limitantes.push(grupo);
    }
    capacidadPorLinea.set(grupo.linea, actual);
  }
  return {
    eventos_recientes: resumen.eventos,
    minutos_paro_recientes: resumen.minutos_paro,
    mttr_minutos: resumen.mttr_minutos,
    causas_recurrentes: resumen.causas_principales.map(({ causa, eventos: ocurrencias, minutos }) => ({
      causa, ocurrencias, minutos,
    })),
    activos_recurrentes: resumen.activos_principales.map(({ activo, eventos: ocurrencias, minutos }) => ({
      activo, ocurrencias, minutos,
    })),
    estado_actual: {
      activos_detenidos: planta.estados.filter((estado) => estado.estado === 'STOP').map((estado) => ({
        activo: estado.activo_id, causa: estado.causa_id, desde: estado.desde,
      })),
      solicitudes_pendientes: planta.solicitudes.length,
      capacidad_por_linea: [...capacidadPorLinea.values()].map((linea) => ({
        linea: linea.linea,
        capacidad_porcentaje: Math.round(linea.capacidad * 100),
        etapas_limitantes: linea.etapas_limitantes.map((etapa) => ({
          etapa: etapa.etapa, equipos: etapa.equipos, detenidos: etapa.detenidos,
        })),
      })),
    },
  };
}

const ESQUEMA_ANALISIS = {
  type: 'object', additionalProperties: false,
  required: ['resumen', 'prioridad', 'hallazgos', 'recomendaciones', 'acciones_criticas', 'acciones_seguimiento', 'consideraciones', 'advertencia'],
  properties: {
    resumen: { type: 'string' },
    prioridad: { type: 'string', enum: ['baja', 'media', 'alta', 'critica'] },
    hallazgos: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 5 },
    recomendaciones: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 5 },
    acciones_criticas: { type: 'array', items: { type: 'string' }, minItems: 0, maxItems: 3 },
    acciones_seguimiento: { type: 'array', items: { type: 'string' }, minItems: 0, maxItems: 3 },
    consideraciones: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3 },
    advertencia: { type: 'string' },
  },
};

export async function generarAnalisis({ desde = null, hasta = null, enfoque = 'finanzas' } = {}) {
  const apiKey = configuracion('GEMINI_API_KEY');
  const modelo = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
  // Cada rol tiene un nivel fijo: piso necesita agilidad; Finanzas, profundidad.
  // No se acepta un valor del cliente para evitar análisis financieros accidentales
  // con una profundidad inferior a la acordada.
  const nivel = enfoque === 'operaciones' ? 'low' : 'high';
  const finPeriodo = hasta ? `${hasta}T23:59:59.999Z` : null;
  const planta = await estadoPlanta({ desde, hasta: finPeriodo, limite: 2000 });
  const entrada = enfoque === 'operaciones'
    ? { ...resumenOperativo(planta.eventos, planta), enfoque }
    : { ...resumenDeEventos(planta.eventos), enfoque };
  const instruccion = enfoque === 'operaciones'
    ? 'Eres un analista de confiabilidad para Operaciones y Mantenimiento. Actúa como radar de riesgo operativo: identifica qué se está haciendo mal, desviaciones del proceso, causas y activos que se repiten, y señales tempranas de una posible falla o interrupción próxima. Usa el estado actual y el historial: evalúa la capacidad de cada línea por etapas en serie; una etapa con un solo equipo detenido deja la línea en 0%, mientras equipos paralelos reducen la capacidad proporcionalmente. El resumen debe tener 2 o 3 frases y explicar el patrón dominante y la continuidad de producción. Entrega entre 3 y 5 hallazgos concretos. Clasifica las acciones por prioridad: recomendaciones contiene de 1 a 5 acciones para ejecutar este turno; acciones_seguimiento contiene de 0 a 3 verificaciones o acciones posteriores; y acciones_criticas SOLO contiene de 0 a 3 intervenciones inmediatas cuando exista capacidad actual en 0%, condición insegura, parada activa o riesgo inminente. Si no hay urgencia, acciones_criticas debe ser lista vacía. Las acciones deben ser prácticas, verificables y respaldadas por los datos. Incluye de 1 a 3 consideraciones de campo o datos faltantes. Formula toda predicción como "riesgo" o "indicio", nunca como certeza. No hables de dinero, costos ni desempeño financiero; tampoco inventes datos ausentes.'
    : 'Eres analista de dirección y finanzas industriales. Analiza patrones y concentración a lo largo de todos los registros del periodo solicitado; no llames "tendencia" a algo que no pueda sostenerse con esos datos. Enfócate exclusivamente en impacto económico, recurrencia de causas y activos que explican pérdidas. La interfaz ya muestra tarjetas con costo del periodo, número de eventos y mayor concentración: NO repitas esas cifras, el activo principal, la causa principal ni sus porcentajes en el resumen o hallazgos. Usa el resumen para explicar la implicación ejecutiva y los hallazgos para aportar un patrón, riesgo de presupuesto, comparación o relación causal distinta; cada punto debe añadir información nueva. Entrega entre 3 y 5 hallazgos financieros no redundantes. Clasifica las decisiones: recomendaciones contiene de 1 a 5 decisiones financieras a ejecutar este periodo; acciones_seguimiento contiene de 0 a 3 validaciones, métricas o revisiones de seguimiento; y acciones_criticas SOLO contiene de 0 a 3 decisiones inmediatas respaldadas por una concentración o pérdida extraordinaria. Si no hay urgencia, acciones_criticas debe ser lista vacía. No des instrucciones técnicas de piso como implementar mantenimiento, capacitar, ajustar, revisar inventario, aplicar SMED o auditar equipos: esas pertenecen a Operaciones y Mantenimiento. Incluye de 1 a 3 consideraciones sobre supuestos, límites de datos o validaciones necesarias para una decisión económica. No inventes fallas, cifras, causas ni recomendaciones que dependan de datos ausentes.';
  const ai = new GoogleGenAI({ apiKey });
  const respuesta = await ai.models.generateContent({
    model: modelo,
    contents: `${instruccion} Devuelve español claro y una advertencia breve de que es apoyo analítico y requiere validación humana.\n\nDATOS CALCULADOS:\n${JSON.stringify(entrada)}`,
    config: {
      responseMimeType: 'application/json', responseJsonSchema: ESQUEMA_ANALISIS, temperature: 0.2,
      thinkingConfig: { thinkingLevel: nivel },
    },
  });
  let resultado;
  try { resultado = JSON.parse(respuesta.text); } catch { throw errorPeticion('Gemini devolvió una respuesta no válida.', 502); }
  // Gemini expone el consumo real de esta petición. Se guarda como metadato
  // operativo (no contiene prompts, claves ni datos personales) para el panel
  // de uso y costos.
  const metadatosUso = respuesta.usageMetadata ?? {};
  resultado.uso = {
    nivel_razonamiento: nivel,
    tokens_entrada: numero(metadatosUso.promptTokenCount),
    tokens_salida: numero(metadatosUso.candidatesTokenCount),
    tokens_pensamiento: numero(metadatosUso.thoughtsTokenCount),
    tokens_total: numero(metadatosUso.totalTokenCount),
  };
  const { data, error } = await supabase.from('planta_analisis_ia').insert({
    desde, hasta, modelo, entrada, resultado,
  }).select().single();
  if (error) throw errorPeticion(`No fue posible guardar el análisis: ${error.message}`, 500);
  return data;
}

function formatoMoneda(valor) {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(numero(valor));
}

function crearPdf({ resumen, analisis }) {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ margin: 48, size: 'A4', info: { Title: 'Reporte ejecutivo DowntimeOS' } });
    const bloques = [];
    pdf.on('data', (bloque) => bloques.push(bloque));
    pdf.on('error', reject);
    pdf.on('end', () => resolve(Buffer.concat(bloques)));
    pdf.fillColor('#A97400').fontSize(10).text('DOWNTIMEOS · REPORTE EJECUTIVO');
    pdf.fillColor('#10151C').fontSize(22).text('Disponibilidad y pérdidas de planta', { paragraphGap: 8 });
    pdf.fillColor('#5D697D').fontSize(9).text(`Emitido: ${new Date().toLocaleString('es-MX')} · Datos de operación registrados`);
    pdf.moveDown();
    pdf.fillColor('#10151C').fontSize(13).text('Indicadores del periodo');
    pdf.fontSize(10).list([
      `Eventos: ${resumen.eventos}`,
      `Minutos de paro: ${resumen.minutos_paro}`,
      `Costo acumulado: ${formatoMoneda(resumen.costo_total_mxn)}`,
      `MTTR: ${resumen.mttr_minutos} min`,
    ]);
    pdf.moveDown().fontSize(13).text('Análisis IA');
    pdf.fontSize(10).text(analisis.resumen, { lineGap: 3 });
    pdf.moveDown(0.5).fontSize(11).text('Hallazgos');
    pdf.fontSize(10).list(analisis.hallazgos);
    pdf.moveDown(0.5).fontSize(11).text('Recomendaciones financieras priorizadas');
    pdf.fontSize(10).list(analisis.recomendaciones);
    pdf.moveDown().fillColor('#5D697D').fontSize(8).text(analisis.advertencia);
    pdf.end();
  });
}

export async function crearReporte({ analisisId = null, desde = null, hasta = null } = {}) {
  let analisis;
  if (analisisId) {
    const { data, error } = await supabase.from('planta_analisis_ia').select('*').eq('id', analisisId).maybeSingle();
    if (error || !data) throw errorPeticion('El análisis solicitado no existe.', 404);
    analisis = data;
  } else {
    analisis = await generarAnalisis({ desde, hasta });
  }
  const contenido = await crearPdf({ resumen: analisis.entrada, analisis: analisis.resultado });
  const id = crypto.randomUUID();
  const storagePath = `downtimeco/${new Date().toISOString().slice(0, 10)}/${id}.pdf`;
  const { error: errorArchivo } = await supabase.storage.from(BUCKET_REPORTES).upload(storagePath, contenido, {
    contentType: 'application/pdf', upsert: false,
  });
  if (errorArchivo) throw errorPeticion(`No fue posible guardar el PDF: ${errorArchivo.message}`, 500);
  const { data, error } = await supabase.from('planta_reportes').insert({
    id, analisis_id: analisis.id, desde: analisis.desde, hasta: analisis.hasta, storage_path: storagePath,
  }).select().single();
  if (error) throw errorPeticion(`No fue posible registrar el reporte: ${error.message}`, 500);
  return { ...data, analisis: analisis.resultado };
}

export async function urlFirmadaReporte(reporte, segundos = 60 * 60 * 24) {
  const { data, error } = await supabase.storage.from(BUCKET_REPORTES).createSignedUrl(reporte.storage_path, segundos);
  if (error) throw errorPeticion(`No fue posible preparar el PDF: ${error.message}`, 500);
  return data.signedUrl;
}

function telefonoWhatsApp(valor) {
  const digitos = String(valor ?? '').replace(/\D/g, '');
  if (digitos.length < 10 || digitos.length > 15) throw errorPeticion('El destinatario de WhatsApp debe tener formato E.164.');
  return `whatsapp:+${digitos}`;
}

export async function enviarWhatsApp({ destinatario, contenido, reporteId = null, eventoFolio = null }) {
  const sid = configuracion('TWILIO_ACCOUNT_SID');
  const token = configuracion('TWILIO_AUTH_TOKEN');
  const desde = telefonoWhatsApp(configuracion('TWILIO_WHATSAPP_FROM'));
  const destino = telefonoWhatsApp(destinatario || configuracion('WHATSAPP_ALERTAS_DESTINATARIOS').split(',')[0]);
  let mediaUrl = null;
  if (reporteId) {
    const { data: reporte, error } = await supabase.from('planta_reportes').select('*').eq('id', reporteId).maybeSingle();
    if (error || !reporte) throw errorPeticion('El reporte solicitado no existe.', 404);
    mediaUrl = await urlFirmadaReporte(reporte);
  }
  const { data: registro, error: errorRegistro } = await supabase.from('planta_mensajes').insert({
    destinatario: destino.replace('whatsapp:', ''), contenido, evento_folio: eventoFolio, reporte_id: reporteId,
  }).select().single();
  if (errorRegistro) throw errorPeticion(`No fue posible registrar el mensaje: ${errorRegistro.message}`, 500);
  const appUrl = configuracion('PUBLIC_APP_URL').replace(/\/$/, '');
  const cuerpo = new URLSearchParams({ From: desde, To: destino, Body: contenido });
  // Twilio no puede entregar callbacks a localhost. En desarrollo se prueba el
  // envío; al desplegar en Vercel (HTTPS) se habilita el historial de estados.
  if (/^https:\/\//i.test(appUrl)) cuerpo.set('StatusCallback', `${appUrl}/api/webhooks/whatsapp`);
  if (mediaUrl) cuerpo.set('MediaUrl', mediaUrl);
  try {
    const respuesta = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: cuerpo,
    });
    const json = await respuesta.json();
    if (!respuesta.ok) throw new Error(json.message || `HTTP ${respuesta.status}`);
    const { data, error } = await supabase.from('planta_mensajes').update({ proveedor_id: json.sid, estado: json.status || 'queued', metadatos: json }).eq('id', registro.id).select().single();
    if (error) throw error;
    return data;
  } catch (causa) {
    await supabase.from('planta_mensajes').update({ estado: 'failed', error: String(causa.message || causa) }).eq('id', registro.id);
    throw errorPeticion(`No fue posible enviar WhatsApp: ${causa.message || causa}`, 502);
  }
}

export async function alertaDeActivo({ activoId, destinatario = null }) {
  const { data: estado, error } = await supabase.from('planta_estados').select('*, planta_activos!inner(id, nombre, linea_id, cuello_botella), planta_causas(etiqueta)').eq('activo_id', activoId).maybeSingle();
  if (error || !estado) throw errorPeticion(`No existe estado para el activo ${activoId}.`, 404);
  if (estado.estado !== 'STOP') throw errorPeticion(`El activo ${activoId} no está detenido.`);
  const minutos = Math.max(0, Math.round((Date.now() - new Date(estado.desde).getTime()) / 60000));
  const activo = estado.planta_activos;
  const texto = `🔴 PARO NO PROGRAMADO\nActivo: ${activo.id} · ${activo.nombre}\nLínea: ${activo.linea_id}\nTiempo detenido: ${minutos} min\nCausa: ${estado.planta_causas?.etiqueta || 'Sin clasificar'}${activo.cuello_botella ? '\n⚠ Cuello de botella: prioridad 1.' : ''}`;
  return enviarWhatsApp({ destinatario, contenido: texto });
}
