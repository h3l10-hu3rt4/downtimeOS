import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const planta = await readFile(new URL('../lib/planta.js', import.meta.url), 'utf8');
const migracion = await readFile(new URL('../supabase/migrations/20261004000200_cancelar_evento_atomico.sql', import.meta.url), 'utf8');

test('la API cancela mediante una sola RPC con el ámbito de planta autenticado', () => {
  const inicio = planta.indexOf('export async function eliminarEvento(');
  const fin = planta.indexOf('\n}\n', inicio);
  const funcion = planta.slice(inicio, fin);
  assert.match(funcion, /rpc\('planta_cancelar_evento'/);
  assert.match(funcion, /p_planta_id: plantaId/);
  assert.match(funcion, /P0002[\s\S]*?404/);
  assert.doesNotMatch(funcion, /from\('planta_cancelaciones'\)|\.delete\(\)/);
});

test('la transacción bloquea el evento, registra auditoría y lo elimina en el mismo tenant', () => {
  assert.match(migracion, /where planta_id = p_planta_id and folio = p_folio\s+for update/i);
  assert.match(migracion, /insert into public\.planta_cancelaciones[\s\S]*?delete from public\.planta_eventos/i);
  assert.match(migracion, /if not found then[\s\S]*?using errcode = '40001'/i);
  assert.match(migracion, /revoke all on function public\.planta_cancelar_evento[\s\S]*?from public, anon, authenticated/i);
  assert.match(migracion, /grant execute on function public\.planta_cancelar_evento[\s\S]*?to service_role/i);
});
