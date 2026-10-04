import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const panel = await readFile(new URL('../app/suscripcion/page.js', import.meta.url), 'utf8');

test('una solicitud mensual histórica explica cómo liberarla y permite cancelarla conservando el historial', () => {
  assert.match(panel, /const solicitudPeriodoNoOfrecido = datos\.suscripciones\.find/);
  assert.match(panel, /periodo mensual que ya no ofrecemos/i);
  assert.match(panel, /cancelar\(solicitudPeriodoNoOfrecido\.id, false, true\)/);
  assert.match(panel, /Si ya enviaste una transferencia, esto no procesa una devolución/);
  assert.match(panel, /Cancelar solicitud mensual anterior/);
});

test('no se presenta cancelación automática para registros históricos si falta permiso de facturación', () => {
  assert.match(panel, /datos\.puede_editar \? <button[^]*Cancelar solicitud mensual anterior/);
  assert.match(panel, /Solicita al titular o al responsable de facturación que la cancele/);
});
