/** Integraciones externas: Gemini, PDF en Storage y mensajería WhatsApp. */
import { GoogleGenAI } from '@google/genai';
import Anthropic from '@anthropic-ai/sdk';
import PDFDocument from 'pdfkit';
import { createHash } from 'node:crypto';
import { supabase } from './supabase.js';
import { estadoPlanta } from './planta.js';
import { exigirIntegracionActiva } from './interruptores.js';

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

export async function conReintentoProveedor(operacion, { intentos = 3, esperaBaseMs = 600 } = {}) {
  let ultimoError;
  for (let intento = 0; intento < intentos; intento += 1) {
    try { return await operacion(); }
    catch (error) {
      ultimoError = error;
      const codigo = Number(error?.status ?? error?.error?.code);
      if (![429, 503].includes(codigo) || intento === intentos - 1) throw error;
      await new Promise((resolver) => setTimeout(resolver, esperaBaseMs * (intento + 1)));
    }
  }
  throw ultimoError;
}

async function proveedorPara(enfoque) {
  const predeterminado = enfoque === 'operaciones'
    ? (process.env.AI_OPERACIONES_PROVIDER || 'gemini')
    : (process.env.AI_FINANZAS_PROVIDER || 'gemini');
  const { data, error } = await supabase.from('planta_proveedor_ia').select('proveedor').eq('enfoque', enfoque).maybeSingle();
  // La migración puede no haberse aplicado aún: la demo conserva el valor .env.
  const nombre = error || !data ? predeterminado : data.proveedor;
  if (!['gemini', 'anthropic'].includes(nombre)) {
    throw errorPeticion(`Proveedor de IA no permitido: ${nombre}.`, 503);
  }
  return nombre;
}

/** Nombre del modelo que usa cada proveedor. Única fuente para análisis, PDF y caché. */
export function modeloDe(proveedor) {
  return proveedor === 'anthropic'
    ? (process.env.ANTHROPIC_MODEL || 'claude-sonnet-5')
    : (process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite');
}

/** Datos de la planta para un periodo: la misma consulta para análisis y caché. */
function datosDelPeriodo(desde, hasta) {
  const finPeriodo = hasta ? `${hasta}T23:59:59.999Z` : null;
  return estadoPlanta({ desde, hasta: finPeriodo, limite: 2000 });
}

/**
 * Huella de los datos con los que se arma un reporte: los paros del periodo
 * (folio, minutos, costo) y el estado de cada máquina (estado y desde cuándo).
 * Si cualquiera cambia —un paro nuevo, una corrección, una máquina que se
 * detiene o arranca—, la huella cambia y el reporte en caché deja de servir.
 */
export function firmaDeDatos(planta) {
  const eventos = (planta?.eventos ?? [])
    .map((e) => `${e.folio}|${Number(e.minutos)}|${Number(e.costo_mxn)}`).sort();
  const estados = (planta?.estados ?? [])
    .map((e) => `${e.activo_id}|${e.estado}|${e.desde}`).sort();
  return createHash('sha256').update(JSON.stringify({ eventos, estados })).digest('hex');
}

function textoDeClaude(respuesta) {
  return respuesta.content.filter((bloque) => bloque.type === 'text').map((bloque) => bloque.text).join('\n');
}

function jsonDeTexto(texto) {
  const limpio = String(texto || '').trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '');
  const inicio = limpio.indexOf('{');
  const fin = limpio.lastIndexOf('}');
  const candidato = inicio >= 0 && fin > inicio ? limpio.slice(inicio, fin + 1) : limpio;
  try { return JSON.parse(candidato); } catch { throw errorPeticion('El proveedor de IA devolvió una respuesta no válida.', 502); }
}

