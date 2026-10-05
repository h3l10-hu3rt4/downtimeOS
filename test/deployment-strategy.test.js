import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('la documentación deja DigitalOcean para después de validar el MVP y descarta Vercel', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');

  assert.match(readme, /## Despliegue posterior al MVP[\s\S]*destino elegido[\s\S]*DigitalOcean/i);
  assert.match(readme, /No se hará despliegue en Vercel/i);
  assert.match(readme, /Para probar ahora, usa la instalación local con Docker/i);
  assert.doesNotMatch(readme, /Vercel → Settings|Límite del plan Hobby de Vercel/i);
});
