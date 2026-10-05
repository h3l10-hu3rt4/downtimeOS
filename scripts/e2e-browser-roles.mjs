import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

function report(message) {
  console.log(`[e2e-browser-roles] ${message}`);
}

async function puertoDisponible() {
  const servidor = createServer();
  await new Promise((resolve, reject) => {
    servidor.once('error', reject);
    servidor.listen(0, '127.0.0.1', resolve);
  });
  const { port } = servidor.address();
  await new Promise((resolve, reject) => servidor.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function esperarDebugger(url, proceso) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (proceso.exitCode !== null) throw new Error('El navegador de QA terminó antes de habilitar DevTools.');
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(700) });
      if (response.ok) return response.json();
    } catch { /* Edge todavía está iniciando. */ }
    await delay(150);
  }
  throw new Error('Edge de QA no habilitó DevTools dentro del tiempo esperado.');
}

class DevTools {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.sequence = 0;
    this.pending = new Map();
    this.errors = [];
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      let message;
      try { message = JSON.parse(String(event.data)); } catch { return; }
      if (message.method === 'Runtime.exceptionThrown') {
        this.errors.push(message.params?.exceptionDetails?.text || 'Excepción JavaScript sin detalle.');
      }
      const deferred = this.pending.get(message.id);
      if (!deferred) return;
      this.pending.delete(message.id);
      if (message.error) deferred.reject(new Error(message.error.message || 'DevTools rechazó la petición.'));
      else deferred.resolve(message.result || {});
    });
  }

  async send(method, params = {}) {
    await this.ready;
    const id = ++this.sequence;
    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`DevTools excedió tiempo en ${method}.`));
      }, 8_000);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
    });
    this.socket.send(JSON.stringify({ id, method, params }));
    return response;
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: false,
    });
    if (result.exceptionDetails) throw new Error('La evaluación de UI de QA produjo una excepción.');
    return result.result?.value;
  }

  close() {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.close();
  }
}

function sesionDe(entrada) {
  const perfil = entrada?.perfil || entrada?.profile;
  const accessToken = entrada?.token;
  const email = entrada?.email;
  if (!perfil?.planta_id || !accessToken || !email) {
    throw new Error('No se puede iniciar UI QA: falta perfil de planta o sesión sintética.');
  }
  return {
    access_token: accessToken,
    user: { id: entrada.userId || '', email },
    perfil,
    plantas_disponibles: entrada.plantasDisponibles || [],
  };
}