function resumenDeEventos(eventos) {
  const porCausa = new Map();
  const porActivo = new Map();
  const porTurnoLinea = new Map();
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
    const activoActual = porActivo.get(activo) ?? { activo, linea: evento.linea_id || null, eventos: 0, minutos: 0, costo_mxn: 0 };
    activoActual.eventos += 1; activoActual.minutos += min; activoActual.costo_mxn += monto;
    porActivo.set(activo, activoActual);
    // Cruce turno × línea: alimenta la gráfica «Pérdida por turno y línea» del PDF.
    const claveTurno = `${evento.turno || '—'}|${evento.linea_id || '—'}`;
    const turnoActual = porTurnoLinea.get(claveTurno) ?? { turno: evento.turno || '—', linea: evento.linea_id || '—', eventos: 0, minutos: 0, costo_mxn: 0 };
    turnoActual.eventos += 1; turnoActual.minutos += min; turnoActual.costo_mxn += monto;
    porTurnoLinea.set(claveTurno, turnoActual);
  }
  const ordenar = (a, b) => b.costo_mxn - a.costo_mxn;
  const redondear = (fila) => ({ ...fila, minutos: Math.round(fila.minutos * 100) / 100, costo_mxn: Math.round(fila.costo_mxn * 100) / 100 });
  return {
    eventos: eventos.length,
    minutos_paro: Math.round(minutos * 100) / 100,
    costo_total_mxn: Math.round(costo * 100) / 100,
    mttr_minutos: eventos.length ? Math.round((minutos / eventos.length) * 100) / 100 : 0,
    causas_principales: [...porCausa.values()].sort(ordenar).slice(0, 5),
    activos_principales: [...porActivo.values()].sort(ordenar).slice(0, 5),
    // Series completas para las gráficas del reporte (mismas que Dirección).
    por_causa: [...porCausa.values()].sort(ordenar).map(redondear),
    por_activo: [...porActivo.values()].sort(ordenar).map(redondear),
    por_turno_linea: [...porTurnoLinea.values()].map(redondear),
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

export async function generarAnalisis({ desde = null, hasta = null, enfoque = 'finanzas', proveedorForzado = null } = {}) {
  await exigirIntegracionActiva('ia');
  const esReportePdf = enfoque === 'reporte_pdf';
  // El reporte ejecutivo es de Dirección y Finanzas: usa el mismo proveedor que
  // el panel de Administración tenga activo para Finanzas. Antes quedaba fijo en
  // Gemini y el PDF podía contradecir al modelo elegido en el panel.
  const proveedor = proveedorForzado || await proveedorPara(esReportePdf ? 'finanzas' : enfoque);
  const modelo = modeloDe(proveedor);
  // Cada ruta tiene una profundidad fija y nunca llega desde el navegador:
  // Gemini financiero conserva high; Claude Sonnet se limita a low para
  // mantener la respuesta dentro de la ventana de la función.
  const nivel = esReportePdf || enfoque === 'operaciones' || proveedor === 'anthropic' ? 'low' : 'high';
  const planta = await datosDelPeriodo(desde, hasta);
  const entrada = enfoque === 'operaciones'
    ? { ...resumenOperativo(planta.eventos, planta), enfoque }
    : {
      ...resumenDeEventos(planta.eventos), enfoque,
      // Solo el reporte PDF guarda la huella: es lo que el caché compara.
      ...(esReportePdf ? { firma_datos: firmaDeDatos(planta) } : {}),
    };
  const instruccion = enfoque === 'operaciones'
    ? 'Eres un analista de confiabilidad para Operaciones y Mantenimiento. Actúa como radar de riesgo operativo: identifica qué se está haciendo mal, desviaciones del proceso, causas y activos que se repiten, y señales tempranas de una posible falla o interrupción próxima. Usa el estado actual y el historial: evalúa la capacidad de cada línea por etapas en serie; una etapa con un solo equipo detenido deja la línea en 0%, mientras equipos paralelos reducen la capacidad proporcionalmente. El resumen debe tener 2 o 3 frases y explicar el patrón dominante y la continuidad de producción. Entrega entre 3 y 5 hallazgos concretos. Clasifica las acciones por prioridad: recomendaciones contiene de 1 a 5 acciones para ejecutar este turno; acciones_seguimiento contiene de 0 a 3 verificaciones o acciones posteriores; y acciones_criticas SOLO contiene de 0 a 3 intervenciones inmediatas cuando exista capacidad actual en 0%, condición insegura, parada activa o riesgo inminente. Si no hay urgencia, acciones_criticas debe ser lista vacía. Las acciones deben ser prácticas, verificables y respaldadas por los datos. Incluye de 1 a 3 consideraciones de campo o datos faltantes. Formula toda predicción como "riesgo" o "indicio", nunca como certeza. No hables de dinero, costos ni desempeño financiero; tampoco inventes datos ausentes.'
    : esReportePdf
      ? 'Eres analista para un reporte ejecutivo industrial. Redacta un análisis financiero breve y accionable basado únicamente en los datos calculados. El PDF ya contiene los indicadores numéricos, por lo que no los repitas literalmente. Explica la implicación del patrón principal, entrega de 2 a 4 hallazgos nuevos y de 2 a 4 recomendaciones financieras priorizadas. Acciones críticas solo si hay una pérdida o concentración extraordinaria; si no, usa una lista vacía. Incluye consideraciones sobre límites de datos. No sugieras acciones técnicas de mantenimiento ni inventes cifras, causas o datos ausentes.'
    : 'Eres analista de dirección y finanzas industriales. Analiza patrones y concentración a lo largo de todos los registros del periodo solicitado; no llames "tendencia" a algo que no pueda sostenerse con esos datos. Enfócate exclusivamente en impacto económico, recurrencia de causas y activos que explican pérdidas. La interfaz ya muestra tarjetas con costo del periodo, número de eventos y mayor concentración: NO repitas esas cifras, el activo principal, la causa principal ni sus porcentajes en el resumen o hallazgos. Usa el resumen para explicar la implicación ejecutiva y los hallazgos para aportar un patrón, riesgo de presupuesto, comparación o relación causal distinta; cada punto debe añadir información nueva. Entrega entre 3 y 5 hallazgos financieros no redundantes. Clasifica las decisiones: recomendaciones contiene de 1 a 5 decisiones financieras a ejecutar este periodo; acciones_seguimiento contiene de 0 a 3 validaciones, métricas o revisiones de seguimiento; y acciones_criticas SOLO contiene de 0 a 3 decisiones inmediatas respaldadas por una concentración o pérdida extraordinaria. Si no hay urgencia, acciones_criticas debe ser lista vacía. No des instrucciones técnicas de piso como implementar mantenimiento, capacitar, ajustar, revisar inventario, aplicar SMED o auditar equipos: esas pertenecen a Operaciones y Mantenimiento. Incluye de 1 a 3 consideraciones sobre supuestos, límites de datos o validaciones necesarias para una decisión económica. No inventes fallas, cifras, causas ni recomendaciones que dependan de datos ausentes.';
  // La huella del caché se guarda con el análisis pero no se manda a la IA:
  // no le aporta nada y solo consumiría tokens.
  const { firma_datos: _firma, ...datosIa } = entrada;
  const solicitud = `${instruccion} Devuelve español claro y una advertencia breve de que es apoyo analítico y requiere validación humana.\n\nDATOS CALCULADOS:\n${JSON.stringify(datosIa)}`;
  let texto;
  let metadatosUso;
  const inicioProveedor = Date.now();
  if (proveedor === 'gemini') {
    const ai = new GoogleGenAI({ apiKey: configuracion('GEMINI_API_KEY') });
    const respuesta = await conReintentoProveedor(() => ai.models.generateContent({
      model: modelo, contents: solicitud,
      config: {
        responseMimeType: 'application/json', responseJsonSchema: ESQUEMA_ANALISIS, temperature: 0.2,
        thinkingConfig: { thinkingLevel: nivel },
      },
    }));
    texto = respuesta.text;
    metadatosUso = respuesta.usageMetadata ?? {};
  } else {
    const ai = new Anthropic({ apiKey: configuracion('ANTHROPIC_API_KEY') });
    const respuesta = await conReintentoProveedor(() => ai.messages.create({
      model: modelo, max_tokens: 4096,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low' },
      system: `${instruccion}\nDevuelve exclusivamente JSON válido, sin Markdown ni texto adicional, con estas llaves: resumen, prioridad, hallazgos, recomendaciones, acciones_criticas, acciones_seguimiento, consideraciones, advertencia. Mantén cada elemento de lista en una oración concisa y cierra siempre el objeto JSON.`,
      messages: [{ role: 'user', content: `DATOS CALCULADOS:\n${JSON.stringify(datosIa)}` }],
    }));
    texto = textoDeClaude(respuesta);
    metadatosUso = respuesta.usage ?? {};
  }
  const duracionMs = Date.now() - inicioProveedor;
  const resultado = jsonDeTexto(texto);
  // Gemini expone el consumo real de esta petición. Se guarda como metadato
  // operativo (no contiene prompts, claves ni datos personales) para el panel
  // de uso y costos.
  resultado.uso = {
    proveedor,
    modelo,
    nivel_razonamiento: nivel,
    duracion_ms: duracionMs,
    tokens_entrada: numero(proveedor === 'gemini' ? metadatosUso.promptTokenCount : metadatosUso.input_tokens),
    tokens_salida: numero(proveedor === 'gemini' ? metadatosUso.candidatesTokenCount : metadatosUso.output_tokens),
    tokens_pensamiento: numero(proveedor === 'gemini' ? metadatosUso.thoughtsTokenCount : 0),
    tokens_total: numero(proveedor === 'gemini' ? metadatosUso.totalTokenCount : numero(metadatosUso.input_tokens) + numero(metadatosUso.output_tokens)),
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

export function crearPdf({ resumen, analisis, modelo = null }) {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ margin: 0, size: 'A4', info: { Title: 'Reporte ejecutivo DowntimeOS' } });
    const bloques = [];
    pdf.on('data', (bloque) => bloques.push(bloque));
    pdf.on('error', reject);
    pdf.on('end', () => resolve(Buffer.concat(bloques)));
    const W = pdf.page.width;
    const H = pdf.page.height;
    const X = 42;
    // Guía interior para TODO texto alineado a la derecha. Queda 36 pt más
    // adentro que el borde de las líneas divisorias (W - X): así ninguna
    // impresora con margen no imprimible amplio recorta las etiquetas.
    const DERECHA = W - X - 36;
    const C = {
      tinta: '#10151C', panel: '#121A25', gris: '#5D697D', borde: '#D7DEE5', suave: '#F4F7F9',
      ambar: '#FFB627', ambarOscuro: '#A97400', rojo: '#E5484D', cyan: '#1C9BB5', verde: '#168A62',
    };
    const textoSeguro = (valor) => String(valor ?? '').replace(/[\u2013\u2014]/g, '-');
    const lista = (valor) => Array.isArray(valor) ? valor.filter(Boolean).map(textoSeguro) : [];
    const prioridad = textoSeguro(analisis?.prioridad || 'media').toUpperCase();

    const pie = (pagina) => {
      pdf.save();
      pdf.strokeColor(C.borde).lineWidth(0.6).moveTo(X, H - 38).lineTo(W - X, H - 38).stroke();
      pdf.fillColor(C.gris).font('Courier').fontSize(7.5)
        .text('DOWNTIMEOS  /  INFORME CONFIDENCIAL DE OPERACION', X, H - 29, { width: 330 });
      pdf.text(`PAG. ${pagina}`, DERECHA - 64, H - 29, { width: 64, align: 'right' });
      pdf.restore();
    };
    let pagina = 1;
    const nuevaPagina = () => {
      pie(pagina);
      pdf.addPage();
      pagina += 1;
      pdf.save();
      pdf.rect(0, 0, W, 30).fill(C.panel);
      pdf.rect(0, 0, 5, 30).fill(C.ambar);
      pdf.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8.5).text('DOWNTIME', X, 10);
      // Pegado a la palabra, medido: un desplazamiento fijo dejaba "DOWNTIME OS".
      pdf.fillColor(C.ambar).text('OS', X + pdf.widthOfString('DOWNTIME') + 0.5, 10);
      pdf.fillColor('#AEB8C5').font('Courier').fontSize(6.8).text('REPORTE EJECUTIVO - CONTINUACION', DERECHA - 174, 11, { width: 174, align: 'right' });
      pdf.restore();
    };
    const logo = (x, y, invertido = false) => {
      pdf.save();
      pdf.roundedRect(x, y, 24, 24, 6).fill(C.ambar);
      // Mismo isotipo que usa la barra de navegación: pulso de disponibilidad.
      pdf.translate(x, y).scale(0.75);
      pdf.strokeColor(invertido ? '#FFFFFF' : '#06080B').lineWidth(2.4)
        .lineCap('round').lineJoin('round')
        .path('M4 18h5l3-8 4 14 3-9 2 3h7').stroke();
      pdf.restore();
    };
    const encabezado = () => {
      pdf.save();
      pdf.rect(0, 0, W, 142).fill(C.panel);
      pdf.rect(0, 0, 7, 142).fill(C.ambar);
      logo(X, 28);
      const wordmarkX = X + 33;
      pdf.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(17).text('Downtime', wordmarkX, 30);
      pdf.fillColor(C.ambar).text('OS', wordmarkX + pdf.widthOfString('Downtime') + 1, 30);
      pdf.fillColor('#AEB8C5').font('Helvetica').fontSize(7.5).text('INTELIGENCIA PARA CONTINUIDAD OPERATIVA', X + 33, 53);
      pdf.fillColor(C.ambar).font('Courier').fontSize(8).text('REPORTE EJECUTIVO', DERECHA - 126, 31, { width: 126, align: 'right' });
      const emitido = new Intl.DateTimeFormat('es-MX', {
        timeZone: 'America/Mexico_City', dateStyle: 'short', timeStyle: 'medium',
      }).format(new Date());
      pdf.fillColor('#AEB8C5').font('Helvetica').fontSize(8.5).text(`EMITIDO ${emitido}`, DERECHA - 160, 53, { width: 160, align: 'right' });
      pdf.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(24).text('Disponibilidad y pérdidas de planta', X, 88);
      pdf.fillColor('#AEB8C5').font('Helvetica').fontSize(9.5).text('Indicadores trazables, análisis de IA y decisiones priorizadas.', X, 116);
      pdf.restore();
    };
    const tituloSeccion = (titulo, y, etiqueta = '') => {
      pdf.fillColor(C.tinta).font('Helvetica-Bold').fontSize(11).text(titulo, X, y);
      // La etiqueta termina en la guía interior DERECHA, bien dentro del
      // margen: antes llegaba al borde y se recortaba al imprimir.
      if (etiqueta) pdf.fillColor(C.gris).font('Courier').fontSize(7).text(etiqueta, X + 200, y + 3, { width: DERECHA - (X + 200), align: 'right' });
      pdf.strokeColor(C.borde).lineWidth(0.7).moveTo(X, y + 19).lineTo(W - X, y + 19).stroke();
      return y + 31;
    };
    const tarjeta = (x, y, ancho, etiqueta, valor, color, nota) => {
      pdf.save();
      pdf.roundedRect(x, y, ancho, 66, 7).fill(C.suave);
      pdf.roundedRect(x, y, ancho, 66, 7).strokeColor(C.borde).lineWidth(0.6).stroke();
      pdf.fillColor(C.gris).font('Courier').fontSize(6.7).text(etiqueta, x + 11, y + 11, { width: ancho - 22 });
      pdf.fillColor(color).font('Helvetica-Bold').fontSize(15).text(valor, x + 11, y + 25, { width: ancho - 22 });
      pdf.fillColor(C.gris).font('Helvetica').fontSize(7.2).text(nota, x + 11, y + 48, { width: ancho - 22 });
      pdf.restore();
    };
    const bloqueTexto = (titulo, contenido, y, color, etiqueta = '') => {
      const alto = Math.max(52, pdf.heightOfString(contenido, { width: W - X * 2 - 28, lineGap: 3 }) + 35);
      if (y + alto > H - 55) { nuevaPagina(); y = 44; }
      pdf.save();
      pdf.roundedRect(X, y, W - X * 2, alto, 6).fill(color === C.rojo ? '#FFF3F3' : '#F7F9FA');
      pdf.rect(X, y, 3, alto).fill(color);
      pdf.fillColor(color).font('Courier').fontSize(7).text(etiqueta || 'ANALISIS IA', X + 14, y + 11);
      pdf.fillColor(C.tinta).font('Helvetica-Bold').fontSize(10.5).text(titulo, X + 14, y + 22);
      pdf.fillColor('#354253').font('Helvetica').fontSize(9.4).text(contenido, X + 14, y + 37, { width: W - X * 2 - 28, lineGap: 3 });
      pdf.restore();
      return y + alto + 12;
    };
    const bloqueLista = (titulo, elementos, y, color, vacio) => {
      const items = elementos.length ? elementos : [vacio];
      const alturas = items.map((item) => Math.max(20, pdf.heightOfString(item, { width: W - X * 2 - 48, lineGap: 2 }) + 10));
      const alto = 34 + alturas.reduce((total, item) => total + item, 0);
      if (y + alto > H - 55) { nuevaPagina(); y = 44; }
      pdf.save();
      pdf.roundedRect(X, y, W - X * 2, alto, 6).fill('#FFFFFF').strokeColor(C.borde).lineWidth(0.6).stroke();
      pdf.rect(X, y, 3, alto).fill(color);
      pdf.fillColor(C.tinta).font('Helvetica-Bold').fontSize(10.5).text(titulo, X + 14, y + 12);
      let cursor = y + 33;
      items.forEach((item, indice) => {
        pdf.roundedRect(X + 15, cursor + 2, 14, 14, 7).fill(color);
        pdf.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(7).text(String(indice + 1), X + 15, cursor + 5, { width: 14, align: 'center' });
        pdf.fillColor(elementos.length ? '#354253' : C.gris).font('Helvetica').fontSize(9.2)
          .text(item, X + 39, cursor, { width: W - X * 2 - 53, lineGap: 2 });
        cursor += alturas[indice];
      });
      pdf.restore();
      return y + alto + 12;
    };
    const etiquetaCorta = (valor, limite = 30) => {
      const texto = textoSeguro(valor);
      return texto.length > limite ? `${texto.slice(0, limite - 1)}...` : texto;
    };
    const graficaBarras = (titulo, datos, y, color, campo, subtitulo = 'IMPACTO ECONOMICO') => {
      const ancho = W - X * 2;
      const alturaFila = 27;
      const alto = 42 + Math.max(1, datos.length) * alturaFila;
      if (y + alto > H - 55) { nuevaPagina(); y = 52; }
      pdf.roundedRect(X, y, ancho, alto, 7).fill('#FFFFFF').strokeColor(C.borde).lineWidth(0.6).stroke();
      pdf.fillColor(C.tinta).font('Helvetica-Bold').fontSize(10.5).text(titulo, X + 14, y + 13);
      pdf.fillColor(C.gris).font('Courier').fontSize(6.8).text(subtitulo, X + 14, y + 27);
      const maximo = Math.max(...datos.map((dato) => numero(dato.costo_mxn)), 1);
      datos.forEach((dato, indice) => {
        const filaY = y + 43 + indice * alturaFila;
        const etiqueta = campo === 'causa' ? dato.causa : dato.activo;
        const valor = numero(dato.costo_mxn);
        const barraX = X + 180;
        const barraAncho = ancho - 286;
        pdf.fillColor('#354253').font('Helvetica').fontSize(8.5).text(etiquetaCorta(etiqueta), X + 14, filaY + 2, { width: 156 });
        pdf.roundedRect(barraX, filaY + 5, barraAncho, 8, 4).fill('#EDF1F5');
        pdf.roundedRect(barraX, filaY + 5, Math.max(4, barraAncho * (valor / maximo)), 8, 4)
          .fill(typeof color === 'function' ? color(dato) : color);
        pdf.fillColor(C.tinta).font('Helvetica-Bold').fontSize(8.3)
          .text(formatoMoneda(valor), X + ancho - 91, filaY + 1, { width: 77, align: 'right' });
      });
      return y + alto + 14;
    };

    // ------------------------------------------------ gráficas estáticas ---
    // Las mismas tres vistas del tablero de Dirección, dibujadas como vectores
    // con PDFKit: se imprimen nítidas y no dependen de un navegador (html2canvas
    // o Puppeteer no caben en una función serverless). Paleta del tablero,
    // ajustada a fondo blanco.
    const PALETA = ['#E5484D', '#F0A020', '#1C9BB5', '#168A62', '#7B6BD8', '#8A96A8'];
    const COLOR_LINEA = { 'L-01': '#F0A020', 'L-02': '#1C9BB5' };
    const colorLinea = (linea) => COLOR_LINEA[linea] || C.gris;
    const monedaCorta = (valor) => {
      const v = numero(valor);
      if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
      if (v >= 1e3) return `$${Math.round(v / 1e3)}k`;
      return `$${Math.round(v)}`;
    };
    const tarjetaGrafica = (y, alto, titulo, subtitulo) => {
      pdf.roundedRect(X, y, W - X * 2, alto, 7).fill('#FFFFFF').strokeColor(C.borde).lineWidth(0.6).stroke();
      pdf.fillColor(C.tinta).font('Helvetica-Bold').fontSize(10.5).text(titulo, X + 14, y + 13);
      pdf.fillColor(C.gris).font('Courier').fontSize(6.8).text(subtitulo, X + 14, y + 27);
    };

    /** Dona de concentración por causa: 5 causas principales + «Otras». */
    const graficaDona = (titulo, filas, y) => {
      const alto = 196;
      if (y + alto > H - 55) { nuevaPagina(); y = 52; }
      tarjetaGrafica(y, alto, titulo, 'PARTICIPACION EN EL COSTO DEL PERIODO');
      const total = filas.reduce((t, f) => t + numero(f.costo_mxn), 0);
      const principales = filas.slice(0, 5).map((f) => ({ etiqueta: f.causa, costo: numero(f.costo_mxn) }));
      const resto = filas.slice(5).reduce((t, f) => t + numero(f.costo_mxn), 0);
      if (resto > 0) principales.push({ etiqueta: 'Otras causas', costo: resto });
      const cx = X + 96, cy = y + 112, rExt = 60, rInt = 36;
      const punto = (r, a) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
      let angulo = -Math.PI / 2;
      principales.forEach((seg, i) => {
        const fraccion = total > 0 ? seg.costo / total : 0;
        if (fraccion <= 0) return;
        const color = PALETA[i % PALETA.length];
        if (fraccion > 0.9999) {
          pdf.circle(cx, cy, rExt).fill(color);
        } else {
          const fin = angulo + fraccion * Math.PI * 2;
          const grande = fraccion > 0.5 ? 1 : 0;
          pdf.path(`M ${punto(rExt, angulo)} A ${rExt} ${rExt} 0 ${grande} 1 ${punto(rExt, fin)} ` +
            `L ${punto(rInt, fin)} A ${rInt} ${rInt} 0 ${grande} 0 ${punto(rInt, angulo)} Z`).fill(color);
          angulo = fin;
        }
      });
      pdf.circle(cx, cy, rInt).fill('#FFFFFF');
      pdf.fillColor(C.tinta).font('Helvetica-Bold').fontSize(15)
        .text(String(filas.length), cx - 30, cy - 12, { width: 60, align: 'center' });
      pdf.fillColor(C.gris).font('Courier').fontSize(6.2).text('CAUSAS', cx - 30, cy + 5, { width: 60, align: 'center' });
      // Leyenda: color, causa, % y monto, alineados dentro de la tarjeta.
      const lx = X + 190, anchoLeyenda = (W - X - 16) - lx;
      principales.forEach((seg, i) => {
        const ly = y + 52 + i * 22;
        pdf.roundedRect(lx, ly + 1, 9, 9, 2).fill(PALETA[i % PALETA.length]);
        pdf.fillColor('#354253').font('Helvetica').fontSize(8.6).text(etiquetaCorta(seg.etiqueta, 34), lx + 16, ly, { width: anchoLeyenda - 150 });
        const pct = total > 0 ? Math.round((seg.costo / total) * 1000) / 10 : 0;
        pdf.fillColor(C.tinta).font('Helvetica-Bold').fontSize(8.4).text(`${pct}%`, lx + anchoLeyenda - 140, ly, { width: 50, align: 'right' });
        pdf.fillColor(C.gris).font('Helvetica').fontSize(8.4).text(formatoMoneda(seg.costo), lx + anchoLeyenda - 86, ly, { width: 86, align: 'right' });
      });
      return y + alto + 14;
    };

    /** Barras agrupadas: pérdida de cada turno, una barra por línea. */
    const graficaTurnoLinea = (titulo, filas, y) => {
      const alto = 206;
      if (y + alto > H - 55) { nuevaPagina(); y = 52; }
      tarjetaGrafica(y, alto, titulo, 'COSTO DE PARO POR TURNO, SEPARADO POR LINEA');
      const turnos = [['T1', '06-14'], ['T2', '14-22'], ['T3', '22-06']];
      const lineas = [...new Set(filas.map((f) => f.linea).filter((l) => l && l !== '—'))].sort();
      const valor = (t, l) => numero(filas.find((f) => f.turno === t && f.linea === l)?.costo_mxn);
      const maximo = Math.max(1, ...turnos.flatMap(([t]) => lineas.map((l) => valor(t, l))));
      const x0 = X + 30, x1 = W - X - 30, base = y + alto - 36, altoMax = 104;
      const anchoGrupo = (x1 - x0) / turnos.length;
      const anchoBarra = Math.min(40, (anchoGrupo - 40) / Math.max(1, lineas.length));
      pdf.strokeColor(C.borde).lineWidth(0.7).moveTo(x0, base).lineTo(x1, base).stroke();
      turnos.forEach(([turno, horario], i) => {
        const bloque = lineas.length * anchoBarra + (lineas.length - 1) * 8;
        const gx = x0 + i * anchoGrupo + (anchoGrupo - bloque) / 2;
        lineas.forEach((linea, j) => {
          const v = valor(turno, linea);
          const h = Math.max(v > 0 ? 3 : 0, (v / maximo) * altoMax);
          const bx = gx + j * (anchoBarra + 8);
          if (h > 0) pdf.roundedRect(bx, base - h, anchoBarra, h, 3).fill(colorLinea(linea));
          pdf.fillColor(C.tinta).font('Helvetica-Bold').fontSize(7.4)
            .text(monedaCorta(v), bx - 8, base - h - 11, { width: anchoBarra + 16, align: 'center' });
        });
        pdf.fillColor(C.tinta).font('Helvetica-Bold').fontSize(8.4)
          .text(turno, x0 + i * anchoGrupo, base + 7, { width: anchoGrupo, align: 'center' });
        pdf.fillColor(C.gris).font('Courier').fontSize(6.6)
          .text(horario, x0 + i * anchoGrupo, base + 18, { width: anchoGrupo, align: 'center' });
      });
      // Leyenda de líneas en la cabecera de la tarjeta, dentro de la guía.
      lineas.forEach((linea, j) => {
        const lx = DERECHA - 150 + j * 76;
        pdf.roundedRect(lx, y + 15, 9, 9, 2).fill(colorLinea(linea));
        pdf.fillColor('#354253').font('Helvetica').fontSize(8).text(linea, lx + 13, y + 15, { width: 60 });
      });
      return y + alto + 14;
    };

    encabezado();
    let y = 164;
    y = tituloSeccion('Pulso del periodo', y, 'DATOS REGISTRADOS');
    const anchoTarjeta = (W - X * 2 - 30) / 4;
    tarjeta(X, y, anchoTarjeta, 'EVENTOS', textoSeguro(resumen.eventos), C.tinta, 'incidencias registradas');
    tarjeta(X + anchoTarjeta + 10, y, anchoTarjeta, 'TIEMPO DETENIDO', `${textoSeguro(resumen.minutos_paro)} min`, C.cyan, 'paro acumulado');
    tarjeta(X + (anchoTarjeta + 10) * 2, y, anchoTarjeta, 'COSTO ACUMULADO', formatoMoneda(resumen.costo_total_mxn), C.rojo, 'impacto estimado');
    tarjeta(X + (anchoTarjeta + 10) * 3, y, anchoTarjeta, 'MTTR', `${textoSeguro(resumen.mttr_minutos)} min`, C.ambarOscuro, 'por intervención');
    y += 86;
    // Etiqueta con el modelo que REALMENTE generó este análisis (fila de
    // planta_analisis_ia o `uso.modelo`), nunca un nombre fijo.
    const nombreModelo = textoSeguro(modelo || analisis?.uso?.modelo || analisis?.uso?.proveedor || 'IA')
      .replace(/-/g, ' ').toUpperCase();
    const nivel = textoSeguro(analisis?.uso?.nivel_razonamiento || '').toUpperCase();
    y = tituloSeccion('Lectura ejecutiva', y, nivel ? `${nombreModelo}  /  RAZONAMIENTO ${nivel}` : nombreModelo);
    y = bloqueTexto('Qué requiere atención', textoSeguro(analisis?.resumen || 'No fue posible generar el análisis de IA para este reporte.'), y, C.cyan, 'SINTESIS EJECUTIVA');
    y = bloqueLista('Hallazgos que explican el impacto', lista(analisis?.hallazgos), y, C.ambarOscuro, 'No se recibieron hallazgos para este periodo.');
    const criticas = lista(analisis?.acciones_criticas);
    if (criticas.length) y = bloqueLista('Decisión inmediata', criticas, y, C.rojo, '');
    y = bloqueLista('Decisiones recomendadas', lista(analisis?.recomendaciones), y, C.ambarOscuro, 'No se recibieron recomendaciones para este periodo.');
    // Series completas cuando el análisis las trae; los reportes anteriores
    // solo guardaban las 5 principales y se usan tal cual.
    const serie = (valor) => (Array.isArray(valor) ? valor : []);
    const causas = serie(resumen.por_causa).length ? serie(resumen.por_causa) : serie(resumen.causas_principales);
    const activos = (serie(resumen.por_activo).length ? serie(resumen.por_activo) : serie(resumen.activos_principales)).slice(0, 8);
    const turnosLinea = serie(resumen.por_turno_linea);
    if (numero(resumen.eventos) > 0 && (causas.length || activos.length)) {
      // Página de gráficas: las mismas tres vistas del tablero de Dirección.
      nuevaPagina();
      y = 52;
      y = tituloSeccion('Gráficas del periodo', y, 'MISMAS VISTAS QUE DIRECCION');
      if (causas.length) y = graficaDona('Concentración de pérdida por causa raíz', causas, y);
      if (activos.length) {
        y = graficaBarras('Impacto acumulado por activo', activos, y,
          (dato) => colorLinea(dato.linea), 'activo', 'COSTO ACUMULADO · COLOR POR LINEA');
      }
      if (turnosLinea.length) y = graficaTurnoLinea('Pérdida por turno y línea', turnosLinea, y);
      const dominante = causas[0] || activos[0];
      if (dominante) {
        const porcentaje = numero(resumen.costo_total_mxn) > 0
          ? Math.round((numero(dominante.costo_mxn) / numero(resumen.costo_total_mxn)) * 100)
          : 0;
        y = bloqueTexto(
          'Lectura de concentración',
          `${etiquetaCorta(dominante.causa || dominante.activo, 58)} representa aproximadamente ${porcentaje}% del costo registrado en el periodo. Esta señal se muestra como concentración, no como una predicción por sí sola.`,
          y, C.ambarOscuro, 'EVIDENCIA CUANTITATIVA',
        );
      }
    }
    const consideraciones = lista(analisis?.consideraciones);
    if (consideraciones.length) y = bloqueLista('Consideraciones antes de ejecutar', consideraciones, y, C.verde, '');
    if (y + 44 > H - 55) { nuevaPagina(); y = 44; }
    pdf.fillColor(C.gris).font('Helvetica').fontSize(7.8)
      .text(textoSeguro(analisis?.advertencia || 'Este reporte es un apoyo analítico; las decisiones requieren validación humana.'), X, y, { width: W - X * 2, lineGap: 2 });
    pie(pagina);
    pdf.end();
  });
}

