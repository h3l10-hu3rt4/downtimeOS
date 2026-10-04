import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mapearErrorEstructura } from '../api/planta/estructura.js';

const endpoint = await readFile(new URL('../api/planta/estructura.js', import.meta.url), 'utf8');
const pagina = await readFile(new URL('../app/estructura/page.js', import.meta.url), 'utf8');
const estilos = await readFile(new URL('../public/css/styles.css', import.meta.url), 'utf8');
const migracion = await readFile(new URL('../supabase/migrations/20261004000100_editar_activo.sql', import.meta.url), 'utf8');

test('editar un equipo es una mutación autenticada limitada a Dirección', () => {
  assert.match(endpoint, /exigirRolProducto\(sesion, \['direccion', 'admin'\]\)/);
  assert.match(endpoint, /'actualizar_activo'/);
  assert.match(endpoint, /cuerpo\.activo\?\.id/);
  assert.match(endpoint, /supabase\.rpc\('planta_actualizar_estructura_auditada', \{[\s\S]*?p_planta_id: sesion\.perfil\.planta_id,[\s\S]*?p_usuario_id: sesion\.user\.id,[\s\S]*?p_activo: accion === 'actualizar_activo' \? cuerpo\.activo/);
  assert.doesNotMatch(endpoint, /from\('planta_auditoria'\)\.insert/);
});

test('la API distingue equipo inexistente, conflicto operativo y datos inválidos', () => {
  assert.equal(mapearErrorEstructura({ code: 'P0002', message: 'Equipo archivado.' }).status, 404);
  assert.equal(mapearErrorEstructura({ code: '42501', message: 'Sin permiso.' }).status, 403);
  assert.equal(mapearErrorEstructura({ code: '23514', message: 'Cierra el paro antes de editar.' }).status, 409);
  assert.equal(mapearErrorEstructura({ code: '22023', message: 'Tarifa no válida.' }).status, 400);
  assert.equal(mapearErrorEstructura({ code: '23503', message: 'La línea no corresponde a esta planta.' }).status, 400);
  assert.equal(mapearErrorEstructura({ code: 'XX000' }).status, 503);
});

test('la pantalla ofrece editar y cancelar sin permitir cambiar el código del equipo', () => {
  assert.match(pagina, /function editarActivo\(fila\)/);
  assert.match(pagina, /peticion\('PATCH', \{ accion: 'actualizar_activo', activo: datos \}\)/);
  assert.match(pagina, /readOnly=\{Boolean\(editandoActivo\)\}/);
  assert.match(pagina, /Guardar cambios/);
  assert.match(pagina, /Cancelar<\/button>/);
  assert.match(pagina, /Los paros históricos no cambiaron/);
  assert.match(pagina, /finally \{ setGuardando\(false\); \}/);
});

test('acciones de edición mantienen espacio y apilado responsivo', () => {
  assert.match(estilos, /\.account-list__actions, \.account-form-actions\s*\{[^}]*gap: 8px/);
  assert.match(estilos, /\.account-grid-form > h3, \.account-grid-form > \.account-form-hint, \.account-grid-form > \.account-form-actions\s*\{[^}]*grid-column: 1 \/ -1/);
  assert.match(estilos, /@media \(max-width: 560px\)[\s\S]*?\.account-list__actions, \.account-form-actions\s*\{ width: 100%; \}/);
});

test('la RPC valida pertenencia/estado y no reescribe identidad ni historial', () => {
  assert.match(migracion, /security definer\s+set search_path = pg_catalog, public, pg_temp/);
  assert.match(migracion, /m\.user_id = p_usuario_id[\s\S]*?m\.activo[\s\S]*?m\.rol in \('direccion', 'admin'\)/);
  assert.match(migracion, /a\.planta_id = p_planta_id[\s\S]*?a\.id = v_activo_id[\s\S]*?for update/);
  assert.match(migracion, /e\.estado = 'STOP'/);
  assert.match(migracion, /not s\.cerrada/);
  assert.match(migracion, /l\.planta_id = p_planta_id[\s\S]*?l\.id = v_linea_id[\s\S]*?l\.activa/);
  assert.match(migracion, /update public\.planta_activos[\s\S]*?set linea_id = v_linea_id[\s\S]*?tarifa_hora = v_tarifa_hora/);
  assert.doesNotMatch(migracion, /update public\.(planta_eventos|planta_solicitudes)/);
  assert.match(migracion, /revoke all on function public\.planta_editar_activo\(uuid, uuid, jsonb\)[\s\S]*?from public, anon, authenticated/);
  assert.match(migracion, /grant execute on function public\.planta_editar_activo\(uuid, uuid, jsonb\)[\s\S]*?to service_role/);
});
