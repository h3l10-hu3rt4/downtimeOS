import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/20261003000300_bloquear_activacion_periodo_legacy.sql', import.meta.url), 'utf8');
const panel = await readFile(new URL('../app/administracion/suscripciones/panel.js', import.meta.url), 'utf8');

test('la base conserva periodos históricos pero impide activar o pilotear periodos no ofrecidos', () => {
  assert.match(migration, /new\.estado in \('activa', 'piloto'\)/i);
  assert.match(migration, /new\.periodicidad is null or new\.periodicidad not in \('semestral', 'anual'\)/i);
  assert.match(migration, /using errcode = '23514'/i);
  assert.match(migration, /before update of estado, periodicidad/i);
});

test('el panel explica y no ofrece activar una solicitud de periodicidad histórica', () => {
  assert.match(panel, /Periodo histórico no ofrecido/);
  assert.match(panel, /const periodoOfrecido = \['semestral', 'anual'\]\.includes\(s\.periodicidad\)/);
  assert.match(panel, /periodoOfrecido \? <>.*resolver\(s\.id, 'activar'\)/s);
  assert.match(panel, /periodoOfrecido \? <>.*resolver\(s\.id, 'piloto'\)/s);
  assert.match(panel, /resolver\(s\.id, 'rechazar'\)/);
});
