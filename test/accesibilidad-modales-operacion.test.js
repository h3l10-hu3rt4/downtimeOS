import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const panel = await readFile(new URL('../public/demo/js/operaciones.js', import.meta.url), 'utf8');
const retroactivo = await readFile(new URL('../public/demo/js/retroactivo.js', import.meta.url), 'utf8');

test('el panel operativo contiene el foco y lo devuelve al botón que abrió el diálogo', () => {
  assert.match(panel, /elementoAbridor = document\.activeElement/);
  assert.match(panel, /\$\("#adminActivo"\)\.focus\(\)/);
  assert.match(panel, /e\.shiftKey && \(document\.activeElement === primero \|\| !modal\.contains\(document\.activeElement\)\)/);
  assert.match(panel, /document\.activeElement === ultimo \|\| !modal\.contains\(document\.activeElement\)/);
  assert.match(panel, /elementoAbridor\.focus\(\)/);
});

test('el registro retroactivo contiene el foco, soporta Escape y restaura el foco al cerrar', () => {
  assert.match(retroactivo, /elementoAbridor = document\.activeElement/);
  assert.match(retroactivo, /setTimeout\(function \(\) \{ \$\("#retroInicio"\)\.focus\(\); \}, 60\)/);
  assert.match(retroactivo, /e\.key === "Escape"\) \{ cerrar\(\); return; \}/);
  assert.match(retroactivo, /elementoAbridor\.focus\(\)/);
  assert.match(retroactivo, /esModalSuperior\(\)/);
});
