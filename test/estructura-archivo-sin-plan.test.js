import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mapearErrorEstructura } from '../api/planta/estructura.js';

const fuente = await readFile(new URL('../api/planta/estructura.js', import.meta.url), 'utf8');

test('PATCH no exige plan activo: la validación del plan está confinada a POST', () => {
  assert.match(fuente, /if \(req\.method === 'POST'\) \{\s*const \{ plan \} = await exigirPlanActivo\(sesion\);/);
  const ramaPatch = fuente.match(/\} else \{([\s\S]*?)\n  \}\n\n  const \{ data, error \} = await supabase\.rpc/);
  assert.ok(ramaPatch, 'debe existir una rama separada para PATCH');
  assert.doesNotMatch(ramaPatch[1], /exigirPlanActivo|planes?\./i);
});

test('PATCH solo permite archivar o editar equipos existentes y requiere el identificador correspondiente', () => {
  assert.match(fuente, /\['archivar_linea', 'archivar_activo', 'actualizar_activo'\]\.includes\(cuerpo\.accion\)/);
  assert.match(fuente, /accion === 'actualizar_activo' \? !cuerpo\.activo\?\.id : !cuerpo\.id/);
});

test('PATCH mantiene autorización de rol y ejecuta la RPC de estructura auditada', () => {
  assert.match(fuente, /exigirRolProducto\(sesion, \['direccion', 'admin'\]\)/);
  assert.match(fuente, /await supabase\.rpc\('planta_actualizar_estructura_auditada'/);
  assert.match(fuente, /p_planta_id: sesion\.perfil\.planta_id,[\s\S]*p_usuario_id: sesion\.user\.id,[\s\S]*p_accion: accion,[\s\S]*p_id: cuerpo\.id \|\| null/);
});

test('POST conserva validación del plan y límite de activos', () => {
  const ramaPost = fuente.match(/if \(req\.method === 'POST'\) \{([\s\S]*?)\n  \} else \{/);
  assert.ok(ramaPost, 'debe existir la rama POST');
  assert.match(ramaPost[1], /exigirPlanActivo\(sesion\)/);
  assert.match(ramaPost[1], /plan\.max_activos != null && count >= plan\.max_activos/);
});

test('el límite concurrente de la base se presenta como conflicto de plan con enlace de salida', async () => {
  const respuesta = mapearErrorEstructura({ code: '23514', message: 'El plan alcanzó su límite de equipos activos.' });
  assert.equal(respuesta.status, 409);
  assert.equal(respuesta.cuerpo.codigo, 'PLAN_ASSET_LIMIT');
  assert.match(respuesta.cuerpo.error, /suscripción/i);

  const pantalla = await readFile(new URL('../app/estructura/page.js', import.meta.url), 'utf8');
  assert.match(pantalla, /errorCodigo === 'PLAN_ASSET_LIMIT'[\s\S]*?href="\/suscripcion"/);
  assert.match(pantalla, /disabled=\{guardando\}/);
});
