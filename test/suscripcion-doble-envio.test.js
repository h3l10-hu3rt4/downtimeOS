import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../app/suscripcion/page.js', import.meta.url), 'utf8');
const handler = (name, nextName) => source.slice(
  source.indexOf(`async function ${name}(`),
  source.indexOf(`async function ${nextName}(`),
);

test('solicitar plan o renovación bloquea reentradas y libera el estado al finalizar', () => {
  const code = handler('solicitar', 'cancelar');
  assert.match(code, /if \(mutacionEnCurso\.current\) return/);
  assert.match(code, /mutacionEnCurso\.current = true/);
  assert.match(code, /setSolicitando\(true\)/);
  assert.match(code, /finally\s*\{[\s\S]*mutacionEnCurso\.current = false[\s\S]*setSolicitando\(false\)/);
  assert.match(source, /disabled=\{haySolicitudPendiente \|\| solicitando/);
  assert.match(source, /Enviando renovación…/);
  assert.match(source, /Enviando solicitud…/);
});

test('cancelar suscripción bloquea reentradas, refleja progreso y siempre libera el estado', () => {
  const code = handler('cancelar', 'guardarFiscal');
  assert.match(code, /if \(mutacionEnCurso\.current\) return/);
  assert.match(code, /mutacionEnCurso\.current = true/);
  assert.match(code, /if \(!window\.confirm\(confirmacion\)\)[\s\S]*mutacionEnCurso\.current = false/);
  assert.match(code, /setCancelando\(id\)/);
  assert.match(code, /finally\s*\{[\s\S]*mutacionEnCurso\.current = false[\s\S]*setCancelando\(''\)/);
  assert.match(source, /cancelando === actual\.id \? 'Cancelando…'/);
  assert.match(source, /cancelando === renovacionPendiente\.id \? 'Cancelando…'/);
  assert.match(source, /cancelando === renovacionProgramada\.id \? 'Cancelando…'/);
});

test('guardar datos fiscales bloquea reentradas, muestra progreso y conserva la ruta de error', () => {
  const code = handler('guardarFiscal', 'adjuntarComprobante');
  assert.match(code, /if \(mutacionEnCurso\.current\) return/);
  assert.match(code, /mutacionEnCurso\.current = true/);
  assert.match(code, /setGuardandoFiscal\(true\)/);
  assert.match(code, /finally\s*\{[\s\S]*mutacionEnCurso\.current = false[\s\S]*setGuardandoFiscal\(false\)/);
  assert.match(code, /No pudimos confirmar el guardado por un problema de conexión/);
  assert.match(source, /guardandoFiscal \? 'Guardando datos…' : 'Guardar datos fiscales'/);
  assert.match(source, /disabled=\{guardandoFiscal \|\| solicitando/);
});

test('carga del comprobante comparte el mismo guard de mutaciones y libera ocupación', () => {
  const code = handler('adjuntarComprobante', '');
  assert.match(code, /if \(mutacionEnCurso\.current\)/);
  assert.match(code, /mutacionEnCurso\.current = true/);
  assert.match(code, /setSubiendoPago\(pago\.id\)/);
  assert.match(code, /finally\s*\{[\s\S]*mutacionEnCurso\.current = false[\s\S]*setSubiendoPago\(''\)/);
});
