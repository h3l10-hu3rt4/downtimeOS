import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/20261004000400_auditar_mutaciones_estructura.sql', import.meta.url), 'utf8');
const setupApi = await readFile(new URL('../api/planta/configuracion.js', import.meta.url), 'utf8');
const structureApi = await readFile(new URL('../api/planta/estructura.js', import.meta.url), 'utf8');

test('onboarding y auditoría de estructura confirman o revierten juntas en PostgreSQL', () => {
  assert.match(migration, /^--[^\n]*\n--[^\n]*\nbegin;[\s\S]*notify pgrst, 'reload schema';\s*commit;\s*$/i);
  assert.match(migration, /create or replace function public\.planta_configurar_inicial_auditada[\s\S]*?v_resultado := public\.planta_configurar_inicial\([\s\S]*?insert into public\.planta_auditoria[\s\S]*?return v_resultado;/i);
  assert.match(migration, /create or replace function public\.planta_actualizar_estructura_auditada[\s\S]*?v_resultado := public\.planta_editar_activo[\s\S]*?insert into public\.planta_auditoria[\s\S]*?return v_resultado;/i);
  assert.match(migration, /v_resultado := public\.planta_actualizar_estructura\([\s\S]*?insert into public\.planta_auditoria/i);
  assert.match(migration, /m\.user_id = p_usuario_id and m\.activo and m\.rol in \('direccion','admin'\)/i);
  assert.match(migration, /'antes',v_antes,'despues',v_despues/);
  assert.match(migration, /case when v_entidad = 'activo'[\s\S]*?coalesce\(v_resultado->>'activo_id',v_resultado->>'linea_id'\)/i);
  assert.match(migration, /where a\.planta_id = p_planta_id and a\.id = p_activo->>'id'\s+for update/i);
  assert.match(migration, /where l\.planta_id = p_planta_id and l\.id = p_id\s+for update/i);
  assert.match(migration, /'lineas',v_lineas,'activos',v_activos/);
  assert.match(migration, /revoke all on function public\.planta_configurar_inicial_auditada[\s\S]*?from public,anon,authenticated[\s\S]*?grant execute on function public\.planta_configurar_inicial_auditada[\s\S]*?to service_role/i);
  assert.match(migration, /revoke all on function public\.planta_actualizar_estructura_auditada[\s\S]*?from public,anon,authenticated[\s\S]*?grant execute on function public\.planta_actualizar_estructura_auditada[\s\S]*?to service_role/i);
});

test('las APIs dejan de hacer una segunda escritura de auditoría best-effort', () => {
  assert.match(setupApi, /rpc\('planta_configurar_inicial_auditada'/);
  assert.doesNotMatch(setupApi, /from\('planta_auditoria'\)\.insert/);
  assert.match(structureApi, /rpc\('planta_actualizar_estructura_auditada'/);
  assert.doesNotMatch(structureApi, /from\('planta_auditoria'\)\.insert/);
});
