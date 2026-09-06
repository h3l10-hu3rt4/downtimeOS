/**
 * GET /api/observabilidad/uso
 * Métricas agregadas para el panel interno. Nunca devuelve textos de mensajes,
 * destinatarios, URLs firmadas, prompts ni valores de variables de entorno.
 */
import { supabase } from '../../lib/supabase.js';
import { ruta, json } from '../../lib/http.js';

function entero(valor) { return Number(valor ?? 0) || 0; }

/** Estimación conservadora para registros creados antes de guardar uso real. */
function usoDeFila(fila) {
  const usoReal = fila.resultado?.uso ?? {};
  const totalReal = entero(usoReal.tokens_total);
  if (totalReal > 0) {
    return {
      entrada: entero(usoReal.tokens_entrada), salida: entero(usoReal.tokens_salida),
      pensamiento: entero(usoReal.tokens_pensamiento), total: totalReal, fuente: 'real',
    };
  }
  // Regla usual de aproximación: ~4 caracteres por token. No se devuelve ni
  // guarda el texto; solo se usa su longitud para que el panel dé contexto.
  const entrada = Math.ceil(JSON.stringify(fila.entrada ?? {}).length / 4);
  const salida = Math.ceil(JSON.stringify(fila.resultado ?? {}).length / 4);
  return { entrada, salida, pensamiento: 0, total: entrada + salida, fuente: 'estimado' };
}

