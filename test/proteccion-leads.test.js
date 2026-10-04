import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DASHBOARD_ADMIN_EMAIL = 'admin@prueba.tech';
process.env.DASHBOARD_ADMIN_PASSWORD = 'clave-de-prueba';

const { default: middleware, config } = await import('../middleware.js');
const { crearCookieSesion, sesionAdministradorValida } = await import('../lib/administracion.js');

/** El middleware deja pasar la petición cuando responde con esta cabecera. */
const pasa = (respuesta) => respuesta.headers.get('x-middleware-next') === '1';
const cookie = crearCookieSesion().split(';')[0];
const peticionOperativa = (ruta) => new Request(`https://downtimeos.tech${ruta}`, {
  headers: { cookie: 'downtimeos_session=token-de-prueba' },
});
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

test('las rutas operativas regresan al acceso con returnTo después de validar la sesión', async () => {
  for (const ruta of ['/direccion', '/operaciones', '/operador']) {
    const respuesta = await middleware(peticion(ruta));
    assert.equal(respuesta.status, 302);
    const destino = new URL(respuesta.headers.get('location'));
    assert.equal(destino.pathname, '/acceso');
    assert.equal(destino.searchParams.get('returnTo'), ruta);
    assert.equal(destino.searchParams.has('destino'), false);
    assert.equal(pasa(await middleware(peticionOperativa(ruta))), true);
  }
});

test('la sesión administrativa valida tanto encabezados HTTP como CookieStore de Next', () => {
  const valor = cookie.slice(cookie.indexOf('=') + 1);
  assert.equal(sesionAdministradorValida(cookie), true);
  assert.equal(sesionAdministradorValida({ get: (nombre) => nombre === 'downtimeos_admin' ? { value: valor } : undefined }), true);
  assert.equal(sesionAdministradorValida({ get: () => undefined }), false);
});

test('la cookie administrativa marca Secure también en Docker de producción fuera de Vercel', () => {
  const appEnvAnterior = process.env.APP_ENV;
  const vercelEnvAnterior = process.env.VERCEL_ENV;
  try {
    process.env.APP_ENV = 'production';
    delete process.env.VERCEL_ENV;
    assert.match(crearCookieSesion(), /; Secure(?:;|$)/);
    process.env.APP_ENV = 'development';
    assert.doesNotMatch(crearCookieSesion(), /; Secure(?:;|$)/);
  } finally {
    if (appEnvAnterior === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = appEnvAnterior;
    if (vercelEnvAnterior === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = vercelEnvAnterior;
  }
});

test('las páginas de administración se evalúan en runtime y no se prerenderizan sin credenciales', async () => {
  const { readFile } = await import('node:fs/promises');
  for (const archivo of ['../app/administracion/page.js', '../app/administracion/suscripciones/page.js', '../app/dashboard/apiGastos/page.js']) {
    const fuente = await readFile(new URL(archivo, import.meta.url), 'utf8');
    assert.match(fuente, /export const dynamic = 'force-dynamic'/, archivo);
  }
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
