import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pagina = await readFile(new URL('../app/suscripcion/page.js', import.meta.url), 'utf8');

test('facturación devuelve cada rol a su tablero y no fija Dirección para todos', () => {
  assert.match(pagina, /import \{ destinoTablero \} from '\.\.\/acceso\/return-to\.js'/);
  assert.match(pagina, /setDestinoRetorno\(destinoTablero\(cuenta\.perfil\) \|\| '\/acceso'\)/);
  assert.equal((pagina.match(/href=\{destinoRetorno\}>Volver a la planta/g) || []).length, 2);
  assert.doesNotMatch(pagina, /href="\/direccion">Volver a la planta/);
});
