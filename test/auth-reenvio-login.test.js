import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('tras credenciales rechazadas el acceso ofrece reenviar confirmación sin revelar si el correo existe', async () => {
  const page = await readFile(new URL('../app/acceso/page.js', import.meta.url), 'utf8');
  assert.match(page, /setMostrarReenvio\(respuesta\.status === 401\)/);
  assert.match(page, /¿No confirmaste tu correo\? Reenviar enlace/);
  assert.match(page, /Si la cuenta necesita confirmación, recibirás un enlace en ese correo/);
  assert.match(page, /accion: 'reenviar-confirmacion', email/);
  assert.match(page, /disabled=\{reenviando \|\| !email\}/);
});
