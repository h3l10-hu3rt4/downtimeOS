import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const fuente = await readFile(new URL('../public/demo/js/operaciones.js', import.meta.url), 'utf8');

test('la bitácora y su paginación usan los mismos eventos del turno que el tablero', () => {
  const bitacora = fuente.match(/function pintarBitacora\(\) \{([\s\S]*?)\n  \}/)?.[1];
  const paginacion = fuente.match(/function iniciarPaginacionBitacora\(\) \{([\s\S]*?)\n  \}/)?.[1];
  assert.ok(bitacora, 'se debe encontrar el render de la bitácora');
  assert.ok(paginacion, 'se debe encontrar la paginación de la bitácora');
  assert.match(bitacora, /var lista = eventosDelTurno\(\);/);
  assert.match(paginacion, /var total = eventosDelTurno\(\)\.length;/);
  assert.doesNotMatch(bitacora, /D\.eventos\(\)/);
  assert.doesNotMatch(paginacion, /D\.eventos\(\)/);
});

test('al cambiar el turno la bitácora vuelve a la primera página', () => {
  assert.match(fuente, /Sesion\.alCambiarTurno\(function \(valor\) \{\s*filtroTurno = valor;\s*paginaBitacora = 0;\s*refrescar\(\);/);
});
