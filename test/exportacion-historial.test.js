import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const api = await readFile(new URL('../api/planta/exportacion.js', import.meta.url), 'utf8');
const ui = await readFile(new URL('../public/demo/js/direccion.js', import.meta.url), 'utf8');
const sql = await readFile(new URL('../supabase/migrations/20260930000200_onboarding.sql', import.meta.url), 'utf8');

test('exportación protege rol, planta de sesión, tamaño de página y filtra exportación por planta', () => {
  assert.match(api, /exigirRolProducto\(sesion, \['direccion', 'finanzas'\]\)/);
  assert.match(api, /await exigirExportacion\(sesion\)/);
  assert.match(api, /Number\.parseInt\(req\.query\?\.limite[\s\S]*limite > TAMANO_PAGINA/);
  assert.match(api, /eq\('planta_id', sesion\.perfil\.planta_id\)/);
  assert.match(api, /lte\('created_at', hastaSnapshot\)/);
});

test('el filtro rechaza fechas imposibles y calcula el huso horario local', () => {
  assert.match(api, /fecha\.toISOString\(\)\.slice\(0, 10\) !== valor/);
  assert.match(api, /timeZone: 'America\/Mexico_City'/);
  assert.match(api, /offsetMexico\(desde\)/);
});

test('la exportación usa keyset por created_at y folio, registra auditoría y mantiene un CSV seguro', () => {
  assert.match(api, /accion: 'bitacora_exportada'/);
  assert.match(api, /\.order\('created_at', \{ ascending: true \}\)[\s\S]*\.order\('folio', \{ ascending: true \}\)/);
  assert.match(api, /created_at\.gt\.\$\{cursor\.created_at\},and\(created_at\.eq\.\$\{cursor\.created_at\},folio\.gt\.\$\{cursor\.folio\}\)/);
  assert.match(api, /siguiente_cursor: siguienteCursor/);
  assert.match(api, /\.range\(offset, offset \+ limite - 1\)/, 'offset se conserva solo para compatibilidad de primera página');
  assert.match(api, /lte\('created_at', hastaSnapshot\)/);
  assert.match(api, /eq\('planta_id', sesion\.perfil\.planta_id\)/);
  assert.match(ui, /btnExportarHistorial/);
  assert.match(ui, /resultado\.siguiente_cursor/);
  assert.match(ui, /parametros\.set\("cursor", cursor\)/);
  assert.doesNotMatch(ui, /resultado\.siguiente_offset/);
  assert.doesNotMatch(ui, /filas\.length > 100000/, 'la exportación completa no debe fallar con un umbral arbitrario');
  assert.ok(ui.includes('texto.replace(/"/g, \'""\')'), 'debe escapar comillas dentro de celdas CSV');
  assert.ok(ui.includes('new Blob(["\\uFEFF" + lineas.join("\\r\\n")'), 'debe exportar UTF-8 BOM y saltos CSV');
});

test('la migración habilita la exportación de portabilidad en catálogo para los planes', () => {
  assert.match(sql, /update public\.planes[\s\S]*?exportacion/);
});
