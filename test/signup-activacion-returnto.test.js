import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { destinoDeParametros, destinoRetornoSeguro, destinoTablero } from '../app/acceso/return-to.js';
import { copyEstadoActivacion } from '../lib/estado-activacion.js';

test('login solo honra los destinos internos explícitamente permitidos', () => {
  assert.equal(destinoRetornoSeguro('/configurar-planta'), '/configurar-planta');
  assert.equal(destinoRetornoSeguro('/estructura'), '/estructura');
  assert.equal(destinoRetornoSeguro('/equipo'), '/equipo');
  assert.equal(destinoRetornoSeguro('/plantas'), '/plantas');
  assert.equal(destinoRetornoSeguro('/suscripcion'), '/suscripcion');
  assert.equal(destinoRetornoSeguro('https://atacante.example'), null);
  assert.equal(destinoRetornoSeguro('//atacante.example'), null);
  assert.equal(destinoRetornoSeguro('/equipo?admin=1'), null);
  assert.equal(destinoRetornoSeguro('/plantas/otra'), null);
  assert.equal(destinoRetornoSeguro('/direccion'), '/direccion');
  assert.equal(destinoRetornoSeguro('/operaciones'), '/operaciones');
  assert.equal(destinoRetornoSeguro('/operador'), '/operador');
  assert.equal(destinoRetornoSeguro(null), null);
});

test('login no devuelve a cuentas ordinarias a pantallas restringidas por rol o permiso', () => {
  const operador = { rol: 'operador', es_admin_cuenta: false, es_propietario_cuenta: false, puede_administrar_facturacion: false };
  const direccion = { rol: 'direccion', es_admin_cuenta: true, es_propietario_cuenta: true, puede_administrar_facturacion: false };
  const finanzas = { rol: 'finanzas', es_admin_cuenta: false, es_propietario_cuenta: false, puede_administrar_facturacion: true };

  assert.equal(destinoRetornoSeguro('/equipo', operador), null);
  assert.equal(destinoRetornoSeguro('/estructura', operador), null);
  assert.equal(destinoRetornoSeguro('/configurar-planta', operador), null);
  assert.equal(destinoRetornoSeguro('/suscripcion', operador), null);
  assert.equal(destinoRetornoSeguro('/equipo', direccion), '/equipo');
  assert.equal(destinoRetornoSeguro('/configurar-planta', direccion), '/configurar-planta');
  assert.equal(destinoRetornoSeguro('/suscripcion', finanzas), '/suscripcion');
  assert.equal(destinoRetornoSeguro('/direccion', operador), '/direccion');
});

test('login conserva destinos antiguos de dashboards solo si están en la lista segura', () => {
  assert.equal(destinoDeParametros(new URLSearchParams('destino=%2Foperaciones')), '/operaciones');
  assert.equal(destinoDeParametros(new URLSearchParams('destino=operaciones')), '/operaciones');
  assert.equal(destinoDeParametros(new URLSearchParams('destino=finanzas')), '/direccion');
  assert.equal(destinoDeParametros(new URLSearchParams('destino=https%3A%2F%2Fattacker.example')), null);
  assert.equal(destinoDeParametros(new URLSearchParams('returnTo=%2Finvalida&destino=%2Foperaciones')), null);
});

test('tablero de regreso es único por rol y un rol desconocido no cae en Dirección', () => {
  assert.equal(destinoTablero({ rol: 'direccion' }), '/direccion');
  assert.equal(destinoTablero({ rol: 'admin' }), '/direccion');
  assert.equal(destinoTablero({ rol: 'finanzas' }), '/direccion');
  assert.equal(destinoTablero({ rol: 'operaciones' }), '/operaciones');
  assert.equal(destinoTablero({ rol: 'operador' }), '/operador');
  assert.equal(destinoTablero({ rol: 'rol-desconocido' }), null);
});

