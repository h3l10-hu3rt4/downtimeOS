import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.SUPABASE_SECRET_KEY = 'test-secret';

const { supabase } = await import('../lib/supabase.js');
const salirApi = (await import('../api/cuenta/index.js')).default;
const sesionSource = await readFile(new URL('../public/demo/js/sesion.js', import.meta.url), 'utf8');

function response() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    send(body) { this.body = body; return this; },
    end() { return this; },
  };
}

test('el endpoint de salida revoca solo la sesión actual de Supabase y limpia la cookie de app', async () => {
  let llamada;
  supabase.auth = { admin: { signOut: async (...args) => { llamada = args; return { error: null }; } } };
  const res = response();
  await salirApi({ method: 'POST', headers: { authorization: 'Bearer access-token-actual' }, body: { accion: 'salir' } }, res);
  assert.deepEqual(llamada, ['access-token-actual', 'local']);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['Set-Cookie'], /Max-Age=0/);
  assert.equal(JSON.parse(res.body).sesion_revocada, true);
});

test('si Supabase no responde, la ruta aún limpia la cookie y reporta la revocación pendiente', async () => {
  supabase.auth = { admin: { signOut: async () => { throw new Error('sin red'); } } };
  const res = response();
  await salirApi({ method: 'POST', headers: { authorization: 'Bearer access-token-actual' }, body: { accion: 'salir' } }, res);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['Set-Cookie'], /Max-Age=0/);
  assert.equal(JSON.parse(res.body).sesion_revocada, false);
});

test('el navegador elimina el refresh token de Supabase del proyecto y el token de DowntimeOS', async () => {
  const almacen = new Map([
    ['downtimeos_sesion', JSON.stringify({ access_token: 'access-local', refresh_token: 'refresh-local' })],
    ['sb-127-auth-token', 'sesion-supabase'],
    ['sb-127-auth-token-user', 'usuario-supabase'],
    ['sb-127-auth-token-code-verifier', 'verificador'],
    ['sb-127-auth-token-flow-test-code-verifier', 'verificador-pkce'],
    ['sb-otro-proyecto-auth-token', 'no tocar'],
  ]);
  const localStorage = {
    get length() { return almacen.size; },
    getItem(key) { return almacen.get(key) ?? null; },
    setItem(key, value) { almacen.set(key, value); },
    removeItem(key) { almacen.delete(key); },
    key(index) { return [...almacen.keys()][index] ?? null; },
  };
  const llamadas = [];
  const ventana = {
    localStorage,
    location: { href: '' },
    fetch: async (url, init = {}) => {
      llamadas.push({ url, init });
      if (url === '/api/config') return { ok: true, json: async () => ({ supabase_url: 'http://127.0.0.1:54321' }) };
      return { ok: true };
    },
  };
  vm.runInNewContext(sesionSource, { window: ventana, document: { getElementById: () => null }, URL });
  await ventana.Sesion.salir();
  assert.equal(almacen.has('downtimeos_sesion'), false);
  assert.equal(almacen.has('sb-127-auth-token'), false);
  assert.equal(almacen.has('sb-127-auth-token-user'), false);
  assert.equal(almacen.has('sb-127-auth-token-code-verifier'), false);
  assert.equal(almacen.has('sb-127-auth-token-flow-test-code-verifier'), false);
  assert.equal(almacen.get('sb-otro-proyecto-auth-token'), 'no tocar');
  const peticionSalida = llamadas.find((llamada) => llamada.url === '/api/cuenta');
  assert.equal(peticionSalida.init.headers.authorization, 'Bearer access-local');
  assert.equal(peticionSalida.init.keepalive, true);
  assert.equal(ventana.location.href, '/acceso');
});
