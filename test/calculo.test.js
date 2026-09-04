/**
 * Pruebas del motor de cálculo. Sin dependencias: runner nativo de Node.
 *   npm test        (equivale a: node --test test/)
 *
 * Los valores esperados NO están inventados: se generaron ejecutando
 * server/calculo.py y se verificaron uno a uno contra este puerto a JS.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcular, convertirTarifa, MODELO, limitesTarifa } from '../lib/calculo.js';

const casos = [
  {
    nombre: 'valores por defecto del PRD (5 máquinas, 2 turnos, $1200, 25 min/turno)',
    entrada: { maquinas: 5, turnos: 2, tarifa_hora: 1200, minutos_paro_dia: 25, divisa: 'MXN' },
    esperado: {
      minutos_paro_flota_dia: 250,
      perdida_diaria: 5000, perdida_mensual: 125000,
      perdida_anual: 1500000, ahorro_proyectado: 525000,
      recuperable_conservador: 225000, costo_por_minuto: 100,
    },
  },
  {
    nombre: '8 máquinas × 2 turnos × 30 min × $1,500 MXN/hr',
    entrada: { maquinas: 8, turnos: 2, tarifa_hora: 1500, minutos_paro_dia: 30, divisa: 'MXN' },
    esperado: {
      minutos_paro_flota_dia: 480,
      perdida_diaria: 12000, perdida_mensual: 300000,
      perdida_anual: 3600000, ahorro_proyectado: 1260000, horas_operacion_dia: 16,
    },
  },
  {
    nombre: 'tarifa en USD conserva la divisa y normaliza a MXN',
    entrada: { maquinas: 8, turnos: 2, tarifa_hora: 86, minutos_paro_dia: 30, divisa: 'USD' },
    esperado: {
      divisa: 'USD', perdida_anual: 206400, perdida_anual_mxn: 3612000,
    },
  },
  {
    nombre: 'decimales periódicos se redondean a 2 como en Python',
    entrada: { maquinas: 14, turnos: 2, tarifa_hora: 2200, minutos_paro_dia: 58, divisa: 'MXN' },
    esperado: {
      perdida_diaria: 59546.67, perdida_mensual: 1488666.67,
      perdida_anual: 17864000, costo_por_minuto: 513.3333,
    },
  },
];

for (const c of casos) {
  test(c.nombre, () => {
    const r = calcular(c.entrada);
    for (const [campo, valor] of Object.entries(c.esperado)) {
      assert.equal(r[campo], valor, `campo ${campo}`);
    }
  });
}

test('acota todos los inputs a los límites del PRD', () => {
  const r = calcular({ maquinas: 200, turnos: 9, tarifa_hora: 50, minutos_paro_dia: 500, divisa: 'MXN' });
  assert.equal(r.maquinas, 100);
  assert.equal(r.turnos, 3);
  assert.equal(r.tarifa_hora, 100);
  assert.equal(r.minutos_paro_dia, 120);
});

test('el piso de tarifa depende de la divisa', () => {
  assert.equal(calcular({ maquinas: 5, turnos: 2, tarifa_hora: 1, minutos_paro_dia: 25, divisa: 'USD' }).tarifa_hora, 5);
  assert.equal(calcular({ maquinas: 5, turnos: 2, tarifa_hora: 1, minutos_paro_dia: 25, divisa: 'MXN' }).tarifa_hora, 100);
  assert.equal(limitesTarifa('usd').max, 12000);
});

test('entradas no numéricas caen al mínimo en lugar de reventar', () => {
  const r = calcular({ maquinas: 'ocho', turnos: NaN, tarifa_hora: undefined, minutos_paro_dia: null, divisa: 'euros' });
  assert.deepEqual(
    { m: r.maquinas, t: r.turnos, tar: r.tarifa_hora, min: r.minutos_paro_dia, d: r.divisa },
    { m: 1, t: 1, tar: 100, min: 5, d: 'MXN' },
  );
});

test('el ida y vuelta de divisa regresa al valor original (regresión)', () => {
  const usd = convertirTarifa(1500, 'MXN', 'USD');
  assert.equal(usd, 85.71);
  assert.equal(convertirTarifa(usd, 'USD', 'MXN'), 1500);
});

test('las constantes del modelo coinciden con el PRD de la landing', () => {
  assert.equal(MODELO.DIAS_OPERATIVOS, 25);
  assert.equal(MODELO.MESES_ANIO, 12);
  assert.equal(MODELO.DIAS_HABILES_ANIO, 300);          // 25 × 12
  assert.equal(MODELO.FACTOR_MITIGACION, 0.35);
  assert.equal(MODELO.FACTOR_CONSERVADOR, 0.15);
  assert.equal(MODELO.HORAS_POR_TURNO, 8);
});

test('los turnos multiplican el paro: 2 turnos pierden el doble que 1', () => {
  const base = { maquinas: 6, tarifa_hora: 1400, minutos_paro_dia: 20, divisa: 'MXN' };
  const t1 = calcular({ ...base, turnos: 1 });
  const t3 = calcular({ ...base, turnos: 3 });
  assert.equal(t3.perdida_anual, t1.perdida_anual * 3);
  assert.equal(t1.minutos_paro_flota_dia, 120);
});

test('la pérdida anual equivale a 300 días hábiles de paro', () => {
  const r = calcular({ maquinas: 5, turnos: 2, tarifa_hora: 950, minutos_paro_dia: 25, divisa: 'MXN' });
  const horasAnuales = (r.minutos_paro_flota_dia * MODELO.DIAS_HABILES_ANIO) / 60;
  assert.ok(Math.abs(r.perdida_anual - horasAnuales * r.tarifa_hora) <= 1.0);
});

test('anual = mensual × 12 y ahorro = anual × 0.35 (invariantes del esquema SQL)', () => {
  for (const maquinas of [1, 7, 23, 100]) {
    for (const minutos of [5, 37, 120]) {
      const r = calcular({ maquinas, turnos: 2, tarifa_hora: 1750, minutos_paro_dia: minutos, divisa: 'MXN' });
      assert.ok(Math.abs(r.perdida_anual - r.perdida_mensual * 12) <= 1.0);
      assert.ok(Math.abs(r.ahorro_proyectado - r.perdida_anual * 0.35) <= 1.0);
    }
  }
});