test('callback de signup ausente o vencido ofrece login con retorno al onboarding', async () => {
  const callback = await readFile(new URL('../app/activar/page.js', import.meta.url), 'utf8');
  const login = await readFile(new URL('../app/acceso/page.js', import.meta.url), 'utf8');
  assert.match(callback, /No recibimos un enlace de confirmación/);
  assert.match(callback, /El enlace de confirmación expiró o ya se utilizó/);
  assert.match(callback, /\/acceso\?returnTo=%2Fconfigurar-planta/);
  assert.match(callback, /Iniciar sesión para configurar mi planta/);
  assert.match(login, /destinoDeParametros\(/);
  assert.match(login, /destinoSolicitado\(cuerpo\.perfil\) \|\| destino\(/);
});

test('abrir activación sin callback no se presenta como enlace vencido', () => {
  const mensaje = copyEstadoActivacion({
    enlaceInvalido: true,
    flujoInvitacion: false,
    modoRegistro: true,
    estadoEnlace: 'incompleto',
  });
  assert.match(mensaje, /Abre el enlace de confirmación o de invitación/);
  assert.doesNotMatch(mensaje, /ya no se puede usar|expiró|venció/i);
});

test('invitaciones inválidas o vencidas indican pedir reenvío a quien invitó', async () => {
  const callback = await readFile(new URL('../app/activar/page.js', import.meta.url), 'utf8');
  assert.match(callback, /Esta invitación no es válida o ya venció\. Pide a la persona que te invitó que reenvíe el enlace/);
  assert.match(callback, /La invitación expiró o ya se utilizó\. Pide a la persona que te invitó que reenvíe el enlace/);
  const copy = await readFile(new URL('../lib/estado-activacion.js', import.meta.url), 'utf8');
  assert.match(copy, /if \(flujoInvitacion\) return 'Esta invitación ya no se puede usar/);
});

test('aceptar invitación valida la longitud de contraseña en cliente antes de llamar a Auth', async () => {
  const callback = await readFile(new URL('../app/activar/page.js', import.meta.url), 'utf8');
  assert.match(callback, /passwordTieneLongitudInvalida\(datos\.password\)/);
  assert.ok(callback.indexOf('passwordTieneLongitudInvalida(datos.password)') < callback.indexOf('cliente.auth.updateUser({ password: datos.password })'));
  assert.match(callback, /minLength=\{PASSWORD_MIN_LENGTH\}/);
  assert.match(callback, /Mínimo \$\{PASSWORD_MIN_LENGTH\} caracteres/);
});

test('error del proveedor, enlace sin sesión o configuración fallida terminan la validación con salida recuperable', async () => {
  const callback = await readFile(new URL('../app/activar/page.js', import.meta.url), 'utf8');
  assert.match(callback, /hayErrorProveedor/);
  assert.match(callback, /temporizadorCallback = setTimeout\(\(\) => \{/);
  assert.match(callback, /El enlace todavía podría ser válido/);
  assert.match(callback, /\}, 15000\)/);
  assert.doesNotMatch(callback, /\}, 3000\)/);
  assert.match(callback, /setEstadoEnlace\('error'\)/);
  assert.match(callback, /estadoFinal = 'invalido'/);
  assert.match(callback, /setEstadoEnlace\(estadoFinal\)/);
  assert.match(callback, /clearTimeout\(temporizadorCallback\)/);
  assert.match(callback, /estadoEnlace === 'error' \? <button[\s\S]*?Intentar de nuevo/);
  assert.match(callback, /estadoEnlace === 'validando' \? 'Validando enlace seguro…'/);
});

test('callback implicit procesa la sesión confirmada, persiste antes de navegar y deja retomar onboarding', async () => {
  const callback = await readFile(new URL('../app/activar/page.js', import.meta.url), 'utf8');
  const serverAccount = await readFile(new URL('../lib/cuenta.js', import.meta.url), 'utf8');

  assert.match(serverAccount, /flowType:\s*'implicit'/);
  assert.match(serverAccount, /crearUrlApp\('\/activar'\)\.toString\(\)/);
  assert.match(callback, /flowType:\s*parametros\.has\('code'\) \? 'pkce' : 'implicit'/);
  assert.match(callback, /detectSessionInUrl:\s*true/);
  assert.match(callback, /persistSession:\s*true/);
  assert.match(callback, /new URLSearchParams\(window\.location\.hash\.slice\(1\)\)/);
  assert.match(callback, /auth\.auth\.onAuthStateChange\(reconocer\)/);
  assert.match(callback, /if \(data\.session\) reconocer\('INITIAL_SESSION', data\.session\)/);

  const guardarSesion = callback.indexOf('guardarSesionNavegador(');
  const navegar = callback.indexOf('location.assign(destino)', guardarSesion);
  assert.ok(guardarSesion >= 0, 'guarda la sesión de la aplicación con manejo de almacenamiento bloqueado');
  assert.ok(navegar > guardarSesion, 'navega solo después de persistirla');
  assert.match(callback, /La invitación ya fue aceptada, pero el navegador bloqueó el almacenamiento de sesión/);
});

test('activación conserva tokens renovados durante la carga de la cuenta', async () => {
  const callback = await readFile(new URL('../app/activar/page.js', import.meta.url), 'utf8');
  assert.match(callback, /tokensVigentesDeSesion/);
  assert.match(callback, /user: session\.user/);
  assert.equal((callback.match(/tokensVigentesDeSesion\(session\)/g) || []).length, 2);
  assert.doesNotMatch(callback, /\.\.\.cuenta, access_token: session\.access_token, refresh_token: session\.refresh_token/);
  assert.match(callback, /destinoTablero\(cuenta\.perfil\)/);
  assert.match(callback, /destinoTablero\(cuentaAceptada\.perfil\)/);
});

test('registro local dirige a Mailpit solo cuando Supabase requiere confirmación', async () => {
  const registro = await readFile(new URL('../app/registro/page.js', import.meta.url), 'utf8');
  assert.match(registro, /fetch\('\/api\/config'\)/);
  assert.match(registro, /urlMailpitLocal\(configuracion\?\.supabase_url\)/);
  assert.match(registro, /setRequiereConfirmacion\(true\)/);
  assert.match(registro, /requiereConfirmacion \? <>[\s\S]*\{buzonLocal \? <p className="team-email-note" role="note">[\s\S]*Mailpit/);
  assert.match(registro, /href=\{urlBuzonLocal\}/);
  assert.doesNotMatch(registro, /localhost:54324/);
  assert.match(registro, /no se envía a Gmail ni Outlook/);
});

test('registro aceptado sin sesión nunca deja al usuario sin siguiente paso', async () => {
  const registro = await readFile(new URL('../app/registro/page.js', import.meta.url), 'utf8');
  assert.match(registro, /setRegistroAceptado\(true\)/);
  assert.match(registro, /setRequiereInicioSesion\(true\)/);
  assert.match(registro, /!cuerpo\.access_token \|\| !cuerpo\.perfil/);
  assert.match(registro, /registroAceptado && \(requiereConfirmacion \|\| requiereInicioSesion\)/);
  assert.match(registro, /href="\/acceso\?returnTo=%2Fconfigurar-planta"/);
  assert.match(registro, /Iniciar sesión para configurar mi planta/);
});

test('registro protege el POST contra doble envío mientras procesa y tras aceptación', async () => {
  const registro = await readFile(new URL('../app/registro/page.js', import.meta.url), 'utf8');
  assert.match(registro, /const envioEnCurso = useRef\(false\)/);
  assert.match(registro, /if \(envioEnCurso\.current \|\| registroAceptado\) return/);
  assert.match(registro, /envioEnCurso\.current = true/);
  assert.match(registro, /envioEnCurso\.current = false/);
  assert.match(registro, /disabled=\{enviando \|\| registroAceptado\}/);
});
