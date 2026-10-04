import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/20261003001200_sincronizar_onboarding_membresias.sql', import.meta.url), 'utf8');

test('la última migración completa onboarding para todos los miembros de una planta configurada', () => {
  assert.match(migration, /update public\.planta_membresias m[\s\S]*?where m\.activo and m\.onboarding_completado_en is null[\s\S]*?planta_lineas[\s\S]*?planta_activos/);
  assert.match(migration, /update public\.planta_perfiles p[\s\S]*?from public\.planta_membresias m[\s\S]*?m\.onboarding_completado_en is not null/);
  assert.match(migration, /before insert on public\.planta_membresias[\s\S]*?execute function public\.planta_marcar_onboarding_configurada/);
  assert.match(migration, /before update of activo, planta_id on public\.planta_membresias[\s\S]*?execute function public\.planta_marcar_onboarding_configurada/);
  assert.match(migration, /after insert on public\.planta_activos[\s\S]*?execute function public\.planta_completar_onboarding_miembros_activos/);
  assert.match(migration, /set onboarding_completado_en = coalesce\(m\.onboarding_completado_en, clock_timestamp\(\)\)[\s\S]*?m\.activo and m\.onboarding_completado_en is null/);
});
