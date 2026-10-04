import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directorio = path.dirname(fileURLToPath(import.meta.url));

test('las pruebas SQL apuntan a la cadena activa y no a las migraciones históricas', async () => {
  const archivos = (await readdir(directorio)).filter((nombre) => nombre.endsWith('.test.js'));
  const rutaHistorica = ['supabase', 'migraciones'].join('/') + '/';
  const referencias = [];

  for (const archivo of archivos) {
    const fuente = await readFile(path.join(directorio, archivo), 'utf8');
    if (fuente.includes(rutaHistorica)) referencias.push(archivo);
  }

  assert.deepEqual(referencias, [], `Las pruebas no deben leer ${rutaHistorica}: ${referencias.join(', ')}`);
});
