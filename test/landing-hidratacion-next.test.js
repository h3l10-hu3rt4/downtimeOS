import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../public/js/app.js', import.meta.url), 'utf8');
const wrapper = await readFile(new URL('../app/_components/LegacyPageClient.js', import.meta.url), 'utf8');

test('la landing se inicializa aunque React inserte sus scripts después de DOMContentLoaded', () => {
  assert.match(wrapper, /useEffect\(\(\) =>/);
  assert.match(app, /function iniciarLanding\(\)/);
  assert.match(app, /document\.readyState === "loading"[\s\S]*?addEventListener\("DOMContentLoaded", iniciarLanding, \{ once: true \}\)[\s\S]*?else\s*\{\s*iniciarLanding\(\)/);
  assert.match(app, /window\.__downtimeosLandingInicializada/);
});

test('la inicialización inmediata dibuja cálculos, controles, ticker y salud de API', () => {
  const inicio = app.indexOf('function iniciarLanding()');
  const fin = app.indexOf('\n  }', inicio);
  const boot = app.slice(inicio, fin);
  for (const accion of ['iniciarTicker()', 'iniciarCalculadora()', 'iniciarPlanes()', 'iniciarRoles()', 'verificarSalud()', 'refrescarContador()']) {
    assert.ok(boot.includes(accion), `el arranque debe ejecutar ${accion}`);
  }
});
