import test from 'node:test';
import assert from 'node:assert/strict';
import { reenviarConfirmacionConDependencias } from '../lib/cuenta.js';
import { readFile } from 'node:fs/promises';

process.env.APP_ENV = 'development';
process.env.APP_URL = 'http://localhost:3000';

test('reenvía confirmación con enlace de activación y normaliza el correo', async () => {
  let solicitud;
  const authPublico = { auth: { resend: async (valor) => { solicitud = valor; return { error: null }; } } };
  const resultado = await reenviarConfirmacionConDependencias('  Persona@Empresa.com  ', { authPublico });
  assert.deepEqual(resultado, { enviado: true });
  assert.equal(solicitud.type, 'signup');
  assert.equal(solicitud.email, 'persona@empresa.com');
  assert.equal(solicitud.options.emailRedirectTo, 'http://localhost:3000/activar');
});

test('rechaza formato inválido sin llamar a Auth', async () => {
  let llamadas = 0;
  const authPublico = { auth: { resend: async () => { llamadas += 1; return { error: null }; } } };
  await assert.rejects(() => reenviarConfirmacionConDependencias('no-es-correo', { authPublico }), /formato válido/);
  assert.equal(llamadas, 0);
});

test('muestra un mensaje controlado ante rate limit de Supabase', async () => {
  const authPublico = { auth: { resend: async () => ({ error: { status: 429, code: 'over_email_send_rate_limit' } }) } };
  await assert.rejects(async () => reenviarConfirmacionConDependencias('persona@empresa.com', { authPublico }), (error) => {
    assert.equal(error.status, 429);
    assert.match(error.message, /Espera un momento/);
    return true;
  });
});

test('la API expone una acción de reenvío sin filtrar credenciales', async () => {
  const api = await readFile(new URL('../api/cuenta/index.js', import.meta.url), 'utf8');
  assert.match(api, /cuerpo\.accion === 'reenviar-confirmacion'/);
  assert.match(api, /reenviarConfirmacionRegistro\(cuerpo\.email\)/);
});

test('registro ofrece reenvío controlado solo después de requerir confirmación', async () => {
  const page = await readFile(new URL('../app/registro/page.js', import.meta.url), 'utf8');
  assert.match(page, /requiereConfirmacion \? <button[\s\S]*Reenviar correo de confirmación/);
  assert.match(page, /accion: 'reenviar-confirmacion', email: emailRegistro/);
  assert.match(page, /Si la cuenta todavía necesita confirmación, se envió un nuevo enlace/);
  assert.match(page, /disabled=\{reenviando \|\| !emailRegistro\}/);
});

test('registro local explica que el enlace va a Mailpit y el reenvío usa el correo corregido', async () => {
  const page = await readFile(new URL('../app/registro/page.js', import.meta.url), 'utf8');
  assert.match(page, /buzonLocal\s*\?\s*'Solicitud recibida\.[\s\S]*revisa Mailpit[\s\S]*no llegará a tu bandeja personal/);
  assert.match(page, /onChange=\{\(evento\) => setEmailRegistro\(evento\.currentTarget\.value\)\}/);
  assert.match(page, /buzonLocal\s*\?\s*'Solicitud procesada\.[\s\S]*el enlace aparecerá en Mailpit/);
});
