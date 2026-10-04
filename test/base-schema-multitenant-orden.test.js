import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const leer = (ruta) => readFile(new URL(ruta, import.meta.url), 'utf8');

test('el esquema base puede instalarse antes de que existan las columnas multitenant', async () => {
  const esquema = await leer('../supabase/schema-planta.sql');
  const vista = esquema.split('create or replace view public.planta_bitacora as')[1]?.split('-- Pareto por causa')[0] || '';
  assert.ok(vista, 'se conserva la vista base de bitácora');
  assert.doesNotMatch(vista, /\b[ea]\.planta_id\b/i);
});

test('la cadena vigente añade el ámbito multitenant antes de recrear la bitácora', async () => {
  const multitenant = await leer('../supabase/migrations/20260929000000_multitenant.sql');
  const bitacora = await leer('../supabase/migrations/20260930000100_bitacora.sql');
  const orden = await leer('../supabase/ORDEN-DE-EJECUCION.md');
  const migraciones = (await readdir(new URL('../supabase/migrations/', import.meta.url)))
    .filter((archivo) => archivo.endsWith('.sql'))
    .sort();
  assert.match(multitenant, /planta_eventos[\s\S]{0,200}planta_id/i);
  assert.match(bitacora, /a\.planta_id\s*=\s*e\.planta_id/i);
  assert.ok(
    migraciones.indexOf('20260929000000_multitenant.sql') < migraciones.indexOf('20260930000100_bitacora.sql'),
    'Supabase CLI aplicará el ámbito multitenant antes de la vista de bitácora',
  );
  assert.match(orden, /supabase\/migrations[\s\S]*Supabase[\s\S]*CLI/);
  assert.match(orden, /supabase\/migraciones\/[\s\S]*no deben copiarse\/ejecutarse/);
});
