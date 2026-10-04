import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migracion = await readFile(new URL('../supabase/migrations/20261002001100_revocar_escritura_publica.sql', import.meta.url), 'utf8');
const migracionRpcLegacy = await readFile(new URL('../supabase/migrations/20261003000400_restringir_rpc_legacy_tarifas.sql', import.meta.url), 'utf8');
const migracionRpcMultitenant = await readFile(new URL('../supabase/migrations/20261003000500_restringir_rpc_tarifas_multitenant.sql', import.meta.url), 'utf8');
const migracionSolicitudes = await readFile(new URL('../supabase/migrations/20261003000600_privilegios_solicitudes.sql', import.meta.url), 'utf8');
const runnerE2E = await readFile(new URL('../scripts/e2e-mvp-local.mjs', import.meta.url), 'utf8');

test('revoca privilegios de mutación existentes a anon y authenticated sin retirar SELECT', () => {
  assert.match(migracion, /revoke insert, update, delete, truncate, references, trigger\s+on all tables in schema public from anon, authenticated/i);
  assert.match(migracion, /revoke usage, select, update\s+on all sequences in schema public from anon, authenticated/i);
  assert.doesNotMatch(migracion, /revoke all privileges on all tables/i);
  assert.doesNotMatch(migracion, /revoke select\s+on all tables in schema public from anon, authenticated/i);
});

test('las tablas y secuencias futuras tampoco heredan permisos de escritura pública', () => {
  assert.match(migracion, /alter default privileges for role postgres in schema public\s+revoke insert, update, delete, truncate, references, trigger\s+on tables from anon, authenticated/i);
  assert.match(migracion, /alter default privileges for role postgres in schema public\s+revoke select on tables from anon/i);
  assert.match(migracion, /alter default privileges for role postgres in schema public\s+revoke usage, select, update on sequences from anon, authenticated/i);
});

test('el cliente anónimo no puede leer tablas públicas directamente', () => {
  assert.match(migracion, /revoke select on all tables in schema public from anon/i);
  assert.doesNotMatch(migracion, /revoke select on all tables in schema public from anon, authenticated/i);
});

test('prospectos y tarifas de activos no dependen solo de RLS para ocultar datos sensibles', () => {
  assert.match(migracion, /revoke all privileges on table public\.leads from anon, authenticated/i);
  assert.match(migracion, /revoke select \(%s\) on table public\.leads from anon, authenticated/i);
  assert.match(migracion, /revoke select \(tarifa_hora\) on table public\.planta_activos from anon, authenticated/i);
});

test('solicitudes y la identidad interna del operador no se leen directamente por PostgREST', () => {
  assert.match(migracionSolicitudes, /revoke all privileges on table public\.planta_solicitudes from anon, authenticated/i);
  assert.match(migracionSolicitudes, /revoke select \(%s\) on table public\.planta_solicitudes from anon, authenticated/i);
  assert.match(runnerE2E, /'planta_solicitudes'/);
});

test('las RPC históricas de tarifas quedan disponibles solo para el servidor interno', () => {
  for (const funcion of ['planta_factor_capacidad', 'planta_tarifa_aplicable']) {
    assert.match(migracionRpcLegacy, new RegExp(`revoke execute on function public\\.${funcion}\\(text\\)\\s+from public, anon, authenticated`, 'i'));
    assert.match(migracionRpcLegacy, new RegExp(`grant execute on function public\\.${funcion}\\(text\\) to service_role`, 'i'));
    assert.match(migracionRpcMultitenant, new RegExp(`revoke execute on function public\\.${funcion}\\(text,\\s*uuid\\)\\s+from public, anon, authenticated`, 'i'));
    assert.match(migracionRpcMultitenant, new RegExp(`grant execute on function public\\.${funcion}\\(text,\\s*uuid\\) to service_role`, 'i'));
  }
});
