import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';

const registry = await readFile(new URL('../src/server/api-registry.js', import.meta.url), 'utf8');

const rutasMvp = [
  ['planta/estado-vivo', '../api/planta/estado-vivo.js'],
  ['administracion/suscripciones', '../api/administracion/suscripciones.js'],
  ['planta/configuracion', '../api/planta/configuracion.js'],
  ['planta/equipo', '../api/planta/equipo.js'],
  ['planta/exportacion', '../api/planta/exportacion.js'],
  ['planta/estructura', '../api/planta/estructura.js'],
  ['planta/plantas', '../api/planta/plantas.js'],
  ['planta/suscripcion', '../api/planta/suscripcion.js'],
];

test('el adaptador catch-all registra todas las API nuevas de cuentas y facturación', async () => {
  for (const [ruta, modulo] of rutasMvp) {
    assert.match(registry, new RegExp(`['"]${ruta}['"]\\s*:\\s*\\(\\) => import\\(['"]\\.\\.\\/${modulo.replaceAll('/', '\\/')}['"]\\)`));
    await access(new URL(modulo, import.meta.url));
  }
});