const CACHE_REPORTE_MS = 5 * 60 * 1000;

/**
 * Evita el doble gasto de "Generar reporte" + "Enviar por WhatsApp" sobre el
 * mismo periodo: si ya existe un reporte de (desde, hasta) de hace menos de
 * 5 minutos, se reutiliza en vez de volver a llamar a la IA y a PDFKit.
 */
async function reporteCacheadoReciente(desde, hasta) {
  let consulta = supabase.from('planta_reportes')
    .select('*, planta_analisis_ia(resultado, modelo, entrada)')
    .gte('created_at', new Date(Date.now() - CACHE_REPORTE_MS).toISOString())
    .order('created_at', { ascending: false }).limit(1);
  consulta = desde ? consulta.eq('desde', desde) : consulta.is('desde', null);
  consulta = hasta ? consulta.eq('hasta', hasta) : consulta.is('hasta', null);
  const { data } = await consulta.maybeSingle();
  if (!data) return null;
  const { planta_analisis_ia, ...reporte } = data;
  // Si en Administración se cambió de modelo, el PDF en caché diría el modelo
  // anterior: se genera uno nuevo con el que está activo.
  const modeloActivo = modeloDe(await proveedorPara('finanzas'));
  if (planta_analisis_ia?.modelo && planta_analisis_ia.modelo !== modeloActivo) return null;
  // Y si desde entonces cambió algo en la línea (paros o estado de las
  // máquinas), ese PDF ya no describe la planta: se genera uno nuevo. Los
  // reportes anteriores a la huella no la traen y también se regeneran.
  const firmaGuardada = planta_analisis_ia?.entrada?.firma_datos;
  if (!firmaGuardada || firmaGuardada !== firmaDeDatos(await datosDelPeriodo(desde, hasta))) return null;
  // Se devuelve el MISMO archivo: conserva su `created_at` y la fecha de
  // emisión impresa en el PDF, que es la de su generación original.
  return { ...reporte, analisis: planta_analisis_ia?.resultado ?? null, reutilizado: true };
}

