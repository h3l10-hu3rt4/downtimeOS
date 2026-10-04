import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access, readdir } from 'node:fs/promises';
import { apiHandlers } from '../src/server/api-registry.js';

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

async function archivosApi(directorio, prefijo = '') {
  const entradas = await readdir(directorio, { withFileTypes: true });
  const archivos = [];
  for (const entrada of entradas) {
    const relativa = prefijo ? `${prefijo}/${entrada.name}` : entrada.name;
    if (entrada.isDirectory()) {
      archivos.push(...await archivosApi(new URL(`${entrada.name}/`, directorio), relativa));
    } else if (entrada.isFile() && entrada.name.endsWith('.js')) {
      archivos.push(relativa);
    }
  }
  return archivos;
}

test('cada módulo HTTP de api/ tiene una ruta alcanzable desde el catch-all de Next', async () => {
  const raizApi = new URL('../api/', import.meta.url);
  const modulos = await archivosApi(raizApi);

  for (const modulo of modulos) {
    const clave = modulo
      .replace(/\\/g, '/')
      .replace(/\/index\.js$/, '')
      .replace(/\.js$/, '');
    assert.ok(Object.hasOwn(apiHandlers, clave), `Falta registrar api/${modulo} como "${clave}" en Next.`);
    await access(new URL(modulo, raizApi));
  }
});
