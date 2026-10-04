import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const estructura = await readFile(new URL('../app/estructura/page.js', import.meta.url), 'utf8');
const suscripcionCliente = await readFile(new URL('../app/suscripcion/page.js', import.meta.url), 'utf8');
const suscripciones = await readFile(new URL('../app/administracion/suscripciones/panel.js', import.meta.url), 'utf8');
const estilos = await readFile(new URL('../public/css/styles.css', import.meta.url), 'utf8');

test('estructura guía a crear la primera línea cuando no hay ninguna', () => {
  assert.match(estructura, /lineas\.length \? <div className="account-list">/);
  assert.match(estructura, /Aún no hay líneas de producción/);
  assert.match(estructura, /Agrega la primera línea para organizar los equipos/);
  assert.match(estructura, /href="#nueva-linea">Ir a agregar línea/);
  assert.match(estructura, /id="nueva-linea"/);
  assert.match(estilos, /\.account-empty-state\s*\{/);
});

test('estructura explica qué hacer si faltan equipos y prioriza crear una línea', () => {
  assert.match(estructura, /Aún no hay equipos registrados/);
  assert.match(estructura, /Primero crea una línea de producción/);
  assert.match(estructura, /href=\{lineasActivas\.length \? '#nuevo-equipo' : '#nueva-linea'\}/);
  assert.match(estructura, /id="nuevo-equipo"/);
  assert.match(estructura, /role="status">Cargando equipos…/);
});

test('estructura apila el encabezado y los formularios en móviles estrechos', () => {
  assert.match(estilos, /@media\s*\(max-width:\s*560px\)[\s\S]*?\.account-page__header\s*\{[^}]*flex-direction:\s*column/);
  assert.match(estilos, /\.account-grid-form\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(estilos, /\.account-page__header\s*>\s*\.btn\s*\{[^}]*white-space:\s*normal/);
});

test('controles de estructura usan menú oscuro y foco visible accesible', () => {
  assert.match(estilos, /\.account-grid-form select\s*\{\s*color-scheme:\s*dark;\s*\}/);
  assert.match(estilos, /\.account-inline-form input:focus-visible,\s*\.account-grid-form input:focus-visible,\s*\.account-grid-form select:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--accent-amber\)/);
});

test('solicitud inicial pendiente puede cancelarse desde autoservicio de facturación', () => {
  assert.match(suscripcionCliente, /const solicitudInicialPendiente = datos\.suscripciones\.find\(\(s\) => !s\.periodo_programado/);
  assert.match(suscripcionCliente, /<h2 id="billing-pending-request-title">Solicitud de plan pendiente<\/h2>/);
  assert.match(suscripcionCliente, /cancelar\(solicitudInicialPendiente\.id\)/);
  assert.match(suscripcionCliente, /Cancelar solicitud pendiente/);
  assert.match(suscripcionCliente, /la cancelación no procesa una devolución/);
});

test('formularios de acceso y recuperación indican autocompletado de credenciales', async () => {
  const acceso = await readFile(new URL('../app/acceso/page.js', import.meta.url), 'utf8');
  const registro = await readFile(new URL('../app/registro/page.js', import.meta.url), 'utf8');
  const recuperar = await readFile(new URL('../app/recuperar/page.js', import.meta.url), 'utf8');
  assert.match(acceso, /name="email"[^>]*autoComplete="email"/);
  assert.match(acceso, /name="password"[^>]*autoComplete="current-password"/);
  assert.match(registro, /name="password"[^>]*autoComplete="new-password"/);
  assert.match(recuperar, /name="email"[^>]*autoComplete="email"/);
  assert.match(recuperar, /name="password"[^>]*autoComplete="new-password"/);
});

test('panel de suscripciones presenta error accesible y permite reintentar la carga', () => {
  assert.match(suscripciones, /className="admin-billing-load-error" role="alert"/);
  assert.match(suscripciones, /Reintentar carga de solicitudes/);
  assert.match(suscripciones, /disabled=\{cargando\}/);
  assert.match(suscripciones, /role="status" aria-live="polite">Cargando solicitudes…/);
  assert.match(suscripciones, /aria-live="polite" aria-atomic="true"/);
  assert.match(estilos, /\.admin-billing-load-error\s*\{/);
});

test('cargas simultáneas de solicitudes comparten promesa y la recarga forzada invalida la anterior', () => {
  assert.match(suscripciones, /const controlCarga = useRef\(null\)/);
  assert.match(suscripciones, /controlCarga\.current\.ejecutar\(async \(\{ esVigente \}\)/);
  assert.match(suscripciones, /if \(!esVigente\(\)\) return/);
  assert.match(suscripciones, /crearControlCarga/);
});