export async function crearReporte({ desde = null, hasta = null } = {}) {
  await exigirIntegracionActiva('pdf');
  const cacheado = await reporteCacheadoReciente(desde, hasta);
  if (cacheado) return cacheado;
  // La exportación pide un análisis dedicado (razonamiento low), separado del
  // que se ve en la tarjeta, con el proveedor activo para Finanzas en el panel.
  let analisis;
  try {
    analisis = await generarAnalisis({ desde, hasta, enfoque: 'reporte_pdf' });
  } catch (error) {
    const respaldo = String(process.env.AI_REPORTE_FALLBACK_PROVIDER || '').toLowerCase();
    if (Number(error?.status) !== 503 || respaldo !== 'anthropic') throw error;
    analisis = await generarAnalisis({ desde, hasta, enfoque: 'reporte_pdf', proveedorForzado: 'anthropic' });
  }
  const contenido = await crearPdf({ resumen: analisis.entrada, analisis: analisis.resultado, modelo: analisis.modelo });
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
  return { ...data, analisis: analisis.resultado, reutilizado: false };
}

export async function urlFirmadaReporte(reporte, segundos = 60 * 60 * 24) {
  const { data, error } = await supabase.storage.from(BUCKET_REPORTES).createSignedUrl(reporte.storage_path, segundos);
  if (error) throw errorPeticion(`No fue posible preparar el PDF: ${error.message}`, 500);
  return data.signedUrl;
}

