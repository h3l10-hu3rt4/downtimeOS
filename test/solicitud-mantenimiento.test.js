import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const leer = (ruta) => readFile(new URL(`../${ruta}`, import.meta.url), 'utf8');

test('lo que captura Mantenimiento nace aprobado en el servidor', async () => {
  const planta = await leer('lib/planta.js');
  assert.match(planta, /if \(datos\.validada_por\) \{\s*Object\.assign\(fila, \{\s*estado: 'aprobada'/);
  assert.match(planta, /resuelta_por: String\(datos\.validada_por\)/);
});

test('solo el panel de Mantenimiento se salta la bandeja; el operador sigue pendiente', async () => {
  const operaciones = await leer('public/demo/js/operaciones.js');
  const operador = await leer('public/demo/js/operador.js');
  const datos = await leer('public/demo/js/datos.js');
  assert.match(operaciones, /validadaPor: cuenta\.nombre/);
  assert.doesNotMatch(operador, /validadaPor/);
  assert.match(datos, /estado: datos\.validadaPor \? "aprobada" : "pendiente"/);
  assert.match(datos, /validada_por: datos\.validadaPor \|\| null/);
});
