import { test } from 'node:test';
import assert from 'node:assert/strict';
import { urlParaNavegador } from '../lib/url-local.js';

test('reemplaza host.docker.internal por localhost conservando ruta, puerto y token', () => {
  const firmada = 'http://host.docker.internal:54321/storage/v1/object/sign/comprobantes/a.pdf?token=abc.def';
  assert.equal(urlParaNavegador(firmada), 'http://localhost:54321/storage/v1/object/sign/comprobantes/a.pdf?token=abc.def');
});

test('no toca URLs de producción, localhost ni valores no válidos', () => {
  const prod = 'https://abc.supabase.co/storage/v1/object/sign/x.pdf?token=t';
  assert.equal(urlParaNavegador(prod), prod);
  assert.equal(urlParaNavegador('http://localhost:54321/x'), 'http://localhost:54321/x');
  assert.equal(urlParaNavegador('https://host.docker.internal/x'), 'https://host.docker.internal/x');
  assert.equal(urlParaNavegador('no es url'), 'no es url');
  assert.equal(urlParaNavegador(undefined), undefined);
});