function telefonoWhatsApp(valor) {
  const digitos = String(valor ?? '').replace(/\D/g, '');
  if (digitos.length < 10 || digitos.length > 15) throw errorPeticion('El destinatario de WhatsApp debe tener formato E.164.');
  return digitos;
}

export function destinatarioPredeterminadoWhatsApp(tipo = 'operaciones') {
  const variable = tipo === 'finanzas'
    ? 'WHATSAPP_FINANZAS_DESTINATARIO'
    : 'WHATSAPP_OPERACIONES_DESTINATARIO';
  return process.env[variable] || configuracion('WHATSAPP_ALERTAS_DESTINATARIOS').split(',')[0];
}

function proveedorWhatsApp() {
  const proveedor = String(process.env.WHATSAPP_PROVIDER || 'twilio').toLowerCase();
  if (!['meta', 'twilio'].includes(proveedor)) throw errorPeticion('Proveedor de WhatsApp no permitido.', 503);
  return proveedor;
}

function detalleErrorMeta(error) {
  if (!error) return 'Error sin detalle de Meta';
  const codigo = [error.code, error.error_subcode].filter((valor) => valor !== undefined && valor !== null).join('/');
  return [error.message || 'Error de Meta', codigo && `código ${codigo}`, error.type].filter(Boolean).join(' · ');
}

