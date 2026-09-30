import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DASHBOARD_ADMIN_EMAIL = 'admin@prueba.tech';
process.env.DASHBOARD_ADMIN_PASSWORD = 'clave-de-prueba';

const { default: middleware, config } = await import('../middleware.js');
const { crearCookieSesion } = await import('../lib/administracion.js');

/** El middleware deja pasar la petición cuando responde con esta cabecera. */
const pasa = (respuesta) => respuesta.headers.get('x-middleware-next') === '1';
const cookie = crearCookieSesion().split(';')[0];
const peticion = (ruta, metodo = 'GET', conSesion = false) =>
  new Request(`https://downtimeos.tech${ruta}`, { method: metodo, headers: conSesion ? { cookie } : {} });

test('la lista de prospectos exige sesión de administración', async () => {
  const sinSesion = await middleware(peticion('/api/leads?limite=25'));
  assert.equal(sinSesion.status, 401);
  assert.equal(pasa(await middleware(peticion('/api/leads?limite=25', 'GET', true))), true);
});

test('el formulario público y los contadores de la landing siguen abiertos', async () => {
  assert.equal(pasa(await middleware(peticion('/api/leads', 'POST'))), true);
  assert.equal(pasa(await middleware(peticion('/api/leads/stats'))), true);
});

test('la ruta de leads está en el matcher del middleware', () => {
  assert.ok(config.matcher.includes('/api/leads'));
});

// ------------------------------------------------ guarda en el handler ---
// Segunda capa: aunque el middleware no corra (servidor local, otro runtime),
// el handler no entrega datos sin sesión. Estas llamadas se cortan ANTES de
// tocar Supabase, así que no necesitan base de datos.
function respuestaFalsa() {
  const r = { codigo: null, cuerpo: null, cabeceras: {} };
  r.setHeader = (k, v) => { r.cabeceras[k] = v; };
  r.status = (c) => { r.codigo = c; return r; };
  r.send = (b) => { r.cuerpo = JSON.parse(b); return r; };
  r.end = () => r;
  return r;
}

test('el handler de leads responde 401 sin sesión aunque el middleware no corra', async () => {
  const { default: handler } = await import('../api/leads/index.js');
  const res = respuestaFalsa();
  await handler({ method: 'GET', headers: {}, query: { limite: '25' } }, res);
  assert.equal(res.codigo, 401);
  assert.equal(res.cuerpo.ok, false);
  assert.equal(res.cuerpo.leads, undefined);
});

test('las métricas del panel responden 401 sin sesión', async () => {
  const { default: handler } = await import('../api/observabilidad/uso.js');
  const res = respuestaFalsa();
  await handler({ method: 'GET', headers: {}, query: {} }, res);
  assert.equal(res.codigo, 401);
});

test('el selector de proveedor de IA exige sesión; el análisis de la demo no', async () => {
  const fuente = await import('node:fs/promises')
    .then(({ readFile }) => readFile(new URL('../api/ia/resumen.js', import.meta.url), 'utf8'));
  assert.match(fuente, /if \(req\.method !== 'POST'\) exigirSesionAdministrador\(req\)/);
});

test('/api/health solo entrega detalle de infraestructura con sesión', async () => {
  const fuente = await import('node:fs/promises')
    .then(({ readFile }) => readFile(new URL('../api/health.js', import.meta.url), 'utf8'));
  assert.match(fuente, /if \(!sesionAdministradorValida\(req\.headers\?\.cookie \?\? ''\)\) \{\s*return json\(res, codigo, \{ ok: conexion\.disponible, timestamp/);
});