export async function verificarNavegacionConSesiones({ appUrl, owner, members, admin, soloPublicas = false }) {
  const app = new URL(appUrl);
  if (!['127.0.0.1', 'localhost', '::1'].includes(app.hostname)
    || app.username || app.password || app.search || app.hash) {
    throw new Error('El UI QA solo acepta una URL local, sin credenciales ni parámetros.');
  }
  const executable = process.env.MVP_E2E_BROWSER_EXECUTABLE;
  if (!executable || !path.isAbsolute(executable) || !existsSync(executable)) {
    throw new Error('Para el UI QA define MVP_E2E_BROWSER_EXECUTABLE con la ruta absoluta de Edge instalado.');
  }

  let titular = null;
  let direccion = null;
  let finanzas = null;
  let operaciones = null;
  let operador = null;
  if (!soloPublicas) {
    if (!owner?.account?.perfil || !Array.isArray(members)) {
      throw new Error('El UI QA autenticado necesita la cuenta titular y la lista de miembros del E2E.');
    }
    const miembro = (rol) => members.find((item) => item.rol === rol);
    titular = sesionDe({
      ...owner,
      perfil: owner.account.perfil,
      plantasDisponibles: owner.account.plantas_disponibles,
    });
    direccion = miembro('direccion');
    finanzas = miembro('finanzas');
    operaciones = miembro('operaciones');
    operador = miembro('operador');
    for (const [label, user] of Object.entries({ direccion, finanzas, operaciones, operador })) {
      if (!user) throw new Error(`UI QA necesita una cuenta autenticada del rol ${label}.`);
    }
  }

  const port = await puertoDisponible();
  const profile = mkdtempSync(path.join(tmpdir(), 'downtimeos-browser-qa-'));
  const screenshots = mkdtempSync(path.join(tmpdir(), 'downtimeos-role-captures-'));
  let browser;
  let cdp;

  try {
    browser = spawn(executable, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--disable-extensions', '--disable-sync', '--disable-background-networking',
      `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank',
    ], { stdio: 'ignore', windowsHide: true });
    const version = await esperarDebugger(`http://127.0.0.1:${port}/json/version`, browser);
    const targetsResponse = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2_000) });
    if (!targetsResponse.ok) throw new Error('Edge de QA no devolvió sus pestañas DevTools.');
    const targets = await targetsResponse.json();
    const target = targets.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
    if (!target || !String(version.webSocketDebuggerUrl || '').startsWith(`ws://127.0.0.1:${port}/`)) {
      throw new Error('No se encontró una pestaña local de Edge para la UI QA.');
    }
    cdp = new DevTools(target.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false,
    });

    async function navegar(ruta, session) {
      await cdp.send('Page.navigate', { url: new URL('/acceso', app).toString() });
      const originReady = await esperarCondicion(() => cdp.evaluate(
        `document.readyState === "complete" && location.origin === ${JSON.stringify(app.origin)}`,
      ));
      assert.equal(originReady, true, 'la página local debe completar su carga.');
      const serializedSession = JSON.stringify(session);
      assert.equal(await cdp.evaluate(`localStorage.setItem("downtimeos_sesion", ${JSON.stringify(serializedSession)}); true;`), true,
        'la sesión QA debe instalarse solo en el perfil temporal.');
      await cdp.send('Page.navigate', { url: new URL(ruta, app).toString() });
      const ready = await esperarCondicion(async () => {
        const requiereBarra = ['/direccion', '/operaciones', '/operador'].includes(ruta);
        const state = await cdp.evaluate(`({
          path: location.pathname,
          title: document.querySelector("main h1")?.innerText?.trim() || "",
          header: document.querySelector("#appBar")?.innerText || "",
          brand: document.querySelector("#appBar .app__brand .wordmark")?.textContent?.trim() || "",
          body: document.body?.innerText || "",
          loading: document.body?.innerText?.includes("Verificando permisos…") || document.body?.innerText?.includes("Consultando tu cuenta"),
        })`);
        state.requiereBarra = requiereBarra;
        return state;
      }, (state) => state.path === new URL(ruta, app).pathname && !state.loading && state.title
        && (!state.requiereBarra || state.header));
      assert.ok(ready, `la ruta ${ruta} debe renderizar su encabezado y navegación autenticados.`);
      if (['/direccion', '/operaciones', '/operador'].includes(ruta)) {
        assert.equal(ready.brand, 'DowntimeOS',
          `${ruta}: la barra autenticada debe mostrar la marca DowntimeOS.`);
        const origenDatos = await esperarCondicion(
          () => cdp.evaluate('document.getElementById("appOrigen")?.textContent?.trim() || ""'),
          (estado) => estado !== 'Cargando datos de planta…',
        );
        assert.equal(origenDatos, 'Supabase · datos de planta',
          `${ruta}: el tablero debe terminar de cargar datos reales de la planta antes de aprobarse.`);
        ready.origenDatos = origenDatos;
      }
      return ready;
    }

    async function esperarCondicion(read, aceptar = Boolean, timeoutMs = 20_000) {
      const until = Date.now() + timeoutMs;
      let value;
      while (Date.now() < until) {
        value = await read();
        if (aceptar(value)) return value;
        await delay(125);
      }
      return aceptar(value) ? value : null;
    }

    async function visibleLinks() {
      return cdp.evaluate(`Array.from(document.querySelectorAll('#appBar a.app__account-link, .direction-account-links a')).filter((link) => link.getClientRects().length > 0 && !link.hidden).map((link) => ({href: new URL(link.href).pathname, text: link.innerText.trim()}))`);
    }

    async function capturar(nombre) {
      const result = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const bytes = Buffer.from(result.data, 'base64');
      if (!bytes.length) throw new Error(`No se pudo capturar la pantalla ${nombre}.`);
      writeFileSync(path.join(screenshots, `${nombre}.png`), bytes);
    }

    async function navegarPublica(ruta) {
      await cdp.send('Page.navigate', { url: new URL('/acceso', app).toString() });
      const originReady = await esperarCondicion(() => cdp.evaluate(
        `document.readyState === "complete" && location.origin === ${JSON.stringify(app.origin)}`,
      ));
      assert.equal(originReady, true, 'la página pública debe completar su carga.');
      await cdp.evaluate('localStorage.removeItem("downtimeos_sesion"); true;');
      await cdp.send('Page.navigate', { url: new URL(ruta, app).toString() });
      const ready = await esperarCondicion(() => cdp.evaluate(`({
        path: location.pathname,
        title: document.querySelector("main h1")?.innerText?.trim() || "",
        card: Boolean(document.querySelector("main.auth-page .auth-card")),
        loading: document.body?.innerText?.includes("Validando enlace seguro…"),
      })`), (state) => state.path === new URL(ruta, app).pathname && state.card && state.title && !state.loading);
      assert.ok(ready, `la pantalla pública ${ruta} debe terminar de renderizar su tarjeta.`);
      return ready;
    }

    const pantallasPublicas = [
      { name: 'acceso', route: '/acceso', title: 'Acceso a tu planta', inputs: ['email', 'password'], submit: 'Iniciar sesión', links: ['/recuperar', '/registro'] },
      { name: 'registro', route: '/registro', title: 'Configura tu primera planta', inputs: ['empresa', 'planta', 'nombre', 'email', 'password'], submit: 'Crear empresa', links: ['/acceso'] },
      { name: 'recuperar', route: '/recuperar', title: 'Recupera tu acceso', inputs: ['email'], submit: 'Enviar enlace', links: ['/acceso'] },
      { name: 'activar-sin-enlace', route: '/activar', title: 'Revisa tu enlace', inputs: [], submit: null, links: ['/acceso'] },
    ];
    for (const check of pantallasPublicas) {
      const beforeExceptions = cdp.errors.length;
      await navegarPublica(check.route);
      const ui = await cdp.evaluate(`(() => {
        const card = document.querySelector("main.auth-page .auth-card");
        const submit = card?.querySelector("button[type=submit]");
        const rect = card?.getBoundingClientRect();
        return {
          title: card?.querySelector("h1")?.innerText?.trim() || "",
          inputs: Array.from(card?.querySelectorAll("form.auth-form input[name]") || []).map((input) => input.name),
          unlabeledInputs: Array.from(card?.querySelectorAll("form.auth-form input[name]") || []).filter((input) => !input.labels?.length).map((input) => input.name),
          submit: submit?.innerText?.trim() || null,
          links: Array.from(card?.querySelectorAll("a[href]") || []).map((link) => new URL(link.href).pathname),
          arrow: /[→←➜➡]/.test(submit?.innerText || ""),
          stylesheet: Array.from(document.styleSheets).some((sheet) => String(sheet.href || "").includes("/css/styles.css")),
          bodyBackground: getComputedStyle(document.body).backgroundColor,
          cardBackground: getComputedStyle(card).backgroundColor,
          buttonBackground: submit ? getComputedStyle(submit).backgroundImage + " " + getComputedStyle(submit).backgroundColor : null,
          font: getComputedStyle(card.querySelector("h1")).fontFamily,
          viewport: { width: innerWidth, documentWidth: document.documentElement.scrollWidth, cardLeft: rect?.left, cardRight: rect?.right },
        };
      })()`);
      assert.equal(ui.title, check.title, `${check.name}: encabezado visible.`);
      assert.deepEqual(ui.inputs, check.inputs, `${check.name}: campos esperados y en orden.`);
      assert.deepEqual(ui.unlabeledInputs, [], `${check.name}: cada campo debe tener una etiqueta accesible.`);
      assert.equal(ui.submit, check.submit, `${check.name}: etiqueta del botón correcta.`);
      assert.deepEqual([...new Set(ui.links)].sort(), [...check.links].sort(), `${check.name}: navegación de salida coherente.`);
      assert.equal(ui.arrow, false, `${check.name}: los botones de autenticación no deben mostrar flechas decorativas.`);
      assert.equal(ui.stylesheet, true, `${check.name}: debe cargar la hoja visual global.`);
      assert.equal(ui.bodyBackground, 'rgb(6, 8, 11)', `${check.name}: el tema oscuro global debe aplicarse al documento.`);
      assert.ok(ui.cardBackground?.startsWith('rgba(11, 15, 21,'), `${check.name}: la tarjeta debe conservar la superficie DowntimeOS.`);
      if (check.submit) assert.match(ui.buttonBackground || '', /linear-gradient/i, `${check.name}: el CTA primario debe usar el estilo global amarillo.`);
      assert.ok(ui.font && ui.font !== 'Arial', `${check.name}: el encabezado debe usar la tipografía de la marca.`);
      assert.ok(ui.viewport.cardLeft >= 0 && ui.viewport.cardRight <= ui.viewport.width,
        `${check.name}: la tarjeta debe caber horizontalmente en el viewport.`);
      if (check.name === 'registro') {
        const hint = await esperarCondicion(
          () => cdp.evaluate('document.querySelector("#registro-email-ayuda")?.innerText || ""'),
          (text) => /@downtimeos\.test/i.test(text),
          5_000,
        );
        assert.match(hint || '', /@downtimeos\.test/i, 'Registro debe explicar el correo de prueba local B2B después de cargar la configuración.');
      }
      assert.equal(cdp.errors.length, beforeExceptions, `${check.name}: no debe lanzar excepciones JavaScript.`);
      await capturar(check.name);
      report(`PASS UI pública ${check.name} · campos, rutas, estilos, viewport y copy`);
    }

    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
    });
    for (const ruta of ['/acceso', '/registro', '/recuperar']) {
      await navegarPublica(ruta);
      const layout = await cdp.evaluate(`(() => {
        const card = document.querySelector("main.auth-page .auth-card");
        const rect = card.getBoundingClientRect();
        return { width: innerWidth, documentWidth: document.documentElement.scrollWidth, left: rect.left, right: rect.right };
      })()`);
      assert.ok(layout.documentWidth <= layout.width + 1 && layout.left >= 0 && layout.right <= layout.width + 1,
        `${ruta}: el formulario debe caber en viewport móvil sin desbordamiento horizontal.`);
      if (ruta === '/registro') await capturar('registro-movil');
      report(`PASS UI móvil ${ruta} · ${layout.width}px sin desbordamiento`);
    }
    await cdp.send('Emulation.clearDeviceMetricsOverride');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false,
    });

    if (soloPublicas) {
      report('PASS · revisión pública terminada; no se usaron sesiones ni se hicieron escrituras en Supabase.');
      report(`Capturas guardadas temporalmente en ${screenshots}`);
      return { screenshots, checks: pantallasPublicas.length + 3 };
    }

    // The owner has already completed onboarding through the API in the E2E.
    // Clear only the browser-side completion flag so this read-only UI check
    // can render the first-setup form without creating or changing DB records.
    const sesionOnboarding = {
      ...titular,
      perfil: { ...titular.perfil, onboarding_completado_en: null },
    };
    const onboarding = await navegar('/configurar-planta', sesionOnboarding);
    assert.equal(onboarding.title, 'Configura tus líneas y máquinas');
    const onboardingUi = await cdp.evaluate(`(() => {
      const card = document.querySelector('main.auth-page .auth-card');
      const primary = card?.querySelector('.btn--primary');
      return {
        form: Boolean(card?.querySelector('form.onboarding-form')),
        sections: card?.querySelectorAll('.onboarding-section').length || 0,
        templateButtons: Array.from(card?.querySelectorAll('.onboarding-section:first-of-type button') || []).map((button) => button.innerText.trim()),
        unlabeledInputs: Array.from(card?.querySelectorAll('form.onboarding-form input') || []).filter((input) => !input.labels?.length).length,
        stylesheet: Array.from(document.styleSheets).some((sheet) => String(sheet.href || '').includes('/css/styles.css')),
        cardBackground: getComputedStyle(card).backgroundColor,
        primaryBackground: primary ? getComputedStyle(primary).backgroundImage : '',
      };
    })()`);
    assert.equal(onboardingUi.form, true, 'la configuración inicial debe mostrar el formulario React.');
    assert.ok(onboardingUi.sections >= 3, 'la configuración debe separar plantillas, líneas y equipos en secciones.');
    assert.deepEqual(onboardingUi.templateButtons, [
      'Empezar desde cero', 'Una línea, etapas secuenciales',
      'Una línea con máquinas paralelas', 'Dos líneas, etapas secuenciales',
    ], 'las plantillas deben estar disponibles como opciones visibles y sin enviar el formulario.');
    assert.equal(onboardingUi.unlabeledInputs, 0, 'los campos de configuración deben tener etiquetas visibles.');
    assert.equal(onboardingUi.stylesheet, true, 'configuración debe usar los estilos globales.');
    assert.ok(onboardingUi.cardBackground.startsWith('rgba(11, 15, 21,'), 'la tarjeta debe conservar la superficie DowntimeOS.');
    assert.match(onboardingUi.primaryBackground, /linear-gradient/i, 'el botón principal debe conservar el estilo global amarillo.');
    await capturar('configurar-planta');
    report('PASS UI configuración inicial · plantillas, campos etiquetados y estilos');

    const plantPicker = await navegar('/plantas', titular);
    assert.equal(plantPicker.title, 'Selecciona una planta');
    const plantPickerReady = await esperarCondicion(async () => cdp.evaluate(`({
      choices: document.querySelectorAll('.plant-choice').length,
      loading: document.body.innerText.includes('Verificando acceso y cargando plantas…'),
      error: document.body.innerText.includes('No pudimos cargar tus plantas'),
      stylesheet: Array.from(document.styleSheets).some((sheet) => String(sheet.href || '').includes('/css/styles.css')),
    })`), (state) => state.choices > 0 && !state.loading && !state.error && state.stylesheet);
    assert.ok(plantPickerReady, 'el titular debe ver sus plantas reales, sin estado de error y con estilos globales.');
    await capturar('plantas');
    report('PASS UI selector de plantas · datos autorizados y estilos globales');

    const structure = await navegar('/estructura', titular);
    assert.equal(structure.title, 'Líneas y equipos');
    const structureReady = await esperarCondicion(async () => cdp.evaluate(`({
      lineForm: Boolean(document.querySelector('form#nueva-linea')),
      assetForm: Boolean(document.querySelector('form#nuevo-equipo')),
      panels: document.querySelectorAll('main.account-page .account-panel').length,
      loading: /Verificando permisos…|Cargando líneas…|Cargando equipos…/.test(document.body.innerText),
      stylesheet: Array.from(document.styleSheets).some((sheet) => String(sheet.href || '').includes('/css/styles.css')),
    })`), (state) => state.lineForm && state.assetForm && state.panels >= 2 && !state.loading && state.stylesheet);
    assert.ok(structureReady, 'Dirección debe poder ver líneas y equipos cargados, sin error y con estilos globales.');
    await capturar('estructura');
    report('PASS UI estructura · formularios de líneas/equipos, datos y estilos');

    const checks = [
      { name: 'titular-direccion', route: '/direccion', session: titular, title: 'Tablero de Dirección', links: ['/equipo', '/suscripcion'] },
      { name: 'miembro-direccion', route: '/direccion', session: sesionDe(direccion), title: 'Tablero de Dirección', links: [] },
      { name: 'finanzas', route: '/direccion', session: sesionDe(finanzas), title: 'Tablero de Finanzas', links: ['/suscripcion'] },
      { name: 'operaciones', route: '/operaciones', session: sesionDe(operaciones), title: 'Tablero de Operaciones', links: [] },
      { name: 'operador', route: '/operador', session: sesionDe(operador), title: 'Registro de Piso', links: [] },
    ];
    for (const check of checks) {
      const page = await navegar(check.route, check.session);
      assert.equal(page.title, check.title, `${check.name}: debe mostrarse el tablero correspondiente al rol.`);
      const links = await visibleLinks();
      assert.deepEqual([...new Set(links.map((item) => item.href))].sort(), [...check.links].sort(), `${check.name}: los accesos de cuenta deben respetar sus permisos.`);
      const exceptionCount = cdp.errors.length;
      assert.equal(exceptionCount, 0, `${check.name}: no debe lanzar excepciones JavaScript durante el render.`);
      await capturar(check.name);
      report(`PASS UI ${check.name} · heading y enlaces de cuenta coherentes`);
    }

    const ownerTeam = await navegar('/equipo', titular);
    assert.equal(ownerTeam.title, 'Invita a tu equipo');
    const teamReady = await esperarCondicion(async () => cdp.evaluate(`({form: Boolean(document.querySelector('form.team-invite-form')), label: document.body.innerText.includes('Invitaciones de esta planta'), accessDenied: document.body.innerText.includes('Esta función requiere autorización'), error: document.body.innerText.includes('No pudimos cargar el equipo')})`),
    (state) => state.form && state.label && !state.accessDenied && !state.error);
    assert.ok(teamReady, 'el titular debe poder ver el formulario y la lista de invitaciones, sin error de carga.');
    await capturar('equipo-titular');
    report('PASS UI Equipo titular · formulario y listado cargados');

    const financeTeam = await navegar('/equipo', sesionDe(finanzas));
    assert.equal(financeTeam.title, 'Invita a tu equipo');
    const deniedTeam = await esperarCondicion(async () => cdp.evaluate(`document.body.innerText.includes('Esta función requiere autorización')`));
    assert.equal(deniedTeam, true, 'Finanzas sin delegación de administración debe ver el acceso denegado en Equipo.');
    report('PASS UI Equipo Finanzas · autorización denegada con explicación');

    const ownerBilling = await navegar('/suscripcion', titular);
    assert.equal(ownerBilling.title, 'Planes y pagos');
    const billingReady = await esperarCondicion(async () => cdp.evaluate(`({status: document.body.innerText.includes('Solicitar un plan') || document.body.innerText.includes('Estado de tu cuenta'), error: document.body.innerText.includes('No pudimos consultar tu cuenta'), denied: document.body.innerText.includes('Acceso restringido'), form: Boolean(document.querySelector('form.billing-request'))})`),
    (state) => state.status && !state.error && !state.denied && state.form);
    assert.ok(billingReady, 'el titular debe poder consultar pagos y un plan elegible.');
    await capturar('suscripcion-titular');
    report('PASS UI Suscripción titular · datos consultados y solicitud elegible visible');

    const financeBilling = await navegar('/suscripcion', sesionDe(finanzas));
    assert.equal(financeBilling.title, 'Planes y pagos');
    const financeReady = await esperarCondicion(async () => cdp.evaluate(`({form: Boolean(document.querySelector('form.billing-request')), denied: document.body.innerText.includes('Acceso restringido'), error: document.body.innerText.includes('No pudimos consultar tu cuenta')})`),
    (state) => state.form && !state.denied && !state.error);
    assert.ok(financeReady, 'Finanzas con permiso debe poder consultar y administrar la suscripción.');
    await capturar('suscripcion-finanzas');
    report('PASS UI Suscripción Finanzas · permiso de facturación aplicado');

    for (const role of [operaciones, operador]) {
      const denied = await navegar('/suscripcion', sesionDe(role));
      assert.equal(denied.title, 'Planes y pagos');
      const message = await esperarCondicion(async () => cdp.evaluate(`document.body.innerText.includes('Acceso restringido')`));
      assert.equal(message, true, `${role.rol}: la pantalla de suscripción debe explicar el permiso faltante.`);
      report(`PASS UI Suscripción ${role.rol} · acceso restringido con explicación`);
    }

    assert.ok(admin?.email && admin?.password, 'la revisión visual requiere un administrador sintético de QA.');
    await cdp.send('Page.navigate', { url: new URL('/administracion/acceso', app).toString() });
    const accesoAdmin = await esperarCondicion(() => cdp.evaluate(`(() => ({
      path: location.pathname,
      title: document.querySelector('main h1')?.innerText?.trim() || '',
      email: Boolean(document.querySelector('#correo[type=email]')),
      password: Boolean(document.querySelector('#clave[type=password]')),
      submit: document.querySelector('#btnEntrar')?.innerText?.trim() || '',
      stylesheet: Array.from(document.styleSheets).some((sheet) => String(sheet.href || '').includes('/css/styles.css')),
      buttonClass: document.querySelector('#btnEntrar')?.className || '',
      scriptsReady: document.querySelector('.next-legacy-page')?.dataset.legacyScriptsReady === 'true',
      errors: document.querySelector('#error')?.innerText?.trim() || '',
    }))()`), (state) => state.path === '/administracion/acceso' && state.title === 'Centro de administración' && state.scriptsReady);
    assert.ok(accesoAdmin, 'el acceso administrativo debe cargar antes del login.');
    assert.equal(accesoAdmin.email, true, 'Administración debe mostrar el correo etiquetado.');
    assert.equal(accesoAdmin.password, true, 'Administración debe mostrar la contraseña.');
    assert.equal(accesoAdmin.submit, 'Entrar a administración');
    assert.equal(accesoAdmin.stylesheet, true, 'Administración debe cargar los estilos globales.');
    assert.match(accesoAdmin.buttonClass, /btn--primary/, 'el acceso administrativo debe usar el botón global.');
    await capturar('administracion-acceso');
    report('PASS UI acceso de Administración · campos, CTA y estilos globales');

    assert.equal(await cdp.evaluate(`(() => {
      document.querySelector('#correo').value = ${JSON.stringify(admin.email)};
      document.querySelector('#clave').value = ${JSON.stringify(admin.password)};
      document.querySelector('#formAcceso').requestSubmit();
      return true;
    })()`), true, 'el formulario administrativo debe poder enviarse.');
    const panelAdmin = await esperarCondicion(async () => {
      try {
        return await cdp.evaluate(`({
          path: location.pathname,
          hasBillingLink: Array.from(document.querySelectorAll('a[href]')).some((link) => new URL(link.href).pathname === '/administracion/suscripciones'),
          dashboard: document.body?.innerText?.includes('Centro de administración') || false,
          brand: document.querySelector('header.app__bar .app__brand .wordmark')?.textContent?.trim() || '',
          status: document.querySelector('#estado')?.textContent?.trim() || '',
          loading: /^(Cargando|Actualizando) métricas/i.test(document.querySelector('#estado')?.textContent?.trim() || ''),
        })`);
      } catch { return null; }
    }, (state) => state?.path === '/administracion' && state.hasBillingLink && state.dashboard && !state.loading);
    assert.ok(panelAdmin, 'el login administrativo debe abrir el panel y mostrar Suscripciones y pagos.');
    assert.equal(panelAdmin.brand, 'DowntimeOS', 'el panel de Administración debe usar el nombre de marca vigente.');
    assert.equal(panelAdmin.status, 'Datos actualizados. Solo se muestran métricas agregadas.', 'el panel debe terminar de consultar las métricas protegidas antes de aprobarse.');
    await capturar('administracion-panel');

    await cdp.send('Page.navigate', { url: new URL('/administracion/suscripciones', app).toString() });
    const solicitudesAdmin = await esperarCondicion(async () => {
      try {
        return await cdp.evaluate(`(() => ({
          path: location.pathname,
          title: document.querySelector('section.admin-billing-card h1')?.innerText?.trim() || '',
          card: Boolean(document.querySelector('section.admin-billing-card')),
          loading: document.body?.innerText?.includes('Cargando solicitudes…') || false,
          stylesheet: Array.from(document.styleSheets).some((sheet) => String(sheet.href || '').includes('/css/styles.css')),
          font: document.querySelector('main h1') ? getComputedStyle(document.querySelector('main h1')).fontFamily : '',
          requestRows: document.querySelectorAll('.admin-billing-item').length,
          empty: document.querySelector('.admin-billing-list')?.innerText?.includes('No hay solicitudes todavía.') || false,
        }))()`);
      } catch { return null; }
    }, (state) => state?.path === '/administracion/suscripciones' && state.title === 'Solicitudes de suscripción' && state.card && !state.loading && state.stylesheet);
    assert.ok(solicitudesAdmin, 'el panel de suscripciones debe cargar sus datos y estilos después del login.');
    assert.ok(solicitudesAdmin.font && solicitudesAdmin.font !== 'Arial', 'el panel administrativo debe usar la tipografía de marca.');
    assert.ok(solicitudesAdmin.requestRows > 0 || solicitudesAdmin.empty,
      'el panel debe mostrar solicitudes cargadas o su estado vacío.');
    await capturar('administracion-suscripciones');
    report('PASS UI Suscripciones administrativas · sesión, datos y estilos');

    const vistasMovilesAutenticadas = [
      { name: 'configuración inicial', route: '/configurar-planta', session: sesionOnboarding },
      { name: 'selector de plantas', route: '/plantas', session: titular },
      { name: 'estructura', route: '/estructura', session: titular },
      { name: 'Dirección', route: '/direccion', session: titular },
      { name: 'Finanzas', route: '/direccion', session: sesionDe(finanzas) },
      { name: 'Operaciones', route: '/operaciones', session: sesionDe(operaciones) },
      { name: 'Operador', route: '/operador', session: sesionDe(operador) },
      { name: 'Equipo', route: '/equipo', session: titular },
      { name: 'Suscripción', route: '/suscripcion', session: titular },
      { name: 'Suscripción Finanzas', route: '/suscripcion', session: sesionDe(finanzas) },
      { name: 'Administración', route: '/administracion', session: sesionOnboarding },
      { name: 'Administración de suscripciones', route: '/administracion/suscripciones', session: sesionOnboarding },
    ];
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
    });
    for (const check of vistasMovilesAutenticadas) {
      const page = await navegar(check.route, check.session);
      const layout = await cdp.evaluate(`(() => {
        const main = document.querySelector('main');
        const rect = main?.getBoundingClientRect();
        return {
          width: innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          left: rect?.left ?? 0,
          right: rect?.right ?? 0,
          title: main?.querySelector('h1')?.innerText?.trim() || '',
        };
      })()`);
      assert.ok(layout.documentWidth <= layout.width + 1 && layout.left >= 0 && layout.right <= layout.width + 1,
        `${check.name}: la pantalla autenticada debe caber en móvil sin desbordamiento horizontal (documento ${layout.documentWidth}px, viewport ${layout.width}px).`);
      assert.equal(layout.title, page.title, `${check.name}: el encabezado debe permanecer visible en móvil.`);
      report(`PASS UI móvil ${check.name} · ${layout.width}px sin desbordamiento`);
    }
    await cdp.send('Emulation.clearDeviceMetricsOverride');

    assert.equal(cdp.errors.length, 0, 'no deben quedar excepciones JavaScript no controladas en el flujo UI QA.');
    report(`Capturas sintéticas de revisión visual guardadas temporalmente en ${screenshots}`);
    return { screenshots, checks: pantallasPublicas.length + 11 + vistasMovilesAutenticadas.length };
  } finally {
    cdp?.close();
    if (browser && browser.exitCode === null) {
      browser.kill();
      await Promise.race([
        new Promise((resolve) => browser.once('exit', resolve)),
        delay(2_000),
      ]);
    }
    const resolved = path.resolve(profile);
    const tempRoot = path.resolve(tmpdir()) + path.sep;
    if (!resolved.startsWith(tempRoot) || !path.basename(resolved).startsWith('downtimeos-browser-qa-')) {
      throw new Error('Se bloqueó la limpieza: el perfil no coincide con el temporal de Edge de esta corrida.');
    }
    rmSync(resolved, { recursive: true, force: true });
  }
}
