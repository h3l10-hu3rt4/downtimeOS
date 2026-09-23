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
