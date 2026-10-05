import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { crearControlCarga } from '../lib/control-carga.js';

function diferida() {
  let resolver;
  const promesa = new Promise((resolve) => { resolver = resolve; });
  return { promesa, resolver };
}

test('deduplica lecturas equivalentes y fuerza revalidación después de mutar', async () => {
  const control = crearControlCarga();
  const primeraRespuesta = diferida();
  let lecturas = 0;
  const primera = control.ejecutar(() => { lecturas += 1; return primeraRespuesta.promesa; });
  const duplicada = control.ejecutar(() => { lecturas += 1; return Promise.resolve('duplicada'); });
  assert.equal(duplicada, primera);
  await Promise.resolve();
  assert.equal(lecturas, 1);

  const revalidada = control.ejecutar(async () => { lecturas += 1; return 'nuevo estado'; }, { forzar: true });
  assert.notEqual(revalidada, primera);
  assert.equal(await revalidada.promesa, 'nuevo estado');
  primeraRespuesta.resolver('estado anterior');
  assert.equal(await primera.promesa, 'estado anterior');
  assert.equal(lecturas, 2);
});

test('respuesta obsoleta no es vigente después de iniciar una consulta forzada', async () => {
  const control = crearControlCarga();
  const anterior = diferida();
  let aplicado = null;
  const primera = control.ejecutar(async (carga) => {
    const resultado = await anterior.promesa;
    if (carga.esVigente()) aplicado = resultado;
  });
  await Promise.resolve();
  const nueva = control.ejecutar(async (carga) => {
    if (carga.esVigente()) aplicado = 'estado posterior a la mutación';
  }, { forzar: true });
  await nueva.promesa;
  anterior.resolver('estado viejo');
  await primera.promesa;
  assert.equal(aplicado, 'estado posterior a la mutación');
});

test('el panel fuerza revalidación tras mutaciones exitosas y ante respuesta ambigua', async () => {
  const panel = await readFile(new URL('../app/administracion/suscripciones/panel.js', import.meta.url), 'utf8');
  assert.match(panel, /controlCarga\.current\.ejecutar\(async \(\{ esVigente \}\)/);
  assert.match(panel, /if \(!esVigente\(\)\) return/);
  assert.equal((panel.match(/cargar\(\{ forzar: true \}\)/g) || []).length, 3);
});
