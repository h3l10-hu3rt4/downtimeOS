import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('la documentación identifica Azure como destino pendiente y descarta Vercel', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');

  assert.match(readme, /## Publicación y pruebas del equipo[\s\S]*destino planeado[\s\S]*Azure Container Apps/i);
  assert.match(readme, /suscripción Azure está pendiente de aprobación/i);
  assert.match(readme, /No se debe\s+desplegar ni cambiar el proyecto de Vercel/i);
  assert.match(readme, /DEPLOY-AZURE\.md/);
  assert.match(readme, /Para probar ahora, usa la instalación local con Docker/i);
  assert.doesNotMatch(readme, /Vercel → Settings|Límite del plan Hobby de Vercel/i);
});
