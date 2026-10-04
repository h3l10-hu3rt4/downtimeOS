import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile(new URL('../supabase/migrations/20260930000200_onboarding.sql', import.meta.url), 'utf8');

test('serializa altas de activos y plantas por organización para respetar límites', () => {
  assert.match(sql, /if p_accion in \('crear_activo'\)[\s\S]*?pg_advisory_xact_lock\(hashtextextended\(v_organizacion_id::text, 0\)\)/);
  assert.match(sql, /organizacion_agregar_planta[\s\S]*?pg_advisory_xact_lock\(hashtextextended\(p_organizacion_id::text, 0\)\)/);
});

test('serializa archivar una línea con crear equipos para evitar activos huérfanos', async () => {
  const migracion = await readFile(new URL('../supabase/migrations/20261002000400_serializar_estructura.sql', import.meta.url), 'utf8');
  assert.match(migracion, /if p_accion in \('crear_activo', 'archivar_linea'\)[\s\S]*?pg_advisory_xact_lock\(hashtextextended\(v_organizacion_id::text, 0\)\)/);
  assert.match(migracion, /perform pg_advisory_xact_lock[\s\S]*?elsif p_accion = 'crear_activo'[\s\S]*?elsif p_accion = 'archivar_linea'/);
  assert.match(migracion, /archiva primero los equipos activos de esta línea/i);
});

test('bloquea el activo al reportar paro y al archivarlo para evitar una carrera', () => {
  assert.match(sql, /create or replace function public\.planta_reportar_paro[\s\S]*?where planta_id=p_planta_id and id=p_activo_id and activo\s+for update/i);
  assert.match(sql, /elsif p_accion = 'archivar_activo'[\s\S]*?where planta_id=p_planta_id and id=v_activo_id and activo\s+for update/i);
  assert.match(sql, /Este equipo ya tiene un paro o reporte abierto/);
});

test('el onboarding inicial bloquea la planta y no combina dos envíos concurrentes', () => {
  assert.match(sql, /create or replace function public\.planta_configurar_inicial[\s\S]*?from public\.plantas where id=p_planta_id and activa for update/i);
});

test('el límite máximo de activos de plan se cuenta a nivel organización', () => {
  assert.match(sql, /select count\(\*\) into v_cantidad from public\.planta_activos a\s+join public\.plantas p on p\.id=a\.planta_id\s+where p\.organizacion_id=v_organizacion_id/i);
});

test('reservar avisos exige que la suscripción pertenezca a la organización', () => {
  assert.match(sql, /organizacion_reservar_aviso_suscripcion[\s\S]*?s\.id=p_suscripcion_id and s\.organizacion_id=p_organizacion_id/);
  assert.match(sql, /where organizacion_suscripcion_avisos\.estado='error'/);
});
