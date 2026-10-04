import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pantalla = await readFile(new URL('../app/estructura/page.js', import.meta.url), 'utf8');
const codigoHelper = pantalla.match(/export async function ejecutarMutacionEstructura\([\s\S]*?\n\}/)?.[0];
assert.ok(codigoHelper, 'la pantalla debe exportar el coordinador de mutación verificable');
const ejecutarMutacionEstructura = new Function(`return (${codigoHelper.replace(/^export async function ejecutarMutacionEstructura/, 'async function ejecutarMutacionEstructura')});`)();

test('POST aceptado permanece exitoso si el GET de recarga falla y deja opción de retry', async () => {
  const eventos = [];
  const respuesta = await ejecutarMutacionEstructura({
    mutar: async () => ({ ok: true }),
    recargar: async () => { throw new Error('GET falló'); },
    alMutar: () => eventos.push('creado'),
    alRecargarError: () => eventos.push('recarga-fallida'),
  });

  assert.deepEqual(eventos, ['creado', 'recarga-fallida']);
  assert.equal(respuesta.resultado.ok, true);
  assert.match(respuesta.recargaError.message, /GET falló/);
  assert.match(pantalla, /No pudimos actualizar la lista/);
  assert.match(pantalla, /onClick=\{\(\) => \{ void cargar\(\); \}\}/);
});

test('PATCH aceptado reporta el archivo conservado aunque falle la recarga', async () => {
  const eventos = [];
  const respuesta = await ejecutarMutacionEstructura({
    mutar: async () => 'archivado',
    recargar: async () => false,
    alMutar: () => eventos.push('Elemento archivado; su historial se conservó.'),
    alRecargarError: () => eventos.push('lista-pendiente'),
  });

  assert.equal(respuesta.resultado, 'archivado');
  assert.match(respuesta.recargaError.message, /mutación se completó/);
  assert.deepEqual(eventos, ['Elemento archivado; su historial se conservó.', 'lista-pendiente']);
  assert.match(pantalla, /Elemento archivado; su historial se conservó\. No pudimos actualizar la lista; puedes reintentar\./);
});

test('error del POST/PATCH no se confunde con éxito ni dispara GET', async () => {
  let recargas = 0;
  await assert.rejects(ejecutarMutacionEstructura({
    mutar: async () => { throw new Error('PATCH rechazado'); },
    recargar: async () => { recargas += 1; },
  }), /PATCH rechazado/);
  assert.equal(recargas, 0);
});

test('archivar deshabilita doble mutación mientras hay una acción pendiente', () => {
  assert.match(pantalla, /const \[archivando, setArchivando\] = useState\(''\)/);
  assert.match(pantalla, /const archivandoLock = useRef\(false\)/);
  assert.match(pantalla, /if \(archivandoLock\.current\) return/);
  assert.match(pantalla, /archivandoLock\.current = true/);
  assert.match(pantalla, /archivandoLock\.current = false/);
  assert.match(pantalla, /disabled=\{Boolean\(archivando\) \|\| guardando\}/);
  assert.match(pantalla, /finally \{ archivandoLock\.current = false; setArchivando\(''\); \}/);
});
