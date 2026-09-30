/**
 * DowntimeOS · Acceso a datos sobre Supabase.
 * Equivalente de `server/store.py` en la arquitectura migrada.
 *
 * Lo que antes resolvía el archivo JSON, ahora lo resuelve Postgres:
 *   · escritura atómica y lock        → transacción de INSERT
 *   · `_siguiente_id()`               → DEFAULT con secuencia (columna `folio`)
 *   · `created_at`                    → DEFAULT now()
 *   · `estadisticas()`                → vista `leads_stats`
 *
 * Este módulo es el ÚNICO que habla con la base: los handlers de /api no
 * conocen Supabase, igual que main.py no abría archivos.
 */
import { supabase } from './supabase.js';

/** Columnas que la API expone. `dominio_email` y `updated_at` son internas. */
const COLUMNAS = `
  id, folio, nombre, puesto, empresa, sector, email, telefono, ciudad,
  parque_industrial, maquinas, turnos, horas_operacion_dia, tarifa_hora,
  minutos_paro_dia, divisa, perdida_diaria, perdida_mensual, perdida_anual,
  ahorro_proyectado, perdida_anual_mxn, costo_por_minuto, origen, estatus,
  utm, notas, created_at
`;

const CAMPOS_NUMERICOS = [
  'maquinas', 'turnos', 'horas_operacion_dia', 'tarifa_hora', 'minutos_paro_dia',
  'perdida_diaria', 'perdida_mensual', 'perdida_anual', 'ahorro_proyectado',
  'perdida_anual_mxn', 'costo_por_minuto',
];

/**
 * Traduce una fila de Postgres al contrato JSON que ya consume public/js/app.js.
 *
 * Dos ajustes:
 *  1. `folio` se expone como `id` (el frontend imprime "Folio LEAD-2026-0031").
 *     El uuid real viaja aparte por si se necesita para referencias.
 *  2. PostgREST puede serializar `numeric` como cadena; se fuerza a Number para
 *     que `Intl.NumberFormat` en el cliente no reciba texto.
 */
export function aLeadPublico(fila) {
  if (!fila) return null;
  const { id: uuid, folio, ...resto } = fila;
  const lead = { id: folio, uuid, ...resto };
  for (const campo of CAMPOS_NUMERICOS) {
    if (lead[campo] !== undefined && lead[campo] !== null) lead[campo] = Number(lead[campo]);
  }
  return lead;
}

function fallar(error, contexto) {
  const e = new Error(`${contexto}: ${error.message}`);
  e.status = 500;
  e.causa = error;
  throw e;
}

/**
 * Lista leads con los mismos filtros que el prototipo local.
 * @param {{estatus?: string, limite?: number|string, desde?: number}} opciones
 */
export async function listarLeads({ estatus, limite, desde = 0 } = {}) {
  let consulta = supabase
    .from('leads')
    .select(COLUMNAS, { count: 'exact' })
    .order('created_at', { ascending: false });

  if (estatus) consulta = consulta.eq('estatus', String(estatus).toUpperCase());

  const tope = Number(limite);
  if (Number.isFinite(tope) && tope > 0) {
    consulta = consulta.range(desde, desde + Math.min(tope, 500) - 1);
  } else {
    consulta = consulta.range(desde, desde + 199); // techo defensivo: 200 filas
  }

  const { data, error, count } = await consulta;
  if (error) fallar(error, 'No fue posible leer los leads');

  return { leads: data.map(aLeadPublico), total: count ?? data.length };
}

/**
 * Inserta un lead ya validado y con los montos recalculados en el servidor.
 * `folio`, `id`, `created_at` y `horas_operacion_dia` los pone Postgres.
 */
export async function crearLead(registro) {
  // horas_operacion_dia es GENERATED ALWAYS: incluirla provoca error 428C9.
  const { horas_operacion_dia, ...insertable } = registro;

  const { data, error } = await supabase
    .from('leads')
    .insert(insertable)
    .select(COLUMNAS)
    .single();

  if (error) {
    // 23514 = violación de CHECK; 23505 = folio/único duplicado.
    if (error.code === '23514') {
      const e = new Error('Los datos violan una restricción de la base.');
      e.status = 400;
      e.errores = { _: error.message };
      throw e;
    }
    fallar(error, 'No fue posible guardar el lead');
  }
  return aLeadPublico(data);
}

/** Agregados desde la vista `leads_stats`. Misma forma que store.estadisticas(). */
export async function obtenerStats() {
  const { data, error } = await supabase.from('leads_stats').select('*').single();
  if (error) fallar(error, 'No fue posible calcular las estadísticas');

  return {
    total: Number(data.total),
    por_estatus: data.por_estatus ?? {},
    perdida_anual_agregada_mxn: Number(data.perdida_anual_agregada_mxn),
    perdida_anual_promedio_mxn: Number(data.perdida_anual_promedio_mxn),
    maquinas_totales: Number(data.maquinas_totales),
  };
}

/** Ping barato para /api/health: no trae filas, solo confirma conectividad. */
export async function verificarConexion() {
  const inicio = Date.now();
  const { count, error } = await supabase
    .from('leads')
    .select('id', { count: 'exact', head: true });

  return {
    disponible: !error,
    error: error ? error.message : null,
    total: count ?? null,
    latencia_ms: Date.now() - inicio,
  };
}
