import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../public/administracion/acceso.html', import.meta.url), 'utf8');
const panelHtml = await readFile(new URL('../public/dashboard/apiGastos/index.html', import.meta.url), 'utf8');

test('el acceso administrativo explica que ahí se gestionan suscripciones y pagos', () => {
  assert.match(html, /admin-login__lead[^>]*>[^<]*suscripci[oó]n[^<]*pagos/i);
  assert.match(html, /independiente de las cuentas de cada planta/i);
});

test('el dashboard administrativo usa la marca DowntimeOS vigente', () => {
  assert.match(panelHtml, /class="wordmark">Downtime<span class="hl">OS<\/span><\/span>/);
  assert.doesNotMatch(panelHtml, /class="wordmark">Downtime<span class="hl">CO<\/span><\/span>/);
});
