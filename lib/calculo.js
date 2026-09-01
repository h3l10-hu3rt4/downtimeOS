/**
 * DowntimeOS · Motor de cálculo de Margen Oculto (Node / ESM).
 * Puerto 1:1 de `server/calculo.py`. Fuente de verdad de la fórmula (PRD §4.3).
 *
 *   Perdida_Diaria    = Maquinas × (Minutos_Paro / 60) × Tarifa_Horaria
 *   Perdida_Mensual   = Perdida_Diaria × 25 días operativos
 *   Perdida_Anual     = Perdida_Mensual × 12 meses
 *   Ahorro_Proyectado = Perdida_Anual × 0.35   (reducción estimada de MTTR)
 *
 * NOTA DE IMPLEMENTACIÓN
 * El PRD se contradice: el Gherkin de §6 afirma $1,200,000 para 8 máquinas ×
 * 2 turnos × $1,500 MXN/hr × 30 min, pero la fórmula normativa de §4.3 da
 * $1,800,000. Se implementa la fórmula. Para alinearlo al Gherkin habría que
 * ajustar DIAS_OPERATIVOS aquí y en public/js/calculator.js.
 *
 * DIFERENCIA DELIBERADA CON PYTHON
 * `round()` de Python usa redondeo bancario (mitad al par): round(2.675, 2)
 * puede dar 2.67. Aquí se usa medio-arriba, que es la convención contable y la
 * que espera un CFO. En los importes reales la diferencia es de centavos y solo
 * en empates exactos, pero queda documentada por si comparas contra los
 * registros generados por la versión local.
 *
 * Las claves del objeto devuelto son snake_case a propósito: coinciden con las
 * columnas de Postgres y con el contrato que ya consume public/js/app.js.
 */

// --- Constantes del modelo ---------------------------------------------------
export const MODELO = Object.freeze({
  DIAS_OPERATIVOS: 25,     // días productivos por mes
  MESES_ANIO: 12,
  FACTOR_MITIGACION: 0.35, // 35% de reducción de MTTR con DowntimeOS
  TIPO_CAMBIO_USD: 17.5,   // MXN por 1 USD
  HORAS_POR_TURNO: 8,
});

// --- Límites de los inputs (PRD §4.2) ----------------------------------------
export const LIMITES = Object.freeze({
  maquinas:         { min: 1,   max: 100,    default: 5 },
  turnos:           { min: 1,   max: 3,      default: 2 },
  tarifa_hora:      { min: 100, max: 200000, default: 1200 }, // referencia MXN
  minutos_paro_dia: { min: 5,   max: 120,    default: 25 },
});

/**
 * La tarifa se acota SEGÚN LA DIVISA: aplicar un piso pensado en pesos a una
 * tarifa en dólares la deformaría (espejo de public/js/calculator.js y de la
 * restricción `leads_tarifa_segun_divisa` en supabase/schema.sql).
 */
export const LIMITES_TARIFA = Object.freeze({
  MXN: { min: 100, max: 200000 },
  USD: { min: 5,   max: 12000 },
});

export function normalizarDivisa(divisa) {
  return String(divisa ?? '').toUpperCase() === 'USD' ? 'USD' : 'MXN';
}

export function limitesTarifa(divisa) {
  return LIMITES_TARIFA[normalizarDivisa(divisa)];
}

/** Acota a [min, max]. Un valor no numérico cae al mínimo, igual que en Python. */
export function acotar(valor, minimo, maximo) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return minimo;
  return Math.max(minimo, Math.min(maximo, n));
}

/** Redondeo medio-arriba estable frente a artefactos de punto flotante. */
export function redondear(valor, decimales = 2) {
  const f = 10 ** decimales;
  return Math.round((valor + Number.EPSILON) * f) / f;
}

/**
 * Devuelve el bloque financiero completo en la divisa recibida.
 *
 * `tarifa_hora` se interpreta SIEMPRE en la divisa indicada; el resultado
 * incluye además el equivalente anual en MXN para que los leads sean
 * comparables entre divisas.
 *
 * @param {object} entrada
 * @param {number|string} entrada.maquinas
 * @param {number|string} entrada.turnos
 * @param {number|string} entrada.tarifa_hora
 * @param {number|string} entrada.minutos_paro_dia
 * @param {string}        [entrada.divisa='MXN']
 */
export function calcular({ maquinas, turnos, tarifa_hora, minutos_paro_dia, divisa = 'MXN' }) {
  const div = normalizarDivisa(divisa);
  const lt = limitesTarifa(div);

  const maq = Math.trunc(acotar(Math.trunc(Number(maquinas) || 0), LIMITES.maquinas.min, LIMITES.maquinas.max));
  const tur = Math.trunc(acotar(Math.trunc(Number(turnos) || 0), LIMITES.turnos.min, LIMITES.turnos.max));
  const tarifa = acotar(tarifa_hora, lt.min, lt.max);
  const minutos = acotar(minutos_paro_dia, LIMITES.minutos_paro_dia.min, LIMITES.minutos_paro_dia.max);

  const perdidaDiaria = maq * (minutos / 60) * tarifa;
  const perdidaMensual = perdidaDiaria * MODELO.DIAS_OPERATIVOS;
  const perdidaAnual = perdidaMensual * MODELO.MESES_ANIO;
  const ahorro = perdidaAnual * MODELO.FACTOR_MITIGACION;

  const factorMxn = div === 'USD' ? MODELO.TIPO_CAMBIO_USD : 1;

  return {
    maquinas: maq,
    turnos: tur,
    horas_operacion_dia: tur * MODELO.HORAS_POR_TURNO,
    tarifa_hora: redondear(tarifa, 2),
    minutos_paro_dia: redondear(minutos, 2),
    divisa: div,
    perdida_diaria: redondear(perdidaDiaria, 2),
    perdida_mensual: redondear(perdidaMensual, 2),
    perdida_anual: redondear(perdidaAnual, 2),
    ahorro_proyectado: redondear(ahorro, 2),
    perdida_anual_mxn: redondear(perdidaAnual * factorMxn, 2),
    costo_por_minuto: redondear((tarifa * maq) / 60, 4),
    parametros_modelo: {
      dias_operativos: MODELO.DIAS_OPERATIVOS,
      meses: MODELO.MESES_ANIO,
      factor_mitigacion: MODELO.FACTOR_MITIGACION,
      tipo_cambio_usd: MODELO.TIPO_CAMBIO_USD,
    },
  };
}

/** Conversión de tarifa al alternar el switch MXN/USD (RF-04). */
export function convertirTarifa(valor, desde, hacia) {
  const origen = normalizarDivisa(desde);
  const destino = normalizarDivisa(hacia);
  if (origen === destino) return Number(valor);

  const convertido = destino === 'USD'
    ? Number(valor) / MODELO.TIPO_CAMBIO_USD
    : Number(valor) * MODELO.TIPO_CAMBIO_USD;

  // MXN en enteros, USD con 2 decimales: así el ida y vuelta es exacto.
  const redondeado = destino === 'USD' ? redondear(convertido, 2) : Math.round(convertido);
  const lt = limitesTarifa(destino);
  return acotar(redondeado, lt.min, lt.max);
}
