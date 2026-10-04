import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile(new URL('../supabase/migrations/20261002000200_integridad_tenant_planta.sql', import.meta.url), 'utf8');

test('preflight rejects existing mismatches before adding cross-tenant integrity constraints', () => {
  assert.match(sql, /if exists \([\s\S]*?planta_membresias[\s\S]*?planta_perfiles[\s\S]*?planta_invitaciones[\s\S]*?is distinct from[\s\S]*?raise exception/i);
});

test('membership, profile and invitation plant/organization pairs have composite foreign keys', () => {
  for (const relation of ['planta_membresias', 'planta_perfiles', 'planta_invitaciones']) {
    assert.match(sql, new RegExp(`alter table public\\.${relation}[\\s\\S]*?foreign key \\(planta_id, organizacion_id\\) references public\\.plantas\\(id, organizacion_id\\)[\\s\\S]*?on delete cascade`, 'i'));
  }
  assert.match(sql, /unique \(id, organizacion_id\)/i);
  assert.match(sql, /validate constraint planta_membresias_planta_tenant_fkey/i);
  assert.match(sql, /validate constraint planta_perfiles_planta_tenant_fkey/i);
  assert.match(sql, /validate constraint planta_invitaciones_planta_tenant_fkey/i);
});
