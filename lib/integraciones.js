/** Integraciones externas: Gemini, PDF en Storage y mensajería WhatsApp. */
import { GoogleGenAI } from '@google/genai';
import Anthropic from '@anthropic-ai/sdk';
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
  const esReportePdf = enfoque === 'reporte_pdf';
  // El análisis que acompaña un PDF es una petición propia y deliberadamente
  // predecible: no hereda el proveedor configurable de las tarjetas.
  const proveedor = esReportePdf ? 'gemini' : await proveedorPara(enfoque);
  const modelo = proveedor === 'anthropic'
    ? (process.env.ANTHROPIC_MODEL || 'claude-sonnet-5')
    : (process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite');
  // Cada ruta tiene una profundidad fija y nunca llega desde el navegador:
  // Gemini financiero conserva high; Claude Sonnet se limita a low para
  // mantener la respuesta dentro de la ventana de la función.
  const nivel = esReportePdf || enfoque === 'operaciones' || proveedor === 'anthropic' ? 'low' : 'high';
  const finPeriodo = hasta ? `${hasta}T23:59:59.999Z` : null;
  const planta = await estadoPlanta({ desde, hasta: finPeriodo, limite: 2000 });
  const entrada = enfoque === 'operaciones'
    ? { ...resumenOperativo(planta.eventos, planta), enfoque }
    : { ...resumenDeEventos(planta.eventos), enfoque };
  const instruccion = enfoque === 'operaciones'
    ? 'Eres un analista de confiabilidad para Operaciones y Mantenimiento. Actúa como radar de riesgo operativo: identifica qué se está haciendo mal, desviaciones del proceso, causas y activos que se repiten, y señales tempranas de una posible falla o interrupción próxima. Usa el estado actual y el historial: evalúa la capacidad de cada línea por etapas en serie; una etapa con un solo equipo detenido deja la línea en 0%, mientras equipos paralelos reducen la capacidad proporcionalmente. El resumen debe tener 2 o 3 frases y explicar el patrón dominante y la continuidad de producción. Entrega entre 3 y 5 hallazgos concretos. Clasifica las acciones por prioridad: recomendaciones contiene de 1 a 5 acciones para ejecutar este turno; acciones_seguimiento contiene de 0 a 3 verificaciones o acciones posteriores; y acciones_criticas SOLO contiene de 0 a 3 intervenciones inmediatas cuando exista capacidad actual en 0%, condición insegura, parada activa o riesgo inminente. Si no hay urgencia, acciones_criticas debe ser lista vacía. Las acciones deben ser prácticas, verificables y respaldadas por los datos. Incluye de 1 a 3 consideraciones de campo o datos faltantes. Formula toda predicción como "riesgo" o "indicio", nunca como certeza. No hables de dinero, costos ni desempeño financiero; tampoco inventes datos ausentes.'
    : esReportePdf
      ? 'Eres analista para un reporte ejecutivo industrial. Redacta un análisis financiero breve y accionable basado únicamente en los datos calculados. El PDF ya contiene los indicadores numéricos, por lo que no los repitas literalmente. Explica la implicación del patrón principal, entrega de 2 a 4 hallazgos nuevos y de 2 a 4 recomendaciones financieras priorizadas. Acciones críticas solo si hay una pérdida o concentración extraordinaria; si no, usa una lista vacía. Incluye consideraciones sobre límites de datos. No sugieras acciones técnicas de mantenimiento ni inventes cifras, causas o datos ausentes.'
    : 'Eres analista de dirección y finanzas industriales. Analiza patrones y concentración a lo largo de todos los registros del periodo solicitado; no llames "tendencia" a algo que no pueda sostenerse con esos datos. Enfócate exclusivamente en impacto económico, recurrencia de causas y activos que explican pérdidas. La interfaz ya muestra tarjetas con costo del periodo, número de eventos y mayor concentración: NO repitas esas cifras, el activo principal, la causa principal ni sus porcentajes en el resumen o hallazgos. Usa el resumen para explicar la implicación ejecutiva y los hallazgos para aportar un patrón, riesgo de presupuesto, comparación o relación causal distinta; cada punto debe añadir información nueva. Entrega entre 3 y 5 hallazgos financieros no redundantes. Clasifica las decisiones: recomendaciones contiene de 1 a 5 decisiones financieras a ejecutar este periodo; acciones_seguimiento contiene de 0 a 3 validaciones, métricas o revisiones de seguimiento; y acciones_criticas SOLO contiene de 0 a 3 decisiones inmediatas respaldadas por una concentración o pérdida extraordinaria. Si no hay urgencia, acciones_criticas debe ser lista vacía. No des instrucciones técnicas de piso como implementar mantenimiento, capacitar, ajustar, revisar inventario, aplicar SMED o auditar equipos: esas pertenecen a Operaciones y Mantenimiento. Incluye de 1 a 3 consideraciones sobre supuestos, límites de datos o validaciones necesarias para una decisión económica. No inventes fallas, cifras, causas ni recomendaciones que dependan de datos ausentes.';
  const solicitud = `${instruccion} Devuelve español claro y una advertencia breve de que es apoyo analítico y requiere validación humana.\n\nDATOS CALCULADOS:\n${JSON.stringify(entrada)}`;
  let texto;
  let metadatosUso;
  const inicioProveedor = Date.now();
  if (proveedor === 'gemini') {
    const ai = new GoogleGenAI({ apiKey: configuracion('GEMINI_API_KEY') });
    const respuesta = await ai.models.generateContent({
      model: modelo, contents: solicitud,
      config: {
        responseMimeType: 'application/json', responseJsonSchema: ESQUEMA_ANALISIS, temperature: 0.2,
        thinkingConfig: { thinkingLevel: nivel },
      },
    });
    texto = respuesta.text;
    metadatosUso = respuesta.usageMetadata ?? {};
  } else {
    const ai = new Anthropic({ apiKey: configuracion('ANTHROPIC_API_KEY') });
    const respuesta = await ai.messages.create({
      model: modelo, max_tokens: 4096,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low' },
      system: `${instruccion}\nDevuelve exclusivamente JSON válido, sin Markdown ni texto adicional, con estas llaves: resumen, prioridad, hallazgos, recomendaciones, acciones_criticas, acciones_seguimiento, consideraciones, advertencia. Mantén cada elemento de lista en una oración concisa y cierra siempre el objeto JSON.`,
      messages: [{ role: 'user', content: `DATOS CALCULADOS:\n${JSON.stringify(entrada)}` }],
    });
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

export function crearPdf({ resumen, analisis }) {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ margin: 0, size: 'A4', info: { Title: 'Reporte ejecutivo DowntimeOS' } });
    const bloques = [];
    pdf.on('data', (bloque) => bloques.push(bloque));
    pdf.on('error', reject);
    pdf.on('end', () => resolve(Buffer.concat(bloques)));
    const W = pdf.page.width;
    const H = pdf.page.height;
    const X = 42;
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
      pdf.text(`PAG. ${pagina}`, W - X - 64, H - 29, { width: 64, align: 'right' });
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
      pdf.fillColor(C.ambar).text('OS', X + 50, 10);
      pdf.fillColor('#AEB8C5').font('Courier').fontSize(6.8).text('REPORTE EJECUTIVO - CONTINUACION', W - X - 174, 11, { width: 174, align: 'right' });
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
      pdf.fillColor(C.ambar).font('Courier').fontSize(8).text('REPORTE EJECUTIVO', W - X - 126, 31, { width: 126, align: 'right' });
      pdf.fillColor('#AEB8C5').font('Helvetica').fontSize(8.5).text(`EMITIDO ${new Date().toLocaleString('es-MX')}`, W - X - 160, 53, { width: 160, align: 'right' });
      pdf.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(24).text('Disponibilidad y pérdidas de planta', X, 88);
      pdf.fillColor('#AEB8C5').font('Helvetica').fontSize(9.5).text('Indicadores trazables, análisis de IA y decisiones priorizadas.', X, 116);
      pdf.restore();
    };
    const tituloSeccion = (titulo, y, etiqueta = '') => {
      pdf.fillColor(C.tinta).font('Helvetica-Bold').fontSize(11).text(titulo, X, y);
      if (etiqueta) pdf.fillColor(C.gris).font('Courier').fontSize(7).text(etiqueta, X + 270, y + 3, { width: W - X - 270, align: 'right' });
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
    const graficaBarras = (titulo, datos, y, color, campo) => {
      const ancho = W - X * 2;
      const alturaFila = 35;
      const alto = 42 + Math.max(1, datos.length) * alturaFila;
      pdf.roundedRect(X, y, ancho, alto, 7).fill('#FFFFFF').strokeColor(C.borde).lineWidth(0.6).stroke();
      pdf.fillColor(C.tinta).font('Helvetica-Bold').fontSize(10.5).text(titulo, X + 14, y + 13);
      pdf.fillColor(C.gris).font('Courier').fontSize(6.8).text('IMPACTO ECONOMICO', X + 14, y + 27);
      const maximo = Math.max(...datos.map((dato) => numero(dato.costo_mxn)), 1);
      datos.forEach((dato, indice) => {
        const filaY = y + 43 + indice * alturaFila;
        const etiqueta = campo === 'causa' ? dato.causa : dato.activo;
        const valor = numero(dato.costo_mxn);
        const barraX = X + 180;
        const barraAncho = ancho - 286;
        pdf.fillColor('#354253').font('Helvetica').fontSize(8.5).text(etiquetaCorta(etiqueta), X + 14, filaY + 2, { width: 156 });
        pdf.roundedRect(barraX, filaY + 5, barraAncho, 8, 4).fill('#EDF1F5');
        pdf.roundedRect(barraX, filaY + 5, Math.max(4, barraAncho * (valor / maximo)), 8, 4).fill(color);
        pdf.fillColor(C.tinta).font('Helvetica-Bold').fontSize(8.3)
          .text(formatoMoneda(valor), X + ancho - 91, filaY + 1, { width: 77, align: 'right' });
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
    const proveedor = analisis?.uso?.proveedor === 'anthropic' ? 'CLAUDE' : 'GEMINI';
    const nivel = textoSeguro(analisis?.uso?.nivel_razonamiento || 'low').toUpperCase();
    y = tituloSeccion('Lectura ejecutiva', y, `${proveedor}  /  RAZONAMIENTO ${nivel}`);
    y = bloqueTexto('Qué requiere atención', textoSeguro(analisis?.resumen || 'No fue posible generar el análisis de IA para este reporte.'), y, C.cyan, 'SINTESIS EJECUTIVA');
    y = bloqueLista('Hallazgos que explican el impacto', lista(analisis?.hallazgos), y, C.ambarOscuro, 'No se recibieron hallazgos para este periodo.');
    const criticas = lista(analisis?.acciones_criticas);
    if (criticas.length) y = bloqueLista('Decisión inmediata', criticas, y, C.rojo, '');
    y = bloqueLista('Decisiones recomendadas', lista(analisis?.recomendaciones), y, C.ambarOscuro, 'No se recibieron recomendaciones para este periodo.');
    const causas = Array.isArray(resumen.causas_principales) ? resumen.causas_principales.slice(0, 4) : [];
    const activos = Array.isArray(resumen.activos_principales) ? resumen.activos_principales.slice(0, 4) : [];
    const necesitaMapaImpacto = numero(resumen.eventos) >= 4 && (causas.length >= 2 || activos.length >= 2);
    if (necesitaMapaImpacto) {
      // En reportes con suficiente evidencia, se abre una página cuantitativa.
      // Un incidente aislado conserva un informe compacto y no simula una tendencia.
      nuevaPagina();
      y = 52;
      y = tituloSeccion('Mapa cuantitativo del impacto', y, 'ANALISIS DE RECURRENCIA');
      pdf.fillColor(C.gris).font('Helvetica').fontSize(9.2).text(
        'La gráfica se genera solo cuando hay recurrencia suficiente para comparar causas o activos. Las barras usan el costo acumulado registrado.',
        X, y, { width: W - X * 2, lineGap: 2 },
      );
      y += 41;
      if (causas.length >= 2) y = graficaBarras('Causas que concentran la pérdida', causas, y, C.rojo, 'causa');
      if (activos.length >= 2) y = graficaBarras('Activos con mayor exposición', activos, y, C.cyan, 'activo');
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

export async function crearReporte({ desde = null, hasta = null } = {}) {
  // La exportación pide un análisis dedicado: Gemini siempre en low, separado
  // del análisis visible en la card y de su proveedor configurable.
  const analisis = await generarAnalisis({ desde, hasta, enfoque: 'reporte_pdf' });
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
  return digitos;
}

function proveedorWhatsApp() {
  const proveedor = String(process.env.WHATSAPP_PROVIDER || 'twilio').toLowerCase();
  if (!['meta', 'twilio'].includes(proveedor)) throw errorPeticion('Proveedor de WhatsApp no permitido.', 503);
  return proveedor;
}

async function enviarPorMeta({ destino, contenido, mediaUrl = null, interactivo = null }) {
  const token = configuracion('META_WHATSAPP_ACCESS_TOKEN');
  const phoneId = configuracion('META_WHATSAPP_PHONE_NUMBER_ID');
  const version = process.env.META_WHATSAPP_GRAPH_VERSION || 'v23.0';
  const cuerpo = { messaging_product: 'whatsapp', to: destino };
  if (interactivo) {
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
  if (!respuesta.ok) throw new Error(json?.error?.message || `HTTP ${respuesta.status}`);
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

export async function enviarWhatsApp({ destinatario, contenido, reporteId = null, eventoFolio = null, interactivo = null }) {
  const proveedor = proveedorWhatsApp();
  const destino = telefonoWhatsApp(destinatario || configuracion('WHATSAPP_ALERTAS_DESTINATARIOS').split(',')[0]);
  let mediaUrl = null;
  if (reporteId) {
    const { data: reporte, error } = await supabase.from('planta_reportes').select('*').eq('id', reporteId).maybeSingle();
    if (error || !reporte) throw errorPeticion('El reporte solicitado no existe.', 404);
    mediaUrl = await urlFirmadaReporte(reporte);
  }
  const { data: registro, error: errorRegistro } = await supabase.from('planta_mensajes').insert({
    destinatario: destino, contenido, evento_folio: eventoFolio, reporte_id: reporteId,
  }).select().single();
  if (errorRegistro) throw errorPeticion(`No fue posible registrar el mensaje: ${errorRegistro.message}`, 500);
  try {
    const resultado = proveedor === 'meta'
      ? await enviarPorMeta({ destino, contenido, mediaUrl, interactivo })
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
  const contenido = `PARO REPORTADO\nActivo: ${solicitud.activo_id} - ${activo?.nombre || 'Planta'}\nLinea: ${activo?.linea_id || '-'}\nCausa: ${causa?.etiqueta || 'Sin clasificar'}\nImpacto estimado: $${costoMinuto} MXN/min\nFolio: ${solicitud.folio}`;
  const interactivo = proveedorWhatsApp() === 'meta' ? {
    type: 'button', body: { text: `${contenido}\n\n¿Autorizar atención prioritaria?` },
    action: { buttons: [
      { type: 'reply', reply: { id: `dtos:aprobar:${solicitud.folio}`, title: 'APROBAR' } },
      { type: 'reply', reply: { id: `dtos:rechazar:${solicitud.folio}`, title: 'RECHAZAR' } },
    ] },
  } : null;
  return enviarWhatsApp({ destinatario, contenido, interactivo });
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
