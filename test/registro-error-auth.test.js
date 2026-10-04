import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Puerto local cerrado: el fallo de Auth es determinista y no puede alcanzar
// Supabase remoto ni crear una cuenta o enviar un correo.
process.env.SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_PUBLISHABLE_KEY = 'test-key-no-valida-fuera-del-test';
process.env.APP_ENV = 'development';
process.env.APP_URL = 'http://localhost:3000';

const endpointCuenta = (await import('../api/cuenta/index.js')).default;
const { validarRegistro } = await import('../lib/cuenta.js');

test('el registro rechaza nombres de empresa o planta de un carácter antes de crear Auth', () => {
  const base = {
    email: 'prueba@downtimeos.test', password: 'Clave-de-prueba-2026', nombre: 'Persona Prueba',
    empresa: 'Empresa', planta: 'Durango',
  };
  assert.throws(() => validarRegistro({ ...base, empresa: 'A' }), /al menos 2 caracteres/);
  assert.throws(() => validarRegistro({ ...base, planta: 'P' }), /al menos 2 caracteres/);
});

test('el alta B2B rechaza correos personales antes de llamar a Supabase y permite un correo sintético local', () => {
  const base = {
    email: 'prueba@empresa.example', password: 'Clave-de-prueba-2026', nombre: 'Persona Prueba',
    empresa: 'Empresa', planta: 'Durango',
  };
  for (const email of ['persona@gmail.com', 'persona@hotmail.com', 'persona@outlook.com', 'persona@yahoo.com']) {
    assert.throws(() => validarRegistro({ ...base, email }), /correo corporativo.*no son aceptados/i);
  }
  assert.doesNotThrow(() => validarRegistro({ ...base, email: 'tester-01@downtimeos.test' }));
});

test('el formulario comunica el mínimo que también valida el servidor', async () => {
  const registro = await readFile(new URL('../app/registro/page.js', import.meta.url), 'utf8');
  assert.match(registro, /name="empresa"[^>]*minLength="2"/);
  assert.match(registro, /name="planta"[^>]*minLength="2"/);
});

test('la API explica el rechazo B2B antes de llamar a Supabase Auth', async () => {
  const respuesta = {
    headers: {},
    setHeader(clave, valor) { this.headers[clave] = valor; },
    status(codigo) { this.statusCode = codigo; return this; },
    send(cuerpo) { this.body = cuerpo; return this; },
    end() { this.termino = true; return this; },
  };
  await endpointCuenta({ method: 'POST', body: {
    accion: 'registro', email: 'persona@gmail.com', password: 'Clave-de-prueba-2026',
    nombre: 'Persona Prueba', empresa: 'Empresa Prueba', planta: 'Planta Prueba',
  } }, respuesta);
  assert.equal(respuesta.statusCode, 400);
  assert.match(JSON.parse(respuesta.body).error, /correo corporativo.*no son aceptados/i);
});

test('el endpoint de registro devuelve un error de servicio claro si Auth no responde por red', async () => {
  const errorOriginal = console.error;
  console.error = () => {};
  try {
    const respuesta = {
      headers: {},
      setHeader(clave, valor) { this.headers[clave] = valor; },
      status(codigo) { this.statusCode = codigo; return this; },
      send(cuerpo) { this.body = cuerpo; return this; },
      end() { this.termino = true; return this; },
    };
    await endpointCuenta({
      method: 'POST',
      body: {
        accion: 'registro',
        email: 'prueba@downtimeos.test',
        password: 'Clave-de-prueba-2026',
        nombre: 'Prueba',
        empresa: 'Empresa Prueba',
        planta: 'Planta Prueba',
      },
    }, respuesta);
    assert.equal(respuesta.statusCode, 503);
    const cuerpo = JSON.parse(respuesta.body);
    assert.equal(cuerpo.ok, false);
    assert.match(cuerpo.error, /No pudimos confirmar el resultado del registro/);
    assert.match(cuerpo.error, /antes de volver a registrarte/);
    assert.doesNotMatch(cuerpo.error, /Error interno del servidor/);
  } finally {
    console.error = errorOriginal;
  }
});
