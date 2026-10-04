import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pagina = await readFile(new URL('../app/plantas/page.js', import.meta.url), 'utf8');
const api = await readFile(new URL('../api/planta/plantas.js', import.meta.url), 'utf8');
const sesion = await readFile(new URL('../lib/sesion-navegador.js', import.meta.url), 'utf8');
const estilos = await readFile(new URL('../public/css/styles.css', import.meta.url), 'utf8');

test('selector de plantas presenta opciones con botones de ancho completo y estilo del producto', () => {
  assert.match(pagina, /className="plant-list"/);
  assert.match(pagina, /className="plant-choice"/);
  assert.match(estilos, /\.plant-picker-card\s*\{\s*width:\s*min\(720px,\s*100%\)/);
  assert.match(estilos, /\.plant-list\s*\{[^}]*display:\s*grid;[^}]*width:\s*100%/);
  assert.match(estilos, /\.plant-choice\s*\{[^}]*width:\s*100%;[^}]*background:\s*rgba\(16,21,28,\.72\)/);
  assert.match(estilos, /\.plant-choice:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--accent-amber\)/);
});

test('las tarjetas de acceso y selector no quedan centradas fuera de ventanas bajas', () => {
  assert.match(estilos, /@media\s*\(max-height:\s*760px\)\s*\{\s*\.auth-page\s*\{[^}]*min-height:\s*100svh;[^}]*align-items:\s*start;/);
});

test('los campos de autenticación y onboarding conservan un foco de teclado claramente visible', () => {
  assert.match(estilos, /\.auth-form input:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--accent-amber\);[^}]*outline-offset:\s*2px/);
  assert.match(estilos, /\.onboarding-section input[^\n]*focus-visible,[\s\S]*?\.onboarding-section textarea:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--accent-amber\)/);
  assert.match(estilos, /\.app__account-link:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--accent-amber\)/);
});

test('formulario para agregar otra planta conserva ancho legible y botón compacto', () => {
  assert.match(pagina, /className="onboarding-section plant-create"/);
  assert.match(estilos, /\.plant-create\s*\{\s*width:\s*100%;\s*margin-top:\s*22px;/);
  assert.match(estilos, /\.plant-create > \.btn\s*\{\s*justify-self:\s*start;\s*min-width:\s*160px/);
});

test('el alta de plantas explica y deshabilita la acción si el plan o la cuota no la permiten', () => {
  assert.match(api, /exigirPlanActivo\(sesion, 'multiplanta'\)/);
  assert.match(api, /puede_agregar_planta: disponible/);
  assert.match(api, /puede_crear_planta: esPropietario && disponibilidad\.puede_agregar_planta/);
  assert.match(api, /es_propietario_cuenta !== true/);
  assert.match(api, /PLAN_FEATURE_REQUIRED/);
  assert.match(api, /motivo_agregar_planta:/);
  assert.match(pagina, /typeof body\.puede_agregar_planta !== 'boolean'/);
  assert.match(pagina, /motivo_agregar_planta: String\(body\.motivo_agregar_planta || ''\)/);
  assert.match(pagina, /puede_crear_planta/);
  assert.match(pagina, /es_propietario_cuenta \? <form/);
  assert.match(pagina, /es_admin_cuenta \? <section/);
});

test('los errores de red al cambiar o crear planta son recuperables y no dejan la pantalla bloqueada', () => {
  assert.match(pagina, /const actual = leerSesionNavegador\(\)/);
  assert.match(sesion, /export function leerSesionNavegador\(\)/);
  assert.match(pagina, /async function seleccionar\(planta\)[\s\S]*?catch \(error\)[\s\S]*?setOcupado\(false\)/);
  assert.match(pagina, /async function agregar\(evento\)[\s\S]*?let creada = false[\s\S]*?catch \(error\)[\s\S]*?Recarga la lista de plantas antes de volver a intentarlo/);
  assert.match(pagina, /La planta se creó, pero no pudimos terminar de abrirla/);
});

test('plantas no muestra caché ni formulario de alta hasta confirmar acceso con el servidor', () => {
  assert.match(pagina, /const \[estadoCarga, setEstadoCarga\] = useState\('cargando'\)/);
  assert.match(pagina, /if \(!respuesta\.ok\) throw Object\.assign\(new Error\(body\.error \|\| 'No pudimos cargar tus plantas\.'\), \{ status: respuesta\.status \}\)/);
  assert.match(pagina, /estadoCarga === 'permitido' \? <>[\s\S]*?className="plant-list"[\s\S]*?className="onboarding-section plant-create"/);
  assert.match(pagina, /error\.status === 401[\s\S]*?returnTo=%2Fplantas/);
  assert.match(pagina, /estadoCarga === 'denegado'[\s\S]*?estadoCarga === 'error'[\s\S]*?Reintentar/);
});

test('selector de plantas valida la respuesta de perfil y maneja almacenamiento bloqueado', () => {
  assert.match(pagina, /if \(!cuerpo\.perfil \|\| !Array\.isArray\(cuerpo\.plantas_disponibles\)\)/);
  assert.match(pagina, /cuerpo\.perfil\.planta_id !== planta\.planta_id/);
  assert.match(pagina, /function destinoDePlanta\(perfil\)/);
  assert.match(pagina, /direccion: '\/direccion', finanzas: '\/direccion', operaciones: '\/operaciones', operador: '\/operador'/);
  assert.match(pagina, /tokensVigentesDeSesion\(cuenta\)/);
  assert.match(pagina, /guardarSesionNavegador\(actualizado\)/);
  assert.match(pagina, /el navegador bloqueó guardar la sesión/i);
  assert.match(pagina, /La planta se creó, pero el navegador bloqueó guardar la sesión/);
});

test('volver desde el selector conserva el tablero correspondiente al rol activo', () => {
  assert.match(pagina, /const destinoRegreso = destinoDePlanta\(cuenta\?\.perfil\) \|\| '\/acceso';/);
  assert.equal((pagina.match(/href=\{destinoRegreso\}/g) || []).length, 2,
    'el enlace de error y el pie de página deben usar el mismo destino seguro');
  assert.match(pagina, /operaciones: '\/operaciones', operador: '\/operador'/);
});

function luminancia(hex) {
  const rgb = hex.slice(1).match(/.{2}/g).map((canal) => parseInt(canal, 16) / 255)
    .map((canal) => canal <= 0.04045 ? canal / 12.92 : ((canal + 0.055) / 1.055) ** 2.4);
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

test('los textos técnicos muted cumplen contraste WCAG AA en paneles y campos', () => {
  const tokens = estilos.match(/:root\s*\{([\s\S]*?)\}/)?.[1] || '';
  const token = (nombre) => tokens.match(new RegExp(`--${nombre}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1];
  const texto = token('text-muted');
  assert.ok(texto, 'debe existir el token --text-muted');
  for (const nombreFondo of ['bg-base', 'bg-panel', 'bg-panel-alt']) {
    const fondo = token(nombreFondo);
    assert.ok(fondo, `debe existir el token --${nombreFondo}`);
    const a = luminancia(texto);
    const b = luminancia(fondo);
    const contraste = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    assert.ok(contraste >= 4.5, `--text-muted sobre --${nombreFondo}: ${contraste.toFixed(2)}:1`);
  }
});
