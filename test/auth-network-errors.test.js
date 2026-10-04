import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const login = await readFile(new URL('../app/acceso/page.js', import.meta.url), 'utf8');
const recovery = await readFile(new URL('../app/recuperar/page.js', import.meta.url), 'utf8');
const activation = await readFile(new URL('../app/activar/page.js', import.meta.url), 'utf8');
const registration = await readFile(new URL('../app/registro/page.js', import.meta.url), 'utf8');

test('el inicio de sesión maneja caída de red y evita solicitudes duplicadas', () => {
  assert.match(login, /async function enviar\(evento\)[\s\S]*?if \(enviando\) return/);
  assert.match(login, /catch \{\s*setEstado\('No pudimos conectar con el servidor/);
  assert.match(login, /respuesta\.json\(\)\.catch\(\(\) => \(\{\}\)\)/);
  assert.match(login, /disabled=\{enviando\}/);
});

test('recuperación maneja errores de red tanto al pedir enlace como al cambiar contraseña', () => {
  assert.match(recovery, /async function enviar\(evento\)[\s\S]*?try\s*\{/);
  assert.match(recovery, /if \(modo === 'solicitar'\)[\s\S]*?catch \{[\s\S]*?No pudimos conectar con el servidor/);
  assert.match(recovery, /No pudimos confirmar el cambio de contraseña/);
  assert.match(recovery, /finally\s*\{\s*setEnviando\(false\)/);
  assert.match(recovery, /disabled=\{enviando\}/);
});

test('activación e invitación no dejan promesas de red sin manejar ni permiten doble envío', () => {
  assert.match(activation, /async function enviar\(evento\)[\s\S]*?if \(procesando\) return/);
  assert.match(activation, /catch \{\s*setEstado\('No pudimos confirmar esta acción por un problema de conexión/);
  assert.match(activation, /finally\s*\{\s*setProcesando\(false\)/);
  assert.match(activation, /disabled=\{procesando\}/);
});

test('registro bloquea envíos simultáneos y queda bloqueado tras aceptar la solicitud', () => {
  assert.match(registration, /const \[enviando, setEnviando\] = useState\(false\)/);
  assert.match(registration, /const \[registroAceptado, setRegistroAceptado\] = useState\(false\)/);
  assert.match(registration, /const envioEnCurso = useRef\(false\)/);
  assert.match(registration, /if \(envioEnCurso\.current \|\| registroAceptado\) return/);
  assert.match(registration, /finally\s*\{\s*envioEnCurso\.current = false;\s*setEnviando\(false\)/);
  assert.match(registration, /disabled=\{enviando \|\| registroAceptado\}/);
});
