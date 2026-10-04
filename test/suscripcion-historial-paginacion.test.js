import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const { supabase } = await import('../lib/supabase.js');
const endpoint = (await import('../api/planta/suscripcion.js')).default;
const ui = await readFile(new URL('../app/suscripcion/page.js', import.meta.url), 'utf8');

function respuesta() {
  return {
    headers: {},
    setHeader(nombre, valor) { this.headers[nombre] = valor; },
    status(codigo) { this.statusCode = codigo; return this; },
    send(body) { this.body = body; return this; },
    end() { return this; },
  };
}

function consultaMock(tabla, rangos, { offsetSubscripciones = 50, filasPago = 105 } = {}) {
  const consulta = { tabla, actualizacion: false, seleccion: false, prioritaria: false, desde: 0 };
  consulta.update = () => { consulta.actualizacion = true; return consulta; };
  consulta.select = () => { consulta.seleccion = true; return consulta; };
  for (const metodo of ['eq', 'in', 'not', 'lte', 'order']) consulta[metodo] = () => consulta;
  consulta.limit = () => { consulta.prioritaria = true; return consulta; };
  consulta.range = (desde) => { consulta.desde = desde; rangos.push([tabla, desde]); return consulta; };
  consulta.maybeSingle = async () => ({ data: null, error: null });
  consulta.then = (resolve, reject) => Promise.resolve().then(() => {
    if (consulta.actualizacion) return { data: [], error: null };
    if (tabla === 'planta_membresias') return {
      data: [{ user_id: 'usuario-1', organizacion_id: 'org-1', planta_id: 'planta-1', rol: 'direccion', nombre: 'Titular', activo: true,
        organizaciones: { nombre: 'Empresa', propietario_id: 'usuario-1' }, plantas: { nombre: 'Planta', codigo: 'P-01' } }], error: null,
    };
    if (tabla === 'planes') return { data: [], error: null };
    if (tabla === 'organizacion_facturacion') return { data: null, error: null };
    if (tabla === 'plantas') return { data: null, count: 1, error: null };
    if (tabla === 'organizacion_suscripciones') {
      if (consulta.prioritaria) return { data: [{
        id: 'suscripcion-activa-antigua', plan_codigo: 'pro', estado: 'activa', periodicidad: 'anual', plantas_incluidas: 1,
        creada_en: '2020-01-01T00:00:00.000Z',
      }], error: null };
      const data = Array.from({ length: Math.max(0, 51 - offsetSubscripciones) }, (_, index) => ({
        id: `sub-${consulta.desde + index}`, plan_codigo: 'pro', estado: 'vencida', periodicidad: 'anual', plantas_incluidas: 1,
        creada_en: '2026-01-01T00:00:00.000Z',
      }));
      return { data, count: 51, error: null };
    }
    if (tabla === 'organizacion_pagos') {
      const cantidad = Math.min(100, Math.max(0, filasPago - consulta.desde));
      return { data: Array.from({ length: cantidad }, (_, index) => ({
        id: `pago-${consulta.desde + index}`, suscripcion_id: 'sub-50', estado: 'pendiente', importe: 10, moneda: 'USD',
        referencia: '', recibido_en: null, verificado_en: null, created_at: '2026-01-01T00:00:00.000Z', comprobante_path: null,
      })), error: null };
    }
    if (tabla === 'organizacion_pago_comprobante_intentos') return { data: [], error: null };
    throw new Error(`Tabla inesperada en prueba: ${tabla}`);
  }).then(resolve, reject);
  return consulta;
}

test('el historial de facturación pagina suscripciones y no trunca los pagos del lote', async () => {
  const rangos = [];
  supabase.auth = { getUser: async () => ({ data: { user: { id: 'usuario-1' } }, error: null }) };
  supabase.from = (tabla) => consultaMock(tabla, rangos);
  try {
    const res = respuesta();
    await endpoint({ method: 'GET', query: { offset: '50' }, headers: { authorization: 'Bearer token-prueba' } }, res);
    const body = JSON.parse(res.body);
    assert.equal(res.statusCode, 200);
    assert.equal(body.total_suscripciones, 51);
    assert.equal(body.offset_suscripciones, 50);
    assert.equal(body.siguiente_offset_suscripciones, 51);
    assert.equal(body.hay_mas_suscripciones, false);
    assert.equal(body.suscripciones.length, 2);
    assert.ok(body.suscripciones.some((suscripcion) => suscripcion.id === 'suscripcion-activa-antigua'));
    assert.equal(body.pagos.length, 105);
    assert.deepEqual(rangos.filter(([tabla]) => tabla === 'organizacion_suscripciones'), [['organizacion_suscripciones', 50]]);
    assert.deepEqual(rangos.filter(([tabla]) => tabla === 'organizacion_pagos'), [['organizacion_pagos', 0], ['organizacion_pagos', 100]]);
  } finally {
    delete supabase.auth;
    delete supabase.from;
  }
});

test('un offset inválido no ejecuta las actualizaciones de vencimiento', async () => {
  let actualizaciones = 0;
  supabase.auth = { getUser: async () => ({ data: { user: { id: 'usuario-1' } }, error: null }) };
  supabase.from = (tabla) => {
    const consulta = consultaMock(tabla, []);
    const actualizar = consulta.update;
    consulta.update = (...args) => { actualizaciones += 1; return actualizar(...args); };
    return consulta;
  };
  try {
    const res = respuesta();
    await endpoint({ method: 'GET', query: { offset: '-1' }, headers: { authorization: 'Bearer token-prueba' } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(actualizaciones, 0);
  } finally {
    delete supabase.auth;
    delete supabase.from;
  }
});

test('la vista muestra el progreso del historial y permite cargar suscripciones anteriores', () => {
  assert.match(ui, /Historial de suscripciones/);
  assert.match(ui, /Mostrando \{datos\.suscripciones\.length\} de \{datos\.total_suscripciones\}/);
  assert.match(ui, /Cargar 50 suscripciones anteriores/);
  assert.match(ui, /suscripcion\?offset=\$\{offset\}/);
  assert.match(ui, /const offset = datos\.siguiente_offset_suscripciones/);
  assert.match(ui, /pagos: \[\.\.\.actuales\.pagos, \.\.\.cuerpo\.pagos\.filter/);
});
