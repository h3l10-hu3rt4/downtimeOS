/**
 * DowntimeOS · Motor de cálculo de Margen Oculto (Node / ESM).
 * Puerto 1:1 de `server/calculo.py`. Fuente de verdad de la fórmula
 * (PRD Landing v1.0.0, §3 «Lógica de cálculo»).
 *
 *   Minutos_Paro_Dia  = Maquinas × Turnos × Minutos_Paro_Turno
 *   Perdida_Diaria    = (Minutos_Paro_Dia / 60) × Tarifa_Horaria
 *   Perdida_Mensual   = Perdida_Diaria × 25 días operativos
 *   Perdida_Anual     = Perdida_Mensual × 12 meses  (= 300 días hábiles)
 *   Ahorro_Proyectado = Perdida_Anual × 0.20   (reducción estimada de MTTR)
 *
 * NOTA DE IMPLEMENTACIÓN
 * El PRD enuncia el horizonte anual como «300 días hábiles»; aquí se conserva
 * en dos escalones (25 días × 12 meses = 300) porque el esquema de Postgres
 * valida la invariante `perdida_anual = perdida_mensual × 12`.
 *
 * Los minutos de paro se declaran POR TURNO Y POR MÁQUINA: el multiplicador de
 * turnos entró con el PRD de la landing v1.0.0. Un lead capturado antes de ese
 * cambio tiene la misma tarifa y minutos, pero una pérdida anual menor.
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
  // 20% de reducción del MTTR por notificación y despacho automatizados. Es el
  // extremo conservador del rango: DowntimeOS acorta la DETECCIÓN y el DESPACHO,
  // no la reparación física, que depende de la brigada y del refaccionario.
  // Antes convivían un 35% y un 15% sin sustento; se unificó en este factor.
  FACTOR_MITIGACION: 0.20,
  DIAS_HABILES_ANIO: 300,  // 25 × 12: el horizonte tal como lo enuncia el PRD
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

  const minutosFlotaDia = maq * tur * minutos;
  const perdidaDiaria = (minutosFlotaDia / 60) * tarifa;
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
    minutos_paro_flota_dia: redondear(minutosFlotaDia, 2),
    perdida_anual_mxn: redondear(perdidaAnual * factorMxn, 2),
    costo_por_minuto: redondear((tarifa * maq) / 60, 4),
    parametros_modelo: {
      dias_operativos: MODELO.DIAS_OPERATIVOS,
      meses: MODELO.MESES_ANIO,
      factor_mitigacion: MODELO.FACTOR_MITIGACION,
      dias_habiles_anio: MODELO.DIAS_HABILES_ANIO,
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
