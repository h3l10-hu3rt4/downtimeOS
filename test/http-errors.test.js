import test from 'node:test';
import assert from 'node:assert/strict';
import { ruta } from '../lib/http.js';

function responseCapturada() {
  const headers = {};
  return {
    headers,
    statusCode: 200,
    body: null,
    setHeader(name, value) { headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    send(value) { this.body = value; return this; },
    end() { return this; },
  };
}

test('registra errores 5xx sin llenar los logs con rechazos HTTP esperados', async () => {
  const original = console.error;
  const logs = [];
  console.error = (...args) => logs.push(args);
  try {
    const noAutorizado = responseCapturada();
    await ruta(['GET'], async () => {
      const error = new Error('Sesión requerida.');
      error.status = 401;
      throw error;
    })({ method: 'GET' }, noAutorizado);

    assert.equal(noAutorizado.statusCode, 401);
    assert.equal(JSON.parse(noAutorizado.body).error, 'Sesión requerida.');
    assert.equal(logs.length, 0);

    const fallaServidor = responseCapturada();
    await ruta(['GET'], async () => { throw new Error('detalle interno'); })({ method: 'GET' }, fallaServidor);

    assert.equal(fallaServidor.statusCode, 500);
    assert.equal(JSON.parse(fallaServidor.body).error, 'Error interno del servidor.');
    assert.equal(logs.length, 1);
    assert.match(logs[0][0], /error no controlado/);
  } finally {
    console.error = original;
  }
});
