import test from 'node:test';
import assert from 'node:assert/strict';
import { solicitarRecuperacion } from '../lib/cuenta.js';

process.env.APP_ENV = 'development';
process.env.APP_URL = 'http://localhost:3000';

test('solicita recuperación con cliente público y callback local correcto', async () => {
  let solicitud;
  const authPublico = { auth: { resetPasswordForEmail: async (email, options) => {
    solicitud = { email, options };
    return { error: null };
  } } };
  assert.deepEqual(await solicitarRecuperacion(' Persona@Empresa.com ', { authPublico }), { enviado: true });
  assert.deepEqual(solicitud, {
    email: 'persona@empresa.com',
    options: { redirectTo: 'http://localhost:3000/recuperar' },
  });
});

test('rechaza el correo inválido antes de contactar Supabase Auth', async () => {
  let llamadas = 0;
  const authPublico = { auth: { resetPasswordForEmail: async () => { llamadas += 1; return { error: null }; } } };
  await assert.rejects(() => solicitarRecuperacion('no-es-correo', { authPublico }), /formato válido/);
  assert.equal(llamadas, 0);
});

test('normaliza el rechazo de Auth sin revelar si la cuenta existe', async () => {
  const authPublico = { auth: { resetPasswordForEmail: async () => ({ error: new Error('User not found') }) } };
  await assert.rejects(() => solicitarRecuperacion('persona@empresa.com', { authPublico }), (error) => {
    assert.equal(error.status, 400);
    assert.equal(error.message, 'No fue posible enviar el correo de recuperación.');
    assert.doesNotMatch(error.message, /not found|no existe/i);
    return true;
  });
});

test('convierte errores de transporte de Auth en respuesta recuperable 503', async () => {
  const authPublico = { auth: { resetPasswordForEmail: async () => { throw new Error('fetch failed'); } } };
  await assert.rejects(() => solicitarRecuperacion('persona@empresa.com', { authPublico }), (error) => {
    assert.equal(error.status, 503);
    assert.equal(error.message, 'No fue posible enviar el correo de recuperación.');
    return true;
  });
});