function credencialMeta(nombre) {
  let valor = configuracion(nombre).trim();
  if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) valor = valor.slice(1, -1);
  return valor.replace(/^Bearer\s+/i, '').trim();
}

// Las plantillas se activan explícitamente después de que Meta las apruebe.
// Mientras tanto, el sistema usa mensajes normales dentro de la ventana de
// conversación de 24 horas, tanto en local como en producción.
export function usaPlantillasMeta() {
  return proveedorWhatsApp() === 'meta' && String(process.env.WHATSAPP_META_USE_TEMPLATES || '').toLowerCase() === 'true';
}

function textoPlantilla(valor, limite = 1000) {
  return String(valor ?? '').replace(/\r/g, '').trim().slice(0, limite) || '-';
}

export function crearPlantillaMeta(nombreVariable, nombrePredeterminado, parametros = [], opciones = {}) {
  const componentes = [];
  if (opciones.documentoUrl) {
    componentes.push({ type: 'header', parameters: [{ type: 'document', document: { link: opciones.documentoUrl, filename: 'DowntimeOS-reporte-ejecutivo.pdf' } }] });
  }
  if (parametros.length) {
    componentes.push({ type: 'body', parameters: parametros.map((valor) => ({ type: 'text', text: textoPlantilla(valor) })) });
  }
  for (const [indice, payload] of (opciones.respuestas ?? []).entries()) {
    componentes.push({ type: 'button', sub_type: 'quick_reply', index: String(indice), parameters: [{ type: 'payload', payload }] });
  }
  return { nombre: process.env[nombreVariable] || nombrePredeterminado, idioma: process.env.META_WHATSAPP_TEMPLATE_LANGUAGE || 'es_MX', componentes };
}

