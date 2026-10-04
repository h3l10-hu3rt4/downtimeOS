import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/20261002000800_privilegios_integraciones.sql', import.meta.url), 'utf8');
const apiIa = await readFile(new URL('../api/ia/resumen.js', import.meta.url), 'utf8');
const apiStats = await readFile(new URL('../api/leads/stats.js', import.meta.url), 'utf8');
const repositorio = await readFile(new URL('../lib/repositorio.js', import.meta.url), 'utf8');
const e2e = await readFile(new URL('../scripts/e2e-mvp-local.mjs', import.meta.url), 'utf8');

test('proveedores e interruptores globales solo son accesibles directamente por service_role', () => {
  assert.match(migration, /alter default privileges for role postgres in schema public\s+revoke all privileges on tables from anon, authenticated/i);
  for (const tabla of ['planta_proveedor_ia', 'planta_interruptores_integraciones']) {
    assert.match(migration, new RegExp(`alter table public\\.${tabla} enable row level security`, 'i'));
    assert.match(migration, new RegExp(`revoke all privileges on table public\\.${tabla} from public, anon, authenticated`, 'i'));
    assert.match(migration, new RegExp(`grant select, insert, update, delete on table public\\.${tabla} to service_role`, 'i'));
  }
  assert.match(migration, /revoke all privileges on table public\.planta_analisis_ia, public\.planta_mensajes, public\.planta_reportes\s+from public, anon, authenticated/i);
  assert.match(migration, /grant select, insert, update, delete on table public\.planta_analisis_ia, public\.planta_mensajes, public\.planta_reportes\s+to service_role/i);
  assert.match(e2e, /\['planta_analisis_ia', 'resultado,entrada'\]/);
  assert.match(e2e, /\['planta_mensajes', 'destinatario,contenido'\]/);
  assert.match(e2e, /\['planta_reportes', 'storage_path'\]/);
});

test('el selector de proveedores sigue reservado a Administración en el servidor', () => {
  assert.match(apiIa, /if \(req\.method !== 'POST'\) exigirSesionAdministrador\(req\)/);
  assert.match(apiIa, /from\('planta_proveedor_ia'\)\.select/);
  assert.match(apiIa, /from\('planta_proveedor_ia'\)\.upsert/);
});

test('las vistas de prospectos solo se consultan desde el servidor', () => {
  assert.match(migration, /revoke all privileges on table public\.leads_por_modelo, public\.leads_stats\s+from public, anon, authenticated, service_role/i);
  assert.match(migration, /grant select on table public\.leads_por_modelo, public\.leads_stats to service_role/i);
  assert.match(apiStats, /obtenerStats\(\)/);
  assert.match(repositorio, /from\('leads_stats'\)\.select\('\*'\)/);
});
