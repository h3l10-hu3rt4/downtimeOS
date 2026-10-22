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

test('la landing valida la sesión guardada y ofrece acceso directo al tablero del usuario', () => {
  assert.match(app, /localStorage\.getItem\("downtimeos_sesion"\)/);
  assert.match(app, /fetch\("\/api\/cuenta", \{ headers: headers, cache: "no-store" \}\)/);
  assert.match(app, /operaciones: "\/operaciones"/);
  assert.match(app, /operador: "\/operador"/);
  assert.match(app, /window\.location\.pathname === "\/"\)[\s\S]*?window\.location\.replace\(destino\)/);
  assert.match(app, /enlace\.textContent = "Ir a mi planta"/);
  assert.match(app, /actualizarAccesoConSesion\(\)/);
});
