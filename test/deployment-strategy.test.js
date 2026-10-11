import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('la documentación identifica DigitalOcean como destino y descarta Vercel', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');

  assert.match(readme, /## Publicación y pruebas del equipo[\s\S]*destino elegido[\s\S]*DigitalOcean Droplet/i);
  assert.match(readme, /DEPLOY-DIGITALOCEAN\.md/);
  assert.match(readme, /No se debe\s+desplegar ni cambiar el proyecto de Vercel/i);
  assert.match(readme, /Para probar ahora, usa la instalación local con Docker/i);
  assert.doesNotMatch(readme, /Vercel → Settings|Límite del plan Hobby de Vercel/i);
});