export async function enviarPorMeta({ destino, contenido, mediaUrl = null, interactivo = null, plantilla = null }) {
  const token = credencialMeta('META_WHATSAPP_ACCESS_TOKEN');
  const phoneId = configuracion('META_WHATSAPP_PHONE_NUMBER_ID').trim();
  const version = process.env.META_WHATSAPP_GRAPH_VERSION || 'v23.0';
  const cuerpo = { messaging_product: 'whatsapp', to: destino };
  if (plantilla) {
    cuerpo.type = 'template';
    cuerpo.template = { name: plantilla.nombre, language: { code: plantilla.idioma }, components: plantilla.componentes };
  } else if (interactivo) {
    cuerpo.type = 'interactive';
    cuerpo.interactive = interactivo;
  } else if (mediaUrl) {
    cuerpo.type = 'document';
    cuerpo.document = { link: mediaUrl, filename: 'DowntimeOS-reporte-ejecutivo.pdf', caption: contenido };
  } else {
    cuerpo.type = 'text';
    cuerpo.text = { body: contenido };
  }
  const respuesta = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo),
  });
  const json = await respuesta.json();
  if (!respuesta.ok) throw new Error(detalleErrorMeta(json?.error) || `HTTP ${respuesta.status}`);
  // La respuesta de Graph solo confirma que Meta aceptó la petición. La
  // entrega real llega después por webhook (statuses) y actualiza el registro.
  return { proveedor_id: json.messages?.[0]?.id ?? null, estado: 'queued', metadatos: json };
}

async function enviarPorTwilio({ destino, contenido, mediaUrl = null }) {
  const sid = configuracion('TWILIO_ACCOUNT_SID');
  const token = configuracion('TWILIO_AUTH_TOKEN');
  const desde = `whatsapp:+${telefonoWhatsApp(configuracion('TWILIO_WHATSAPP_FROM'))}`;
  const para = `whatsapp:+${destino}`;
  const appUrl = configuracion('PUBLIC_APP_URL').replace(/\/$/, '');
  const cuerpo = new URLSearchParams({ From: desde, To: para, Body: contenido });
  if (/^https:\/\//i.test(appUrl)) cuerpo.set('StatusCallback', `${appUrl}/api/whatsapp/alerta`);
  if (mediaUrl) cuerpo.set('MediaUrl', mediaUrl);
  const respuesta = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: cuerpo,
  });
  const json = await respuesta.json();
  if (!respuesta.ok) throw new Error(json.message || `HTTP ${respuesta.status}`);
  return { proveedor_id: json.sid, estado: json.status || 'queued', metadatos: json };
}

export async function enviarWhatsApp({ destinatario, contenido, reporteId = null, eventoFolio = null, interactivo = null, plantilla = null, destinatarioTipo = null }) {
  await exigirIntegracionActiva('whatsapp');
  const proveedor = proveedorWhatsApp();
  const tipo = destinatarioTipo || (reporteId ? 'finanzas' : 'operaciones');
  const destino = telefonoWhatsApp(destinatario || destinatarioPredeterminadoWhatsApp(tipo));
  let mediaUrl = null;
  if (reporteId) {
    const { data: reporte, error } = await supabase.from('planta_reportes').select('*').eq('id', reporteId).maybeSingle();
    if (error || !reporte) throw errorPeticion('El reporte solicitado no existe.', 404);
    mediaUrl = await urlFirmadaReporte(reporte);
  }
  if (proveedor === 'meta' && reporteId && !plantilla && usaPlantillasMeta()) {
    plantilla = crearPlantillaMeta('META_WHATSAPP_TEMPLATE_REPORTE', 'downtimeos_reporte_ejecutivo', [contenido], { documentoUrl: mediaUrl });
  }
  if (proveedor === 'meta' && !plantilla && usaPlantillasMeta()) {
    throw errorPeticion('Esta notificación requiere una plantilla de WhatsApp aprobada.', 422);
  }
  const { data: registro, error: errorRegistro } = await supabase.from('planta_mensajes').insert({
    destinatario: destino, contenido, evento_folio: eventoFolio, reporte_id: reporteId,
  }).select().single();
  if (errorRegistro) throw errorPeticion(`No fue posible registrar el mensaje: ${errorRegistro.message}`, 500);
  try {
    const resultado = proveedor === 'meta'
      ? await enviarPorMeta({ destino, contenido, mediaUrl, interactivo, plantilla })
      : await enviarPorTwilio({ destino, contenido, mediaUrl });
    const { data, error } = await supabase.from('planta_mensajes').update(resultado).eq('id', registro.id).select().single();
    if (error) throw error;
    return data;
  } catch (causa) {
    await supabase.from('planta_mensajes').update({ estado: 'failed', error: String(causa.message || causa) }).eq('id', registro.id);
    throw errorPeticion(`No fue posible enviar WhatsApp: ${causa.message || causa}`, 502);
  }
}

