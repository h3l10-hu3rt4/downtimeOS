import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const original = await readFile(new URL('../supabase/migrations/20261012073419_revocar_select_sin_politicas.sql', import.meta.url), 'utf8');
const repair = await readFile(new URL('../supabase/migrations/20261021000000_fix_optional_demo_backup_revoke.sql', import.meta.url), 'utf8');

test('el endurecimiento de permisos no depende de una tabla que solo crea el script de demo', () => {
  for (const sql of [original, repair]) {
    assert.match(sql, /revoke select on table public\.planta_causas from authenticated/i);
    assert.match(sql, /if to_regclass\('public\.planta_eventos_respaldo_duraciones'\) is not null then/i);
    assert.match(sql, /execute 'revoke select on table public\.planta_eventos_respaldo_duraciones from authenticated'/i);
  }
});
