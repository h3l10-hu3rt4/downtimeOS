import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { firmaDeDatos } from '../lib/integraciones.js';

/**
 * El PDF solo se reutiliza si NO cambió nada en la línea: la huella de los
 * datos del periodo debe detectar cualquier cambio y ser estable ante el orden.
 */
const planta = () => ({
  eventos: [
    { folio: 'L01-SR-C01-20260922-0840-R4', minutos: 38, costo_mxn: 12508.33 },
    { folio: 'L02-BP-R01-20260922-1645-R5', minutos: 27, costo_mxn: 2970 },
  ],
  estados: [
    { activo_id: 'C-01', estado: 'RUN', desde: '2026-09-22T15:00:00Z' },
    { activo_id: 'H-02', estado: 'STOP', desde: '2026-09-22T16:10:00Z' },
  ],
});

test('la misma línea da la misma huella aunque cambie el orden de los datos', () => {
  const invertida = planta();
  invertida.eventos.reverse();
  invertida.estados.reverse();
  assert.equal(firmaDeDatos(planta()), firmaDeDatos(invertida));
});

test('un paro nuevo cambia la huella', () => {
  const conParo = planta();
  conParo.eventos.push({ folio: 'L01-HR-H01-20260922-1115-R2', minutos: 24, costo_mxn: 2633.33 });
  assert.notEqual(firmaDeDatos(planta()), firmaDeDatos(conParo));
});

test('corregir la duración de un paro cambia la huella', () => {
  const corregida = planta();
  corregida.eventos[0].minutos = 45;
  assert.notEqual(firmaDeDatos(planta()), firmaDeDatos(corregida));
});

test('una máquina que arranca o se detiene cambia la huella', () => {
  const arranca = planta();
  arranca.estados[1] = { activo_id: 'H-02', estado: 'RUN', desde: '2026-09-22T17:00:00Z' };
  assert.notEqual(firmaDeDatos(planta()), firmaDeDatos(arranca));
});

test('el caché reutiliza el MISMO archivo y exige huella igual', async () => {
  const fuente = await readFile(new URL('../lib/integraciones.js', import.meta.url), 'utf8');
  assert.match(fuente, /planta_analisis_ia\(resultado, modelo, entrada\)/);
  assert.match(fuente, /if \(!firmaGuardada \|\| firmaGuardada !== firmaDeDatos\(await datosDelPeriodo\(desde, hasta\)\)\) return null/);
  // Se devuelve la fila tal cual (su created_at original) marcada como reutilizada.
  assert.match(fuente, /return \{ \.\.\.reporte, analisis: planta_analisis_ia\?\.resultado \?\? null, reutilizado: true \}/);
  // La huella se guarda con el análisis del PDF pero no se manda a la IA.
  assert.match(fuente, /firma_datos: firmaDeDatos\(planta\)/);
  assert.match(fuente, /const \{ firma_datos: _firma, \.\.\.datosIa \} = entrada/);
});

test('el tablero muestra la hora ORIGINAL del reporte reutilizado', async () => {
  const fuente = await readFile(new URL('../public/demo/js/direccion.js', import.meta.url), 'utf8');
  assert.match(fuente, /new Date\(reporte\.created_at\)\.toLocaleString/);
  assert.match(fuente, /se reutilizó el PDF generado el " \+ horaDeReporte\(reporte\)/);
  assert.match(fuente, /_Generado: " \+\s*horaDeReporte\(respuesta\.reporte\)/);
});
