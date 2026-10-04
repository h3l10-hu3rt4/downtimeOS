import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pagina = await readFile(new URL('../app/equipo/page.js', import.meta.url), 'utf8');
const registro = await readFile(new URL('../app/registro/page.js', import.meta.url), 'utf8');
const estilos = await readFile(new URL('../public/css/styles.css', import.meta.url), 'utf8');

test('equipo identifica Supabase local y dirige al buzón Mailpit sin confundirlo con correo externo', () => {
  assert.match(pagina, /fetch\('\/api\/config'\)/);
  assert.match(pagina, /urlMailpitLocal\(configuracion\?\.supabase_url\)/);
  assert.match(pagina, /href=\{urlBuzonLocal\}/);
  assert.doesNotMatch(pagina, /localhost:54324/);
  assert.match(pagina, /no llegan a Gmail ni Outlook/);
  assert.match(pagina, /Supabase aceptó la solicitud de correo/);
  assert.match(pagina, /Confirm your email address/);
  assert.match(pagina, /Solicitamos el envío del enlace de invitación/);
  assert.match(estilos, /\.team-email-note\s*\{/);
  assert.match(registro, /urlMailpitLocal\(configuracion\?\.supabase_url\)/);
  assert.match(registro, /href=\{urlBuzonLocal\}/);
  assert.doesNotMatch(registro, /localhost:54324/);
});

test('equipo no se queda verificando si fallan la red o el contrato de invitaciones', () => {
  assert.match(pagina, /respuesta\.json\(\)\.catch\(\(\) => null\)/);
  assert.match(pagina, /!Array\.isArray\(cuerpo\?\.invitaciones\)/);
  assert.match(pagina, /catch \(error\) \{[\s\S]*?setAccesoEquipo\(error\.status === 403 \? 'denegado' : 'error'\)/);
  assert.match(pagina, /location\.replace\('\/acceso\?returnTo=%2Fequipo'\)/);
  assert.match(pagina, /accesoEquipo === 'error'[\s\S]*?No pudimos validar el acceso[\s\S]*?Reintentar/);
});

test('equipo regresa al tablero de su rol, también para un delegado de Operaciones', () => {
  assert.match(pagina, /import \{ destinoTablero \} from '\.\.\/acceso\/return-to\.js'/);
  assert.match(pagina, /setDestinoRetorno\(destinoTablero\(cuenta\.perfil\) \|\| '\/acceso'\)/);
  assert.equal((pagina.match(/href=\{destinoRetorno\}/g) || []).length, 2);
  assert.doesNotMatch(pagina, /href="\/direccion"[^\n]*(?:Volver al tablero|Omitir por ahora)/);
});
