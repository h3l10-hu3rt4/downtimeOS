import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

/**
 * Carga public/demo/js/datos.js (módulo de navegador) en un contexto aislado
 * con un `window` mínimo, para probar la regla de cascada sin navegador.
 */
const fuente = await readFile(new URL('../public/demo/js/datos.js', import.meta.url), 'utf8');
const almacen = {};
const ventana = {
  localStorage: {
    getItem: (k) => (k in almacen ? almacen[k] : null),
    setItem: (k, v) => { almacen[k] = String(v); },
    removeItem: (k) => { delete almacen[k]; },
  },
};
vm.runInNewContext(fuente, { window: ventana, console, Date, Math, JSON });
const D = ventana.DowntimeCO;
// Los objetos creados dentro del contexto aislado son de otro "realm":
// se normalizan a objetos locales antes de compararlos a fondo.
const local = (valor) => JSON.parse(JSON.stringify(valor));

const RUN = { estado: 'RUN' };
const STOP = { estado: 'STOP' };
/** Estados: todo operando salvo los activos indicados. */
const conParos = (...ids) => Object.fromEntries(D.ACTIVOS.map((a) => [a.id, ids.includes(a.id) ? STOP : RUN]));
const tonos = (linea, estados) => {
  const { activos } = D.cascadaDeLinea(linea, estados);
  return Object.fromEntries(Object.entries(activos).map(([id, n]) => [id, n.tono]));
};

test('las etapas salen del catálogo en orden de flujo', () => {
  assert.deepEqual(local(D.etapasDeLinea('L-01').map((e) => e.map((a) => a.id))),
    [['M-01', 'M-02'], ['C-01'], ['H-01', 'H-02', 'H-03'], ['P-01', 'P-02']]);
  assert.deepEqual(local(D.etapasDeLinea('L-02').map((e) => e.map((a) => a.id))),
    [['E-01', 'E-02'], ['R-01'], ['K-01']]);
});

test('todo operando: todo verde y produciendo', () => {
  const { activos, etapaCortada } = D.cascadaDeLinea('L-01', conParos());
  assert.equal(etapaCortada, null);
  assert.ok(Object.values(activos).every((n) => n.tono === 'run' && n.produce));
});

test('paro de un nodo único (C-01): rojo y todo lo de abajo en rojo sin flujo', () => {
  const t = tonos('L-01', conParos('C-01'));
  assert.equal(t['M-01'], 'run');
  assert.equal(t['M-02'], 'run');
  assert.equal(t['C-01'], 'cuello');
  for (const id of ['H-01', 'H-02', 'H-03', 'P-01', 'P-02']) assert.equal(t[id], 'cuello', id);
  const { activos, etapaCortada } = D.cascadaDeLinea('L-01', conParos('C-01'));
  assert.equal(etapaCortada, 'Corte');
  assert.equal(activos['H-02'].produce, false);
  assert.equal(activos['H-02'].sinFlujo, true);
  assert.equal(activos['M-01'].produce, true);
});

test('paro parcial en paralelo: caídas en amarillo, el resto sigue verde y fluyendo', () => {
  const { activos, etapaCortada } = D.cascadaDeLinea('L-01', conParos('H-01', 'H-02'));
  assert.equal(etapaCortada, null);
  assert.equal(activos['H-01'].tono, 'paro');
  assert.equal(activos['H-02'].tono, 'paro');
  assert.equal(activos['H-03'].tono, 'run');
  assert.equal(activos['H-03'].produce, true);
  assert.equal(activos['H-01'].produce, false);
  assert.equal(activos['P-01'].tono, 'run');
  assert.equal(activos['P-02'].tono, 'run');
});

test('paro total en paralelo (las tres H): cuello de botella rojo y P-01/P-02 en rojo', () => {
  const t = tonos('L-01', conParos('H-01', 'H-02', 'H-03'));
  for (const id of ['H-01', 'H-02', 'H-03', 'P-01', 'P-02']) assert.equal(t[id], 'cuello', id);
  assert.equal(t['C-01'], 'run');
});

test('paro total en paralelo en L-02 (E-01 y E-02): R-01 y K-01 en rojo', () => {
  const { activos, etapaCortada } = D.cascadaDeLinea('L-02', conParos('E-01', 'E-02'));
  assert.equal(etapaCortada, 'Ensamble');
  for (const id of ['E-01', 'E-02', 'R-01', 'K-01']) assert.equal(activos[id].tono, 'cuello', id);
  assert.ok(Object.values(activos).every((n) => !n.produce));
});

test('una sola E caída en L-02 no corta la línea', () => {
  const t = tonos('L-02', conParos('E-02'));
  assert.deepEqual(t, { 'E-01': 'run', 'E-02': 'paro', 'R-01': 'run', 'K-01': 'run' });
});
