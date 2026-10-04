import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pagina = await readFile(new URL('../app/equipo/page.js', import.meta.url), 'utf8');

const funcion = (nombre, siguiente) => {
  const inicio = pagina.indexOf(`async function ${nombre}(`);
  const fin = pagina.indexOf(`\n  async function ${siguiente}(`, inicio);
  assert.ok(inicio >= 0 && fin > inicio, `debe existir ${nombre}`);
  return pagina.slice(inicio, fin);
};

test('si falla la recarga tras una mutación, conserva acceso y anuncia que el cambio sí se guardó', () => {
  const cargar = pagina.slice(pagina.indexOf('const cargar = useCallback'), pagina.indexOf('\n  async function actualizarLista'));
  const actualizar = funcion('actualizarLista', 'reintentarLista');

  assert.match(cargar, /conservarAcceso = false/);
  assert.match(cargar, /else if \(!conservarAcceso\)\s*\{\s*setAccesoEquipo/);
  assert.match(actualizar, /cargar\(token, plantaId, \{ conservarAcceso: true \}\)/);
  assert.match(actualizar, /setListaDesactualizada\(true\)/);
  assert.match(actualizar, /La lista no se actualizó; el cambio sí se guardó/);
  assert.doesNotMatch(actualizar, /setAccesoEquipo\(['"]error['"]\)/);
});

test('la lista desactualizada tiene una acción explícita para reintentar solo el GET', () => {
  const inicio = pagina.indexOf('async function reintentarLista(');
  const fin = pagina.indexOf('\n\n  useEffect', inicio);
  const reintentar = pagina.slice(inicio, fin);
  assert.match(reintentar, /cargar\(token, plantaId, \{ conservarAcceso: true \}\)/);
  assert.match(reintentar, /Lista de equipo actualizada/);
  assert.match(pagina, /listaDesactualizada \? <div role="alert">[\s\S]*?onClick=\{reintentarLista\}[\s\S]*?Reintentar actualización/);
});

test('el estado de las invitaciones se refresca al volver a la pestaña y periódicamente mientras está visible', () => {
  assert.match(pagina, /const actualizarSiVisible = \(\) => \{\s*if \(document\.visibilityState === 'visible' && !mutacionEnCurso\.current\) \{\s*cargar\(token, plantaId, \{ conservarAcceso: true \}\)\.catch\(\(\) => \{\}\);/);
  assert.match(pagina, /window\.addEventListener\('focus', actualizarSiVisible\)/);
  assert.match(pagina, /document\.addEventListener\('visibilitychange', actualizarSiVisible\)/);
  assert.match(pagina, /window\.setInterval\(actualizarSiVisible, 60_000\)/);
  assert.match(pagina, /El estado se actualiza automáticamente al volver a esta página y mientras permanezca visible/);
});

test('el envío de invitación usa cerrojo síncrono y deshabilita el botón mientras espera', () => {
  const enviar = funcion('enviar', 'actuar');
  assert.match(pagina, /const mutacionEnCurso = useRef\(false\)/);
  assert.match(enviar, /if \(mutacionEnCurso\.current\) return/);
  assert.match(enviar, /mutacionEnCurso\.current = true/);
  assert.match(enviar, /finally\s*\{\s*mutacionEnCurso\.current = false;\s*setProcesando\(false\)/);
  assert.match(pagina, /type="submit" disabled=\{procesando\}/);
});

test('las acciones PATCH y los cambios de rol comparten el bloqueo de doble envío', () => {
  const actuar = funcion('actuar', 'cambiarPermisos');
  const permisos = pagina.slice(pagina.indexOf('async function cambiarPermisos('), pagina.indexOf('\n  return <main'));
  for (const manejador of [actuar, permisos]) {
    assert.match(manejador, /if \(mutacionEnCurso\.current\) return/);
    assert.match(manejador, /mutacionEnCurso\.current = true/);
    assert.match(manejador, /finally\s*\{\s*mutacionEnCurso\.current = false;\s*setProcesando\(false\)/);
    assert.match(manejador, /actualizarLista\(/);
  }
  assert.match(pagina, /disabled=\{procesando\} onClick=\{\(\) => actuar\(i\.id, 'revocar'\)\}/);
  assert.match(pagina, /onSubmit=\{\(e\) => cambiarPermisos\(e, i\.id\)\}/);
});
