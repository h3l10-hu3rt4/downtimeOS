import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Vercel builds this repository as the Next.js MVP, not the legacy static landing', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));

  assert.equal(config.framework, 'nextjs');
  assert.equal(config.outputDirectory, undefined);
  assert.equal(config.buildCommand, undefined);
  assert.equal(config.installCommand, undefined);
});

test('Vercel deployment prerequisites are documented without a production deploy shortcut', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');

  assert.match(readme, /framework \*\*Next\.js\*\*/i);
  assert.match(readme, /variables de entorno de staging/i);
  assert.match(readme, /este repositorio no define un script `npm run deploy`/i);
});
