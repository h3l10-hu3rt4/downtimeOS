import test from 'node:test';
import assert from 'node:assert/strict';
import { crearUrlApp, obtenerBaseApp } from '../lib/app-url.js';

test('usa localhost durante desarrollo local', () => {
  assert.equal(obtenerBaseApp({ NODE_ENV: 'development' }), 'http://localhost:3000');
  assert.equal(crearUrlApp('/activar', { NODE_ENV: 'development' }).href, 'http://localhost:3000/activar');
});

test('permite callbacks localhost en el contenedor Docker local aunque el build sea standalone production', () => {
  assert.equal(obtenerBaseApp({ NODE_ENV: 'production', APP_ENV: 'development', APP_URL: 'http://localhost:3000' }), 'http://localhost:3000');
  assert.equal(crearUrlApp('/activar', { NODE_ENV: 'production', APP_ENV: 'development', APP_URL: 'http://localhost:3000' }).href, 'http://localhost:3000/activar');
});

test('prioriza URL explícita y normaliza el origen', () => {
  assert.equal(obtenerBaseApp({ NODE_ENV: 'production', APP_URL: 'https://app.example.com/path/' }), 'https://app.example.com');
  assert.equal(obtenerBaseApp({ NODE_ENV: 'production', NEXT_PUBLIC_SITE_URL: 'https://app.example.com/' }), 'https://app.example.com');
});

test('acepta VERCEL_URL solo como hostname *.vercel.app y usa HTTPS', () => {
  assert.equal(obtenerBaseApp({ NODE_ENV: 'production', VERCEL_URL: 'downtimeos-git-main-team.vercel.app' }), 'https://downtimeos-git-main-team.vercel.app');
  assert.equal(obtenerBaseApp({ NODE_ENV: 'production', VERCEL_URL: 'https://preview-123.vercel.app/' }), 'https://preview-123.vercel.app');
});

test('en producción falla explícitamente si no hay origen seguro', () => {
  assert.throws(() => obtenerBaseApp({ NODE_ENV: 'production' }), /Falta configurar APP_URL/);
  assert.throws(() => obtenerBaseApp({ NODE_ENV: 'production', APP_URL: 'http://localhost:3000' }), /usar HTTPS con un dominio público/);
  assert.throws(() => obtenerBaseApp({ NODE_ENV: 'production', VERCEL_URL: 'attacker.example.com' }), /dominio verificado de Vercel/);
});

test('rechaza rutas que intentan salir del origen de la app', () => {
  assert.throws(() => crearUrlApp('//attacker.example', { NODE_ENV: 'development' }), /ruta del enlace/);
  assert.throws(() => crearUrlApp('/\\attacker.example', { NODE_ENV: 'development' }), /ruta del enlace/);
});