function diasRecientes(cantidad = 14) {
  const dias = [];
  for (let indice = cantidad - 1; indice >= 0; indice -= 1) {
    const fecha = new Date();
    fecha.setHours(0, 0, 0, 0);
    fecha.setDate(fecha.getDate() - indice);
    dias.push({ clave: fecha.toISOString().slice(0, 10), etiqueta: new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short' }).format(fecha), ia: 0, tokens: 0, pdf: 0, whatsapp: 0 });
  }
  return dias;
}

function sumarPorDia(filas, campo, dias) {
  const indice = new Map(dias.map((dia) => [dia.clave, dia]));
  for (const fila of filas) {
    const dia = indice.get(String(fila.created_at ?? '').slice(0, 10));
    if (!dia) continue;
    dia[campo] += 1;
    if (campo === 'ia') dia.tokens += entero(fila.resultado?.uso?.tokens_total);
  }
}

function estadoConfiguracion() {
  const requeridas = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'GEMINI_API_KEY', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'];
  const faltantes = requeridas.filter((nombre) => !process.env[nombre]);
  const esProduccion = process.env.VERCEL_ENV === 'production';
  const appUrl = process.env.PUBLIC_APP_URL ?? '';
  const hallazgos = [
    {
      nivel: faltantes.length ? 'alto' : 'ok',
      titulo: faltantes.length ? 'Integraciones incompletas' : 'Secretos solo en servidor',
      detalle: faltantes.length
        ? `Faltan ${faltantes.length} variables requeridas. No se muestran sus nombres ni valores en este panel.`
        : 'Las credenciales requeridas existen y el endpoint no devuelve sus valores.',
    },
    {
      nivel: esProduccion && !/^https:\/\//i.test(appUrl) ? 'alto' : 'ok',
      titulo: 'URL pública para callbacks',
      detalle: esProduccion && !/^https:\/\//i.test(appUrl)
        ? 'En producción PUBLIC_APP_URL debe usar HTTPS para validar callbacks de Twilio.'
        : 'La URL de callbacks es compatible con el entorno actual.',
    },
    {
      nivel: 'alto',
      titulo: 'Acceso público a datos de leads',
      detalle: 'GET /api/leads no tiene autenticación y puede exponer datos de contacto. Antes de producción debe protegerse o eliminarse.',
    },
    {
      nivel: 'medio',
      titulo: 'Panel de uso intencionalmente público',
      detalle: 'Esta ruta no muestra secretos ni datos personales, pero la URL por sí sola no sustituye autenticación.',
    },
  ];
  return { secretos_expuestos_en_respuesta: false, hallazgos };
}

export default ruta(['GET'], async (req, res) => {
  const [analisis, reportes, mensajes] = await Promise.all([
    supabase.from('planta_analisis_ia').select('created_at, modelo, entrada, resultado').order('created_at', { ascending: false }).limit(500),
    supabase.from('planta_reportes').select('created_at, storage_path').order('created_at', { ascending: false }).limit(500),
    supabase.from('planta_mensajes').select('created_at, estado').order('created_at', { ascending: false }).limit(500),
  ]);
  const error = analisis.error || reportes.error || mensajes.error;
  if (error) throw Object.assign(new Error(`No fue posible obtener métricas: ${error.message}`), { status: 500 });

  const filasIa = analisis.data ?? [];
  const tokens = filasIa.reduce((acum, fila) => {
    const uso = usoDeFila(fila);
    acum.entrada += uso.entrada;
    acum.salida += uso.salida;
    acum.pensamiento += uso.pensamiento;
    acum.total += uso.total;
    if (uso.fuente === 'real') acum.registrados += 1;
    else acum.estimados += 1;
    return acum;
  }, { entrada: 0, salida: 0, pensamiento: 0, total: 0, registrados: 0, estimados: 0 });
  const porEstado = (mensajes.data ?? []).reduce((acum, fila) => {
    acum[fila.estado] = (acum[fila.estado] ?? 0) + 1;
    return acum;
  }, {});
  const tendencia = diasRecientes();
  sumarPorDia(filasIa, 'ia', tendencia);
  sumarPorDia(reportes.data ?? [], 'pdf', tendencia);
  sumarPorDia(mensajes.data ?? [], 'whatsapp', tendencia);
  const intentosWhatsApp = (mensajes.data ?? []).length;
  const entregados = entero(porEstado.delivered) + entero(porEstado.read);
  const actividad = [
    ...filasIa.slice(0, 6).map((fila) => ({ tipo: 'ia', estado: 'generado', fecha: fila.created_at, detalle: `Análisis ${fila.modelo}` })),
    ...(reportes.data ?? []).slice(0, 6).map((fila) => ({ tipo: 'pdf', estado: 'generado', fecha: fila.created_at, detalle: 'Reporte ejecutivo almacenado' })),
    ...(mensajes.data ?? []).slice(0, 6).map((fila) => ({ tipo: 'whatsapp', estado: fila.estado, fecha: fila.created_at, detalle: 'Notificación procesada' })),
  ].sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).slice(0, 8);

  return json(res, 200, {
    ok: true,
    generado_en: new Date().toISOString(),
    ia: {
      analisis_generados: filasIa.length,
      ultimo_generado_en: filasIa[0]?.created_at ?? null,
      modelos: [...new Set(filasIa.map((fila) => fila.modelo))],
      tokens,
      solicitudes: filasIa.slice(0, 20).map((fila) => {
        const uso = usoDeFila(fila);
        return {
          fecha: fila.created_at,
          modelo: fila.modelo,
          enfoque: fila.entrada?.enfoque === 'operaciones' ? 'operaciones' : 'finanzas',
          nivel_razonamiento: fila.resultado?.uso?.nivel_razonamiento ?? 'no registrado',
          tokens_entrada: uso.entrada,
          tokens_salida: uso.salida,
          tokens_pensamiento: uso.pensamiento,
          tokens_total: uso.total,
          fuente_tokens: uso.fuente,
        };
      }),
      nota: tokens.estimados
        ? `${tokens.registrados} solicitudes con tokens reales y ${tokens.estimados} estimadas de registros antiguos.`
        : 'Tokens reales reportados por Gemini para cada solicitud.',
    },
    pdf: {
      reportes_generados: (reportes.data ?? []).length,
      ultimo_generado_en: reportes.data?.[0]?.created_at ?? null,
      almacenamiento: 'Supabase Storage privado',
    },
    whatsapp: {
      intentos: intentosWhatsApp,
      por_estado: porEstado,
      tasa_entrega: intentosWhatsApp ? Math.round((entregados / intentosWhatsApp) * 100) : null,
      nota: 'Solo se muestran conteos; nunca destinatarios, contenido ni errores del proveedor.',
    },
    tendencia,
    actividad,
    seguridad: estadoConfiguracion(),
  });
});
