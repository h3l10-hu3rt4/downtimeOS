import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { crearPdf, generarAnalisis, modeloDe } from '../lib/integraciones.js';

const fuente = await readFile(new URL('../lib/integraciones.js', import.meta.url), 'utf8');

test('el PDF usa el proveedor activo para Finanzas, no un Gemini fijo', () => {
  const codigo = generarAnalisis.toString();
  assert.match(codigo, /proveedorPara\(esReportePdf \? 'finanzas' : enfoque\)/);
  assert.doesNotMatch(fuente, /AI_REPORTE_PROVIDER/);
});

test('el nombre del modelo sale de una sola función y viaja con el análisis', () => {
  const anteriores = { g: process.env.GEMINI_MODEL, a: process.env.ANTHROPIC_MODEL };
  process.env.GEMINI_MODEL = 'gemini-prueba';
  process.env.ANTHROPIC_MODEL = 'claude-prueba';
  try {
    assert.equal(modeloDe('gemini'), 'gemini-prueba');
    assert.equal(modeloDe('anthropic'), 'claude-prueba');
  } finally {
    if (anteriores.g === undefined) delete process.env.GEMINI_MODEL; else process.env.GEMINI_MODEL = anteriores.g;
    if (anteriores.a === undefined) delete process.env.ANTHROPIC_MODEL; else process.env.ANTHROPIC_MODEL = anteriores.a;
  }
  assert.match(generarAnalisis.toString(), /proveedor,\s*modelo,\s*nivel_razonamiento/);
});

test('el caché de reportes se descarta si cambió el modelo activo', () => {
  assert.match(fuente, /planta_analisis_ia\(resultado, modelo, entrada\)/);
  assert.match(fuente, /planta_analisis_ia\.modelo !== modeloActivo\) return null/);
});

test('la etiqueta del PDF usa el modelo real, sin nombres fijos', () => {
  assert.match(fuente, /const nombreModelo = textoSeguro\(modelo \|\| analisis\?\.uso\?\.modelo/);
  assert.doesNotMatch(fuente, /\? 'CLAUDE' : 'GEMINI'/);
});

test('ningún texto alineado a la derecha llega al borde de la hoja', () => {
  assert.match(fuente, /const DERECHA = W - X - 36;/);
  // Todas las cajas alineadas a la derecha terminan en la guía interior.
  assert.doesNotMatch(fuente, /W - X - \d+, \d+, \{ width: \d+, align: 'right' \}/);
});

const resumenBase = {
  eventos: 3, minutos_paro: 120, costo_total_mxn: 45000, mttr_minutos: 40,
  causas_principales: [{ causa: 'Espera de material', costo_mxn: 30000 }, { causa: 'Falla eléctrica menor', costo_mxn: 15000 }],
  activos_principales: [{ activo: 'C-01', costo_mxn: 30000 }, { activo: 'E-01', costo_mxn: 15000 }],
};
const analisisBase = { uso: { proveedor: 'anthropic', modelo: 'claude-sonnet-5', nivel_razonamiento: 'low' }, resumen: 'x', advertencia: 'y' };

test('el PDF se genera con gráficas completas (turno × línea incluido)', async () => {
  const pdf = await crearPdf({
    resumen: {
      ...resumenBase,
      por_causa: resumenBase.causas_principales,
      por_activo: [{ activo: 'C-01', linea: 'L-01', costo_mxn: 30000 }, { activo: 'E-01', linea: 'L-02', costo_mxn: 15000 }],
      por_turno_linea: [{ turno: 'T1', linea: 'L-01', costo_mxn: 30000 }, { turno: 'T2', linea: 'L-02', costo_mxn: 15000 }],
    },
    analisis: analisisBase, modelo: 'claude-sonnet-5',
  });
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
  assert.ok(pdf.length > 3000);
});

test('un análisis guardado antes de las series nuevas sigue generando PDF', async () => {
  const pdf = await crearPdf({ resumen: resumenBase, analisis: analisisBase });
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
});
