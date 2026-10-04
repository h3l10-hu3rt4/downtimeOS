import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(new URL('../supabase/migrations/20261002001000_folios_unicos.sql', import.meta.url), 'utf8');
const schema = await readFile(new URL('../supabase/schema-planta.sql', import.meta.url), 'utf8');

test('folios nuevos de eventos y solicitudes usan sufijo aleatorio resistente a colisiones', () => {
  assert.match(migration, /create or replace function public\.planta_folio_resistente_colisiones/i);
  assert.match(migration, /gen_random_uuid\(\)::text[\s\S]*?\),1,12\)/i);
  assert.match(migration, /before insert on public\.planta_eventos/i);
  assert.match(migration, /before insert on public\.planta_solicitudes/i);
  assert.match(migration, /using errcode='23505'/i);
  assert.match(migration, /folio ~ '\^L\[0-9\]\{2\}.*\[0-9A-Z\]\{2,12\}\$'/i);
  assert.match(schema, /\[0-9A-Z\]\{2,12\}/);
});
