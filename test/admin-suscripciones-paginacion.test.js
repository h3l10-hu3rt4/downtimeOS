import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

process.env.DASHBOARD_ADMIN_EMAIL = 'admin@example.test';
process.env.DASHBOARD_ADMIN_PASSWORD = 'clave-de-prueba';

const { crearCookieSesion } = await import('../lib/administracion.js');
const { supabase } = await import('../lib/supabase.js');
const endpoint = (await import('../api/administracion/suscripciones.js')).default;
const panel = await readFile(new URL('../app/administracion/suscripciones/panel.js', import.meta.url), 'utf8');

function response() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    send(body) { this.body = body; return this; },
    end() { return this; },
  };
}

test('el panel pagina solicitudes sin ocultar registros antiguos después de 200', async () => {
  let rango;
  let opcionesConteo;
  supabase.from = (tabla) => {
    assert.equal(tabla, 'organizacion_suscripciones');
    const consulta = {
      select(_campos, opciones) { opcionesConteo = opciones; return consulta; },
      order() { return consulta; },
      range(desde, hasta) { rango = [desde, hasta]; return consulta; },
      then(resolve, reject) {
        return Promise.resolve({
          data: [{ id: 'solicitud-antigua', organizacion_id: 'org', plan_codigo: 'pro', estado: 'solicitada', periodicidad: 'anual', plantas_incluidas: 1, creada_en: '2026-01-01T00:00:00Z', organizacion_pagos: [] }],
          count: 201,
          error: null,
        }).then(resolve, reject);
      },
    };
    return consulta;
  };
  const res = response();
  await endpoint({ method: 'GET', query: { offset: '200' }, headers: { cookie: crearCookieSesion() } }, res);
  const body = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(rango, [200, 299]);
  assert.deepEqual(opcionesConteo, { count: 'exact' });
  assert.equal(body.total, 201);
  assert.equal(body.suscripciones[0].id, 'solicitud-antigua');
  assert.equal(body.hay_mas, false);
});

test('el panel permite pedir páginas siguientes y conserva entradas ya cargadas', () => {
  assert.match(panel, /suscripciones\?offset=\$\{offset\}/);
  assert.match(panel, /actuales, \.\.\.cuerpo\.suscripciones/);
  assert.match(panel, /offset: solicitudes\.length, anexar: true/);
  assert.match(panel, /Cargar más solicitudes/);
  assert.match(panel, /crearControlCarga/);
  assert.match(panel, /forzar: true/);
});

test('el panel administrativo muestra primero el pago más reciente de cada suscripción', async () => {
  const fromOriginal = supabase.from;
  const pagos = [
    { id: 'pago-antiguo', estado: 'pendiente', importe: 100, moneda: 'USD', created_at: '2026-01-01T00:00:00Z' },
    { id: 'pago-reciente', estado: 'comprobante_recibido', importe: 200, moneda: 'USD', created_at: '2026-02-01T00:00:00Z' },
  ];
  supabase.from = (tabla) => {
    const consulta = {
      select() { return consulta; },
      order() { return consulta; },
      range() { return consulta; },
      in() { return consulta; },
      then(resolve, reject) {
        const resultado = tabla === 'organizacion_suscripciones'
          ? { data: [{ id: 'sub', organizacion_id: 'org', plan_codigo: 'pro', estado: 'pendiente_pago', periodicidad: 'anual', plantas_incluidas: 1, creada_en: '2026-02-01T00:00:00Z', organizacion_pagos: pagos }], count: 1, error: null }
          : { data: [], error: null };
        return Promise.resolve(resultado).then(resolve, reject);
      },
    };
    return consulta;
  };
  try {
    const res = response();
    await endpoint({ method: 'GET', query: { offset: '0' }, headers: { cookie: crearCookieSesion() } }, res);
    const body = JSON.parse(res.body);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(body.suscripciones[0].organizacion_pagos.map((pago) => pago.id), ['pago-reciente', 'pago-antiguo']);
    assert.equal(body.suscripciones[0].organizacion_pagos[0].estado, 'comprobante_recibido');
  } finally {
    supabase.from = fromOriginal;
  }
});

test('la API rechaza offsets inválidos antes de consultar la base', async () => {
  let consultas = 0;
  supabase.from = () => { consultas += 1; throw new Error('no debe consultar'); };
  const res = response();
  await endpoint({ method: 'GET', query: { offset: '-1' }, headers: { cookie: crearCookieSesion() } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(consultas, 0);
});

test('la administración devuelve conflicto si la base bloquea un periodo histórico no ofrecido', async () => {
  const rpcOriginal = supabase.rpc;
  let llamada;
  supabase.rpc = async (...args) => {
    llamada = args;
    return { data: null, error: { code: '23514', message: 'Esta solicitud usa un periodo histórico no ofrecido.' } };
  };
  try {
    const res = response();
    await endpoint({
      method: 'PATCH',
      query: {},
      headers: { cookie: crearCookieSesion() },
      body: { id: 'suscripcion-historica', accion: 'activar' },
    }, res);
    assert.equal(res.statusCode, 409);
    assert.match(JSON.parse(res.body).error, /periodo histórico no ofrecido/i);
    assert.equal(llamada[0], 'organizacion_admin_resolver_solicitud');
    assert.deepEqual(llamada[1], {
      p_suscripcion_id: 'suscripcion-historica',
      p_accion: 'activar',
      p_admin: 'admin@example.test',
    });
  } finally {
    supabase.rpc = rpcOriginal;
  }
});
