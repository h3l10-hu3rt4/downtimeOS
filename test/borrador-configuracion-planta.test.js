import test from 'node:test';
import assert from 'node:assert/strict';
import { borrarBorradorConfiguracion, claveBorradorConfiguracion, guardarBorradorConfiguracion, leerBorradorConfiguracion } from '../lib/borrador-configuracion-planta.js';

const borrador = {
  lineas: [{ id: 'L-01', nombre: 'Ensamble' }],
  activos: [{ id: 'M-01', linea_id: 'L-01', nombre: 'Prensa', tipo: 'MA', etapa: 'Corte' }],
};

function conStorage(t, storage) {
  const anterior = globalThis.window;
  globalThis.window = { localStorage: storage };
  t.after(() => { globalThis.window = anterior; });
}

test('la clave del borrador separa usuarios y plantas y rechaza identidades incompletas', () => {
  assert.equal(claveBorradorConfiguracion('u1', 'p1'), 'downtimeos_borrador_configuracion:u1:p1');
  assert.notEqual(claveBorradorConfiguracion('u1', 'p1'), claveBorradorConfiguracion('u2', 'p1'));
  assert.notEqual(claveBorradorConfiguracion('u1', 'p1'), claveBorradorConfiguracion('u1', 'p2'));
  assert.equal(claveBorradorConfiguracion('', 'p1'), '');
});

test('el borrador se persiste, recupera y elimina del almacenamiento local', (t) => {
  const datos = new Map();
  conStorage(t, {
    getItem: (key) => datos.get(key) ?? null,
    setItem: (key, value) => datos.set(key, value),
    removeItem: (key) => datos.delete(key),
  });
  const clave = claveBorradorConfiguracion('u1', 'p1');
  assert.equal(guardarBorradorConfiguracion(clave, borrador.lineas, borrador.activos), true);
  assert.deepEqual(leerBorradorConfiguracion(clave), { version: 1, ...borrador });
  assert.equal(borrarBorradorConfiguracion(clave), true);
  assert.equal(leerBorradorConfiguracion(clave), null);
});

test('un borrador corrupto, obsoleto o incompleto se ignora', (t) => {
  const datos = new Map([
    ['bad-json', '{'],
    ['bad-shape', JSON.stringify({ version: 1, lineas: [], activos: [] })],
    ['old-version', JSON.stringify({ version: 2, ...borrador })],
  ]);
  conStorage(t, { getItem: (key) => datos.get(key) ?? null });
  for (const clave of datos.keys()) assert.equal(leerBorradorConfiguracion(clave), null);
});

test('conserva borradores incompletos aunque todavía no tengan máquinas', (t) => {
  const datos = new Map();
  conStorage(t, {
    getItem: (key) => datos.get(key) ?? null,
    setItem: (key, value) => datos.set(key, value),
  });
  const clave = claveBorradorConfiguracion('u1', 'p1');
  assert.equal(guardarBorradorConfiguracion(clave, borrador.lineas, []), true);
  assert.deepEqual(leerBorradorConfiguracion(clave), { version: 1, lineas: borrador.lineas, activos: [] });
});

test('un almacenamiento bloqueado no rompe la configuración y reporta fallo al guardar', (t) => {
  conStorage(t, {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); },
  });
  const clave = claveBorradorConfiguracion('u1', 'p1');
  assert.equal(leerBorradorConfiguracion(clave), null);
  assert.equal(guardarBorradorConfiguracion(clave, borrador.lineas, borrador.activos), false);
  assert.equal(borrarBorradorConfiguracion(clave), false);
});
