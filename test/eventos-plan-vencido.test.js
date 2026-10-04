import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const fuente = await readFile(new URL('../api/planta/eventos.js', import.meta.url), 'utf8');
const reportes = await readFile(new URL('../api/planta/reportes.js', import.meta.url), 'utf8');
const solicitudes = await readFile(new URL('../api/planta/solicitudes.js', import.meta.url), 'utf8');

test('el plan vigente solo se exige para nuevas capturas, no para corregir o auditar historial', () => {
  assert.match(fuente, /const \{ plan \} = req\.method === 'POST' \? await exigirPlanActivo\(sesion\)/);
  assert.match(fuente, /if \(req\.method === 'POST'\) \{\s*exigirRolProducto\(sesion, \['operaciones', 'operador'\]\)/);
  assert.match(fuente, /if \(req\.method === 'PATCH'\) \{\s*exigirRolProducto\(sesion, \['operaciones'\]\)/);
  assert.match(fuente, /exigirRolProducto\(sesion, \['operaciones'\]\);\s*const resultado = await eliminarEvento/);
});

test('con plan vencido siguen disponibles el cierre del paro y la resolución de solicitudes existentes', () => {
  assert.match(reportes, /req\.method === 'POST' \|\| \(req\.method === 'PATCH' && cuerpo\.accion === 'mantenimiento'\)/);
  assert.match(reportes, /if \(req\.method === 'PATCH' && cuerpo\.accion === 'cerrar'\)[\s\S]*?cerrarParoReportado/);
  assert.match(solicitudes, /if \(req\.method === 'POST'\) await exigirPlanActivo\(sesion\)/);
});
