import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PASSWORD_MIN_LENGTH, passwordTieneLongitudInvalida } from '../lib/password.js';

const source = await readFile(new URL('../app/recuperar/page.js', import.meta.url), 'utf8');
const helper = source.match(/export function estadoEnlaceRecuperacion\(url\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(helper, 'Debe existir el validador de errores del callback de recuperación.');
const estadoEnlaceRecuperacion = new Function(`${helper.replace('export function', 'function')}; return estadoEnlaceRecuperacion;`)();

test('rechaza errores de Supabase en el hash o query aunque exista access_token', () => {
  for (const url of [
    'http://localhost:3000/recuperar#access_token=abc&error=access_denied',
    'http://localhost:3000/recuperar#error_code=otp_expired&error_description=Link+is+invalid',
    'http://localhost:3000/recuperar?error=access_denied#access_token=abc',
  ]) assert.equal(estadoEnlaceRecuperacion(url), 'invalido');
});

test('no considera válido un token solo por estar presente', () => {
  assert.equal(estadoEnlaceRecuperacion('http://localhost:3000/recuperar#access_token=abc'), 'esperando');
  assert.equal(estadoEnlaceRecuperacion('http://localhost:3000/recuperar'), 'esperando');
});

test('conserva la activación del formulario solo ante PASSWORD_RECOVERY con sesión', () => {
  assert.match(source, /evento === 'PASSWORD_RECOVERY' && sesion\?\.access_token/);
  assert.doesNotMatch(source, /window\.location\.hash\.includes\('access_token'\)/);
  assert.match(source, /flowType: parametros\.has\('code'\) \? 'pkce' : 'implicit'/);
  assert.match(source, /detectSessionInUrl: true/);
  assert.match(source, /Solicitar un enlace nuevo/);
  assert.match(source, /Si el correo está asociado a una cuenta/);
});

test('recuperación y registro comparten mínimo de contraseña y bloquean antes de actualizar Auth', async () => {
  assert.equal(PASSWORD_MIN_LENGTH, 10);
  assert.equal(passwordTieneLongitudInvalida('123456789'), true);
  assert.equal(passwordTieneLongitudInvalida('1234567890'), false);
  const cuenta = await readFile(new URL('../lib/cuenta.js', import.meta.url), 'utf8');
  assert.match(cuenta, /passwordTieneLongitudInvalida\(password\)/);
  assert.match(source, /passwordTieneLongitudInvalida\(datos\.password\)/);
  assert.ok(source.indexOf('passwordTieneLongitudInvalida(datos.password)') < source.indexOf('supabase.auth.updateUser'));
  assert.match(source, /minLength=\{PASSWORD_MIN_LENGTH\}/);
});
