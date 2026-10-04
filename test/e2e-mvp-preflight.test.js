import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import {
  BUCKETS_CON_ARCHIVOS_TENANT_E2E,
  esUrlFirmadaStorageLocal,
  TABLAS_CON_DATOS_TENANT_E2E,
  validarBaseE2E,
} from '../scripts/e2e-mvp-preflight.js';

const orgId = '50000000-0000-4000-8000-000000000001';
const base = {
  organizaciones: [],
  totalOrganizaciones: 0,
  filasTenant: Object.fromEntries(TABLAS_CON_DATOS_TENANT_E2E.map((tabla) => [tabla, 0])),
  bucketsConArchivos: [],
};
const legacy = {
  ...base,
  organizaciones: [{ id: orgId, nombre: 'Histórico DowntimeOS' }],
  totalOrganizaciones: 1,
  plantasLegacy: [{ id: '50000000-0000-4000-8000-000000000002', organizacion_id: orgId, codigo: 'LEGACY' }],
  totalPlantasLegacy: 1,
};

test('acepta una base realmente vacía', () => {
  assert.equal(validarBaseE2E(base), true);
});

test('acepta únicamente el tenant y planta LEGACY vacíos creados por migración', () => {
  assert.equal(validarBaseE2E(legacy), true);
});

test('bloquea organizaciones adicionales o con nombre distinto', () => {
  assert.equal(validarBaseE2E({ ...legacy, totalOrganizaciones: 2 }), false);
  assert.equal(validarBaseE2E({ ...legacy, organizaciones: [{ ...legacy.organizaciones[0], nombre: 'Cuenta de cliente' }] }), false);
});

test('bloquea planta LEGACY distinta, extra o asociada a otro tenant', () => {
  assert.equal(validarBaseE2E({ ...legacy, plantasLegacy: [{ ...legacy.plantasLegacy[0], codigo: 'NORTE' }] }), false);
  assert.equal(validarBaseE2E({ ...legacy, totalPlantasLegacy: 2 }), false);
  assert.equal(validarBaseE2E({ ...legacy, plantasLegacy: [{ ...legacy.plantasLegacy[0], organizacion_id: '50000000-0000-4000-8000-000000000099' }] }), false);
});

test('bloquea cualquier fila previa en cada tabla operacional o de tenant', () => {
  for (const tabla of TABLAS_CON_DATOS_TENANT_E2E) {
    assert.equal(validarBaseE2E({
      ...legacy,
      filasTenant: { ...legacy.filasTenant, [tabla]: 1 },
    }), false, tabla);
  }
});

test('falla cerrado si falta el conteo de una tabla o no se pudo verificar como cero', () => {
  const incompleta = Object.fromEntries(Object.entries(base.filasTenant)
    .filter(([tabla]) => tabla !== 'planta_eventos'));
  assert.equal(validarBaseE2E({ ...base, filasTenant: incompleta }), false);
  assert.equal(validarBaseE2E({ ...base, filasTenant: { ...base.filasTenant, planta_eventos: -1 } }), false);
  assert.equal(validarBaseE2E({ ...base, filasTenant: null }), false);
});

test('bloquea archivos previos en buckets privados de comprobantes y reportes', () => {
  for (const bucket of BUCKETS_CON_ARCHIVOS_TENANT_E2E) {
    assert.equal(validarBaseE2E({ ...base, bucketsConArchivos: [bucket] }), false, bucket);
  }
  assert.equal(validarBaseE2E({ ...base, bucketsConArchivos: null }), false);
});

test('el preflight cubre tablas de tenant que existen en la cadena versionada', async () => {
  const directory = new URL('../supabase/migrations/', import.meta.url);
  const files = await readdir(directory);
  const migrations = (await Promise.all(files.filter((file) => file.endsWith('.sql'))
    .map((file) => readFile(new URL(file, directory), 'utf8')))).join('\n');
  for (const tabla of TABLAS_CON_DATOS_TENANT_E2E) {
    assert.match(migrations, new RegExp(`create\\s+table(?:\\s+if\\s+not\\s+exists)?\\s+public\\.${tabla}\\b`, 'i'), tabla);
  }
});

test('valida URL firmada del Storage contra el origen configurado, no un puerto fijo', () => {
  const origin = 'http://127.0.0.1:54331';
  assert.equal(esUrlFirmadaStorageLocal(`${origin}/storage/v1/object/sign/comprobantes/archivo.pdf?token=secret`, origin), true);
  assert.equal(esUrlFirmadaStorageLocal('http://127.0.0.1:54321/storage/v1/object/sign/comprobantes/archivo.pdf', origin), false);
  assert.equal(esUrlFirmadaStorageLocal(`${origin}/storage/v1/object/public/comprobantes/archivo.pdf`, origin), false);
  assert.equal(esUrlFirmadaStorageLocal(undefined, origin), false);
});

test('Supabase Local permite el callback del servidor aislado E2E en el puerto 3001', async () => {
  const config = await readFile(new URL('../supabase/config.toml', import.meta.url), 'utf8');
  assert.match(config, /http:\/\/localhost:3001\/\*\*/);
  assert.match(config, /http:\/\/127\.0\.0\.1:3001\/\*\*/);
  assert.match(config, /minimum_password_length\s*=\s*10/);
});
