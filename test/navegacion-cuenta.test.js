import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const sesionSource = await readFile(new URL('../public/demo/js/sesion.js', import.meta.url), 'utf8');
const direccion = await readFile(new URL('../public/demo/direccion.html', import.meta.url), 'utf8');
const equipo = await readFile(new URL('../app/equipo/page.js', import.meta.url), 'utf8');
const estilos = await readFile(new URL('../public/css/styles.css', import.meta.url), 'utf8');
const landing = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const legacyClient = await readFile(new URL('../app/_components/LegacyPageClient.js', import.meta.url), 'utf8');

test('la barra de producto muestra accesos de equipo y facturación solo con permiso', () => {
  assert.match(sesionSource, /puedeAdministrarEquipo: Boolean\(perfil\.es_propietario_cuenta \|\| perfil\.es_admin_cuenta\)/);
  assert.match(sesionSource, /puedeVerFacturacion: Boolean\(perfil\.es_propietario_cuenta \|\| perfil\.puede_administrar_facturacion\)/);
  assert.match(sesionSource, /mostrarEquipo \? '<a class="app__account-link" href="\/equipo">Equipo/);
  assert.match(sesionSource, /mostrarFacturacion \? '<a class="app__account-link" href="\/suscripcion">Suscripción y pagos/);
  assert.match(estilos, /\.app__account-links\s*\{[^}]*display:\s*flex/);
});

test('la navegación de Dirección y Finanzas solo muestra las acciones concedidas', () => {
  assert.match(sesionSource, /mostrarEquipo = usuario\.puedeAdministrarEquipo/);
  assert.match(sesionSource, /mostrarFacturacion = usuario\.puedeVerFacturacion/);
  assert.match(sesionSource, /enlaceEquipo\.hidden = !mostrarEquipo/);
  assert.match(sesionSource, /enlaceFacturacion\.hidden = !mostrarFacturacion/);
  assert.match(sesionSource, /nav\.hidden = !mostrarEquipo && !mostrarFacturacion/);
  assert.match(equipo, /Esta función requiere autorización/);
  assert.match(equipo, /accesoEquipo === 'permitido' \? <>/);
  assert.match(equipo, /accesoEquipo === 'denegado' \? <section/);
});

test('elimina accesos flotantes de Dirección que quedaban detrás de la barra superior', () => {
  assert.doesNotMatch(direccion, /account-shortcuts/);
});

test('el tablero de Dirección ofrece accesos visibles a equipo y suscripción', () => {
  assert.match(direccion, /<nav class="direction-account-links" aria-label="Administración de cuenta">/);
  assert.match(direccion, /href="\/equipo">Equipo · invitar y administrar usuarios/);
  assert.match(direccion, /href="\/suscripcion">Suscripción y pagos/);
  assert.match(estilos, /\.direction-account-links\s*\{[^}]*display:\s*flex/);
});

test('Finanzas ve su nombre de tablero y no la identidad visual de Dirección', async () => {
  const direccionJs = await readFile(new URL('../public/demo/js/direccion.js', import.meta.url), 'utf8');
  assert.match(direccion, /id="tituloTableroDireccion">Tablero de Dirección/);
  assert.match(direccionJs, /cuenta\.rol === "finanzas"/);
  assert.match(direccionJs, /tituloFinanzas\.textContent = "Tablero de Finanzas"/);
  assert.match(legacyClient, /usuario\.rol === 'finanzas'\) titulo\.textContent = 'Tablero de Finanzas'/);
  assert.match(legacyClient, /nav\.hidden = !mostrarEquipo && !mostrarFacturacion/);
});

test('el toast del home no pinta sus marcadores hasta que aparece una notificación', () => {
  assert.match(landing, /id="toast"/);
  assert.match(estilos, /#toast:not\(\.is-visible\)\s*\{[^}]*display:\s*none\s*!important/);
});

test('el aviso de rol bloqueado trata query string y perfil como texto, no como HTML', () => {
  const aviso = { innerHTML: '', hidden: true };
  const documento = { getElementById: (id) => id === 'avisoBloqueo' ? aviso : null };
  const ventana = { location: { search: '?bloqueado=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E' } };
  vm.runInNewContext(sesionSource, { window: ventana, document: documento, URLSearchParams });
  ventana.Sesion.avisarBloqueo({
    email: '<svg onload=alert(2)>@example.test',
    etiquetaRol: '<script>alert(3)</script>',
  });
  assert.equal(aviso.hidden, false);
  assert.doesNotMatch(aviso.innerHTML, /<img|<svg|<script/i);
  assert.match(aviso.innerHTML, /&lt;img/);
  assert.match(aviso.innerHTML, /&lt;svg/);
  assert.match(aviso.innerHTML, /&lt;script/);
});

test('las vistas operativas escapan etiquetas de planta y texto libre antes de insertarlos como HTML', async () => {
  const operaciones = await readFile(new URL('../public/demo/js/operaciones.js', import.meta.url), 'utf8');
  const operador = await readFile(new URL('../public/demo/js/operador.js', import.meta.url), 'utf8');
  const retroactivo = await readFile(new URL('../public/demo/js/retroactivo.js', import.meta.url), 'utf8');
  const direccionJs = await readFile(new URL('../public/demo/js/direccion.js', import.meta.url), 'utf8');
  for (const source of [operaciones, operador, retroactivo, direccionJs]) {
    assert.match(source, /Sesion\.escaparHtml/);
  }
  assert.doesNotMatch(operaciones, /function escaparHtml\(/);
  assert.match(operaciones, /escaparHtml\(a\.nombre\)/);
  assert.match(operaciones, /escaparHtml\(s\.etiquetaCausa\)/);
  assert.match(operaciones, /escaparHtml\(s\.reportadoPor\)/);
  assert.match(operaciones, /escaparHtml\(c\.etiqueta\)/);
  assert.match(operador, /escaparHtml\(D\.etiquetaCausa\(causa\.id, textoLibre\)\)/);
  assert.match(retroactivo, /Sesion\.escaparHtml\(c\.etiqueta\)/);
  assert.match(direccionJs, /escaparHtml\(f\.etiqueta\)/);
});

test('la barra realmente renderiza Equipo y Suscripción para el titular incluso con el esquema de permisos anterior', () => {
  const barra = { innerHTML: '' };
  const elementos = {
    appBar: barra,
    btnSalir: { addEventListener() {} },
    selTurno: null,
    avisoBloqueo: null,
  };
  const documento = { getElementById: (id) => elementos[id] || null };
  const sesion = {
    perfil: { rol: 'direccion', nombre: 'Titular de prueba', es_propietario_cuenta: true },
    user: { id: 'user-test', email: 'titular@example.test' },
  };
  const ventana = {
    localStorage: { getItem: (key) => key === 'downtimeos_sesion' ? JSON.stringify(sesion) : null },
    location: { search: '' },
  };
  vm.runInNewContext(sesionSource, { window: ventana, document: documento });
  ventana.Sesion.iniciarVista('direccion', { sinSelectorTurno: true });
  assert.match(barra.innerHTML, /href="\/equipo">Equipo<\/a>/);
  assert.match(barra.innerHTML, /href="\/suscripcion">Suscripción y pagos<\/a>/);
});

test('un operador no recibe enlaces de administración de cuenta', () => {
  const barra = { innerHTML: '' };
  const elementos = { appBar: barra, btnSalir: { addEventListener() {} }, selTurno: null, avisoBloqueo: null };
  const documento = { getElementById: (id) => elementos[id] || null };
  const sesion = { perfil: { rol: 'operador', nombre: 'Operador' }, user: { email: 'operador@example.test' } };
  const ventana = {
    localStorage: { getItem: (key) => key === 'downtimeos_sesion' ? JSON.stringify(sesion) : null },
    location: { search: '' },
  };
  vm.runInNewContext(sesionSource, { window: ventana, document: documento });
  ventana.Sesion.iniciarVista('operador');
  assert.doesNotMatch(barra.innerHTML, /href="\/(?:equipo|suscripcion)"/);
});

test('Finanzas solo ve la suscripción cuando tiene el permiso explícito y nunca administra Equipo por defecto', () => {
  const barra = { innerHTML: '' };
  const elementos = { appBar: barra, btnSalir: { addEventListener() {} }, selTurno: null, avisoBloqueo: null };
  const documento = { getElementById: (id) => elementos[id] || null };
  const sesion = { perfil: { rol: 'finanzas', nombre: 'Finanzas', es_propietario_cuenta: false, es_admin_cuenta: false, puede_administrar_facturacion: false }, user: { email: 'finanzas@example.test' } };
  const ventana = { localStorage: { getItem: (key) => key === 'downtimeos_sesion' ? JSON.stringify(sesion) : null }, location: { search: '' } };
  vm.runInNewContext(sesionSource, { window: ventana, document: documento });
  ventana.Sesion.iniciarVista('direccion', { sinSelectorTurno: true });
  assert.doesNotMatch(barra.innerHTML, /href="\/equipo">Equipo<\/a>/);
  assert.doesNotMatch(barra.innerHTML, /href="\/suscripcion"/);
  sesion.perfil.puede_administrar_facturacion = true;
  ventana.localStorage.getItem = (key) => key === 'downtimeos_sesion' ? JSON.stringify(sesion) : null;
  ventana.Sesion.iniciarVista('direccion', { sinSelectorTurno: true });
  assert.doesNotMatch(barra.innerHTML, /href="\/equipo">Equipo<\/a>/);
  assert.match(barra.innerHTML, /href="\/suscripcion">Suscripción y pagos<\/a>/);
});

test('una sesión antigua con permisos booleanos obsoletos se sincroniza y recupera enlaces', async () => {
  const barra = { innerHTML: '' };
  const elementos = { appBar: barra, btnSalir: { addEventListener() {} }, selTurno: null, avisoBloqueo: null };
  const documento = { getElementById: (id) => elementos[id] || null };
  const sesionAnterior = {
    perfil: { rol: 'direccion', nombre: 'Titular', planta_id: 'planta-test', es_propietario_cuenta: false, es_admin_cuenta: false, puede_administrar_facturacion: false },
    access_token: 'token-de-prueba',
    user: { email: 'titular@example.test' },
  };
  let guardado = JSON.stringify(sesionAnterior);
  let recargas = 0;
  const ventana = {
    localStorage: {
      getItem: (key) => key === 'downtimeos_sesion' ? guardado : null,
      setItem: (key, value) => { if (key === 'downtimeos_sesion') guardado = value; },
    },
    location: { search: '', reload: () => { recargas += 1; } },
    fetch: async (url, opciones) => {
      assert.equal(url, '/api/cuenta');
      assert.equal(opciones.headers.authorization, 'Bearer token-de-prueba');
      assert.equal(opciones.headers['x-downtimeos-planta'], 'planta-test');
      return { ok: true, json: async () => ({ perfil: {
        ...sesionAnterior.perfil,
        es_propietario_cuenta: true,
        es_admin_cuenta: true,
        puede_administrar_facturacion: false,
      } }) };
    },
  };
  vm.runInNewContext(sesionSource, { window: ventana, document: documento });
  ventana.Sesion.iniciarVista('direccion', { sinSelectorTurno: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(recargas, 1);
  assert.equal(JSON.parse(guardado).perfil.es_propietario_cuenta, true);
  ventana.Sesion.iniciarVista('direccion', { sinSelectorTurno: true });
  assert.match(barra.innerHTML, /href="\/equipo">Equipo<\/a>/);
  assert.match(barra.innerHTML, /href="\/suscripcion">Suscripción y pagos<\/a>/);
});

test('renueva una sesión vencida antes de resolver los accesos del titular', async () => {
  const barra = { innerHTML: '' };
  const elementos = { appBar: barra, btnSalir: { addEventListener() {} }, selTurno: null, avisoBloqueo: null };
  const documento = { getElementById: (id) => elementos[id] || null };
  const sesionAnterior = {
    perfil: { rol: 'direccion', nombre: 'Titular', planta_id: 'planta-test', es_propietario_cuenta: false, es_admin_cuenta: false, puede_administrar_facturacion: false },
    access_token: 'token-vencido', refresh_token: 'refresh-anterior',
    user: { email: 'titular@example.test' },
  };
  let guardado = JSON.stringify(sesionAnterior);
  let recargas = 0;
  const llamadas = [];
  const ventana = {
    localStorage: {
      getItem: (key) => key === 'downtimeos_sesion' ? guardado : null,
      setItem: (key, value) => { if (key === 'downtimeos_sesion') guardado = value; },
    },
    location: { search: '', reload: () => { recargas += 1; } },
    fetch: async (url, opciones = {}) => {
      llamadas.push({ url, opciones });
      if (llamadas.length === 1) return { status: 401, ok: false };
      assert.equal(url, '/api/cuenta');
      assert.equal(opciones.method, 'POST');
      assert.equal(opciones.headers['x-downtimeos-planta'], 'planta-test');
      assert.deepEqual(JSON.parse(opciones.body), { accion: 'refrescar', refresh_token: 'refresh-anterior' });
      return { status: 200, ok: true, json: async () => ({
        access_token: 'token-renovado', refresh_token: 'refresh-renovado',
        perfil: { ...sesionAnterior.perfil, es_propietario_cuenta: true, es_admin_cuenta: true },
      }) };
    },
  };
  vm.runInNewContext(sesionSource, { window: ventana, document: documento });
  ventana.Sesion.iniciarVista('direccion', { sinSelectorTurno: true });
  await new Promise((resolve) => setImmediate(resolve));
  const actualizada = JSON.parse(guardado);
  assert.equal(llamadas.length, 2);
  assert.equal(actualizada.access_token, 'token-renovado');
  assert.equal(actualizada.refresh_token, 'refresh-renovado');
  assert.equal(actualizada.perfil.es_propietario_cuenta, true);
  assert.equal(recargas, 1);
});

test('el formulario conserva una referencia estable para limpiarse tras completar la invitación', () => {
  const inicio = equipo.indexOf('async function enviar(evento)');
  const fin = equipo.indexOf('\n  async function actuar', inicio);
  const envio = equipo.slice(inicio, fin);
  const capturaFormulario = envio.indexOf('const formulario = evento.currentTarget');
  const primeraEspera = envio.indexOf('await fetchConSesion');
  assert.ok(capturaFormulario >= 0 && capturaFormulario < primeraEspera,
    'captura currentTarget síncronamente antes de ceder el control al navegador');
  assert.match(envio, /formulario\.reset\(\)/);
  assert.match(envio, /No pudimos confirmar el envío[\s\S]*?Revisa la lista de invitaciones antes de volver a intentarlo/);
});

test('la pantalla de equipo explica tanto la activación de miembros nuevos como el acceso de cuentas existentes', () => {
  assert.match(equipo, /enlace seguro para activar su acceso/);
  assert.match(equipo, /Si aún no tiene cuenta, podrá crear su contraseña/);
});
