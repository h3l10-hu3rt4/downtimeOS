import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pagina = await readFile(new URL('../app/suscripcion/page.js', import.meta.url), 'utf8');

test('facturación devuelve cada rol a su tablero y no fija Dirección para todos', () => {
  assert.match(pagina, /const destinoDePerfil = \(perfil\) => \(\{[\s\S]*direccion: '\/direccion',[\s\S]*finanzas: '\/direccion',[\s\S]*operaciones: '\/operaciones',[\s\S]*operador: '\/operador'/);
  assert.match(pagina, /setDestinoRetorno\(destinoDePerfil\(cuenta\.perfil\)\)/);
  assert.equal((pagina.match(/href=\{destinoRetorno\}>Volver a la planta/g) || []).length, 2);
  assert.doesNotMatch(pagina, /href="\/direccion">Volver a la planta/);
});