export async function enviarSolicitudAprobacion(solicitud, destinatario = null) {
  const { data: activo } = await supabase.from('planta_activos').select('id, nombre, linea_id, cuello_botella').eq('id', solicitud.activo_id).maybeSingle();
  const { data: causa } = await supabase.from('planta_causas').select('etiqueta').eq('id', solicitud.causa_id).maybeSingle();
  const { data: tarifa } = await supabase.rpc('planta_tarifa_aplicable', { p_activo: solicitud.activo_id });
  const costoMinuto = Math.round((numero(tarifa) / 60) * 100) / 100;
  const contenido = [
    '*VALIDACIÓN DE PARO REQUERIDA*',
    '_Operaciones necesita confirmar este reporte._',
    '',
    `*Activo*  ${solicitud.activo_id} · ${activo?.nombre || 'Planta'}`,
    `*Línea*  ${activo?.linea_id || '-'}`,
    `*Causa reportada*  ${causa?.etiqueta || 'Sin clasificar'}`,
    `*Impacto estimado*  $${costoMinuto} MXN/min`,
    '',
    `_${solicitud.folio}_`,
  ].join('\n');
  const plantilla = usaPlantillasMeta()
    ? crearPlantillaMeta('META_WHATSAPP_TEMPLATE_APROBACION', 'downtimeos_validacion_paro', [
      `${solicitud.activo_id} · ${activo?.nombre || 'Planta'}`, activo?.linea_id || '-',
      causa?.etiqueta || 'Sin clasificar', `$${costoMinuto} MXN/min`, solicitud.folio,
    ], { respuestas: [`dtos:aprobar:${solicitud.folio}`, `dtos:rechazar:${solicitud.folio}`] })
    : null;
  const interactivo = !plantilla ? {
    type: 'button',
    body: { text: contenido },
    action: {
      buttons: [
        { type: 'reply', reply: { id: `dtos:aprobar:${solicitud.folio}`, title: 'Aprobar' } },
        { type: 'reply', reply: { id: `dtos:rechazar:${solicitud.folio}`, title: 'Rechazar' } },
      ],
    },
  } : null;
  return enviarWhatsApp({ destinatario, contenido, plantilla, interactivo });
}

export async function alertaDeActivo({ activoId, destinatario = null }) {
  const { data: estado, error } = await supabase.from('planta_estados').select('*, planta_activos!inner(id, nombre, linea_id, cuello_botella), planta_causas(etiqueta)').eq('activo_id', activoId).maybeSingle();
  if (error || !estado) throw errorPeticion(`No existe estado para el activo ${activoId}.`, 404);
  if (estado.estado !== 'STOP') throw errorPeticion(`El activo ${activoId} no está detenido.`);
  const minutos = Math.max(0, Math.round((Date.now() - new Date(estado.desde).getTime()) / 60000));
  const activo = estado.planta_activos;
  const texto = [
    '*PARO NO PROGRAMADO*',
    '_Atención de brigada requerida._',
    '',
    `*Activo*  ${activo.id} · ${activo.nombre}`,
    `*Línea*  ${activo.linea_id}`,
    `*Tiempo detenido*  ${minutos} min`,
    `*Causa reportada*  ${estado.planta_causas?.etiqueta || 'Sin clasificar'}`,
    activo.cuello_botella ? '' : null,
    activo.cuello_botella ? '*PRIORIDAD 1 · Cuello de botella*' : null,
    '',
    '_Registra la atención al iniciar el trabajo._',
  ].filter(function (linea) { return linea !== null; }).join('\n');
  const plantilla = usaPlantillasMeta()
    ? crearPlantillaMeta('META_WHATSAPP_TEMPLATE_ALERTA_ACTIVO', 'downtimeos_alerta_activo', [
      `${activo.id} · ${activo.nombre}`, activo.linea_id, `${minutos} min`,
      estado.planta_causas?.etiqueta || 'Sin clasificar', activo.cuello_botella ? 'P1 · Cuello de botella' : 'P2 · Paro activo',
    ])
    : null;
  return enviarWhatsApp({ destinatario, contenido: texto, plantilla });
}

/**
 * Resumen único para Brigada. No se elige un "ganador": se muestran todos
 * los paros actuales, priorizando primero los cuellos de botella y luego el
 * mayor tiempo detenido para que la cuadrilla pueda organizar su atención.
 */
export async function alertaDeParos({ destinatario = null } = {}) {
  const { data: estados, error } = await supabase
    .from('planta_estados')
    .select('*, planta_activos!inner(id, nombre, linea_id, cuello_botella), planta_causas(etiqueta)')
    .eq('estado', 'STOP');
  if (error) throw errorPeticion(`No fue posible leer los paros activos: ${error.message}`, 500);
  if (!estados?.length) throw errorPeticion('No hay activos detenidos en este momento.', 409);

  const ahora = Date.now();
  const paros = estados.map((estado) => ({
    ...estado,
    minutos: Math.max(0, Math.round((ahora - new Date(estado.desde).getTime()) / 60000)),
  })).sort((a, b) => {
    const prioridadA = a.planta_activos.cuello_botella ? 0 : 1;
    const prioridadB = b.planta_activos.cuello_botella ? 0 : 1;
    return prioridadA - prioridadB || b.minutos - a.minutos || a.planta_activos.id.localeCompare(b.planta_activos.id);
  });

  const cuellos = paros.filter((paro) => paro.planta_activos.cuello_botella).length;
  const detalle = paros.map((paro, indice) => {
    const activo = paro.planta_activos;
    const prioridad = activo.cuello_botella ? 'P1 · CUELLO DE BOTELLA' : 'P2 · Paro activo';
    return [
      `*${indice + 1}. ${activo.id}* · ${prioridad}`,
      `${activo.nombre} · ${activo.linea_id}`,
      `${paro.minutos} min detenido · ${paro.planta_causas?.etiqueta || 'Sin clasificar'}`,
    ].join('\n');
  }).join('\n\n');
  const contenido = [
    '*RESUMEN DE PAROS ACTIVOS · BRIGADA*',
    `_${paros.length} activo${paros.length === 1 ? '' : 's'} detenido${paros.length === 1 ? '' : 's'}${cuellos ? ` · ${cuellos} cuello${cuellos === 1 ? '' : 's'} de botella` : ''}_`,
    '',
    detalle,
    '',
    '_Atender en orden P1 y registrar el inicio de atención._',
  ].join('\n');
  const plantilla = usaPlantillasMeta()
    ? crearPlantillaMeta('META_WHATSAPP_TEMPLATE_PAROS', 'downtimeos_alerta_paros', [
      `${paros.length} paro${paros.length === 1 ? '' : 's'} activo${paros.length === 1 ? '' : 's'}`,
      `${cuellos} cuello${cuellos === 1 ? '' : 's'} de botella`, detalle,
    ])
    : null;
  const mensaje = await enviarWhatsApp({ destinatario, contenido, plantilla });
  return { ...mensaje, paros_enviados: paros.length, cuellos_de_botella: cuellos };
}
