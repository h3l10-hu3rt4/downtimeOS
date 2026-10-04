import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fetchConSesion, guardarSesionNavegador, leerSesionNavegador, tokensVigentesDeSesion } from '../lib/sesion-navegador.js';

class AlmacenSesion {
  constructor(valor) { this.valor = JSON.stringify(valor); }
  getItem(clave) { return clave === 'downtimeos_sesion' ? this.valor : null; }
  setItem(clave, valor) { if (clave === 'downtimeos_sesion') this.valor = valor; }
  leer() { return JSON.parse(this.valor); }
}

function instalarNavegador(sesion, fetcher) {
  const anteriorWindow = globalThis.window;
  const anteriorFetch = globalThis.fetch;
  const localStorage = new AlmacenSesion(sesion);
  globalThis.window = { localStorage };
  globalThis.fetch = fetcher;
  return () => { globalThis.window = anteriorWindow; globalThis.fetch = anteriorFetch; };
}

function respuesta(status, cuerpo = {}) {
  return new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });
}

test('la sesión del navegador tolera JSON corrupto, valores inesperados y almacenamiento bloqueado', () => {
  const anteriorWindow = globalThis.window;
  try {
    globalThis.window = { localStorage: { getItem: () => '{sesion-rota' } };
    assert.deepEqual(leerSesionNavegador(), {});
    globalThis.window = { localStorage: { getItem: () => 'null' } };
    assert.deepEqual(leerSesionNavegador(), {});
    globalThis.window = { get localStorage() { throw new Error('storage blocked'); } };
    assert.deepEqual(leerSesionNavegador(), {});
  } finally { globalThis.window = anteriorWindow; }
});

test('informar de forma segura si no se puede guardar la sesión tras autenticar', () => {
  const anteriorWindow = globalThis.window;
  try {
    globalThis.window = { localStorage: { setItem() {} } };
    assert.equal(guardarSesionNavegador({ access_token: 'token' }), true);
    globalThis.window = { get localStorage() { throw new Error('storage blocked'); } };
    assert.equal(guardarSesionNavegador({ access_token: 'token' }), false);
  } finally { globalThis.window = anteriorWindow; }
});

test('al guardar cambios de planta conserva el token renovado y no revive una sesión de otra cuenta', () => {
  const anteriorWindow = globalThis.window;
  const guardado = new AlmacenSesion({ access_token: 'token-renovado', refresh_token: 'refresh-nuevo', user: { id: 'u-1' }, perfil: { planta_id: 'p-1' } });
  try {
    globalThis.window = { localStorage: guardado };
    const actualizada = tokensVigentesDeSesion({ access_token: 'token-vencido', refresh_token: 'refresh-viejo', user: { id: 'u-1' }, perfil: { planta_id: 'p-1' } });
    assert.equal(actualizada.access_token, 'token-renovado');
    assert.equal(actualizada.refresh_token, 'refresh-nuevo');
    assert.throws(() => tokensVigentesDeSesion({ access_token: 'token-antiguo', user: { id: 'u-2' } }), /sesión cambió en otra pestaña/);
  } finally { globalThis.window = anteriorWindow; }
});

test('fetch protegido no lanza una excepción síncrona si localStorage está bloqueado', async () => {
  const anteriorWindow = globalThis.window;
  const anteriorFetch = globalThis.fetch;
  let llamadas = 0;
  globalThis.window = { get localStorage() { throw new Error('storage blocked'); } };
  globalThis.fetch = async () => { llamadas += 1; return respuesta(200, { ok: true }); };
  try {
    const result = await fetchConSesion('/api/planta');
    assert.equal(result.status, 200);
    assert.equal(llamadas, 1);
  } finally { globalThis.window = anteriorWindow; globalThis.fetch = anteriorFetch; }
});

test('las pantallas de cuenta leen la sesión con el helper tolerante a datos locales inválidos', async () => {
  const paginas = await Promise.all([
    'equipo', 'suscripcion', 'plantas', 'configurar-planta', 'estructura',
  ].map((nombre) => readFile(new URL(`../app/${nombre}/page.js`, import.meta.url), 'utf8')));
  for (const pagina of paginas) assert.match(pagina, /leerSesionNavegador\(\)/);
});

test('renueva tras 401, persiste ambos tokens y reintenta conservando planta y body', async () => {
  const llamadas = [];
  const restaurar = instalarNavegador({ access_token: 'vencido', refresh_token: 'refresh-anterior', user: { id: 'u-1' }, perfil: { user_id: 'u-1', planta_id: 'p-1' } }, async (url, init = {}) => {
    llamadas.push({ url, init, headers: new Headers(init.headers || {}) });
    if (url === '/api/cuenta') {
      assert.equal(init.method, 'POST');
      assert.deepEqual(JSON.parse(init.body), { accion: 'refrescar', refresh_token: 'refresh-anterior' });
      assert.equal(JSON.parse(init.body).user_id, undefined);
      assert.equal(new Headers(init.headers).get('x-downtimeos-planta'), 'p-1');
      return respuesta(200, { access_token: 'nuevo-access', refresh_token: 'nuevo-refresh', perfil: { user_id: 'u-1', planta_id: 'p-1' }, plantas_disponibles: [] });
    }
    if (llamadas.filter((llamada) => llamada.url === url).length === 1) return respuesta(401, { error: 'expired' });
    return respuesta(200, { ok: true });
  });

  try {
    const body = JSON.stringify({ accion: 'guardar', valor: 7 });
    const result = await fetchConSesion('/api/planta/estructura', {
      method: 'POST',
      headers: { authorization: 'Bearer vencido', 'x-downtimeos-planta': 'p-1', 'content-type': 'application/json' },
      body,
    });
    assert.equal(result.status, 200);
    assert.equal(llamadas.length, 3);
    const [original, , reintento] = llamadas;
    assert.equal(original.headers.get('authorization'), 'Bearer vencido');
    assert.equal(reintento.headers.get('authorization'), 'Bearer nuevo-access');
    assert.equal(reintento.headers.get('x-downtimeos-planta'), 'p-1');
    assert.equal(reintento.init.body, body);
    assert.deepEqual(globalThis.window.localStorage.leer(), {
      access_token: 'nuevo-access', refresh_token: 'nuevo-refresh',
      user: { id: 'u-1' }, perfil: { user_id: 'u-1', planta_id: 'p-1' }, plantas_disponibles: [],
    });
  } finally { restaurar(); }
});

test('respeta el Authorization recién obtenido por el callback y no lo sustituye por otra cuenta', async () => {
  const autorizaciones = [];
  const restaurar = instalarNavegador({ access_token: 'token-viejo', refresh_token: 'refresh-viejo' }, async (url, init = {}) => {
    autorizaciones.push(new Headers(init.headers).get('authorization'));
    return respuesta(401);
  });
  try {
    const result = await fetchConSesion('/api/cuenta', { headers: { authorization: 'Bearer token-recien-obtenido' } });
    assert.equal(result.status, 401);
    assert.deepEqual(autorizaciones, ['Bearer token-recien-obtenido']);
    assert.equal(globalThis.window.localStorage.leer().access_token, 'token-viejo');
  } finally { restaurar(); }
});

test('si el Bearer explícito coincide con la sesión guardada comparte el refresh normal', async () => {
  const autorizaciones = [];
  const restaurar = instalarNavegador({ access_token: 'token-actual', refresh_token: 'refresh-actual', user: { id: 'u-1' }, perfil: { user_id: 'u-1', planta_id: 'p-1' } }, async (url, init = {}) => {
    if (url === '/api/cuenta' && init.method === 'POST') return respuesta(200, {
      access_token: 'token-renovado', refresh_token: 'refresh-renovado', perfil: { user_id: 'u-1', planta_id: 'p-1' },
    });
    autorizaciones.push(new Headers(init.headers).get('authorization'));
    return autorizaciones.length === 1 ? respuesta(401) : respuesta(200);
  });
  try {
    const result = await fetchConSesion('/api/cuenta', { headers: { authorization: 'Bearer token-actual' } });
    assert.equal(result.status, 200);
    assert.deepEqual(autorizaciones, ['Bearer token-actual', 'Bearer token-renovado']);
  } finally { restaurar(); }
});

test('sin refresh token devuelve el 401 original y no intenta renovar', async () => {
  let llamadas = 0;
  const restaurar = instalarNavegador({ access_token: 'vencido', perfil: { planta_id: 'p-1' } }, async () => {
    llamadas += 1; return respuesta(401, { error: 'expired' });
  });
  try {
    const result = await fetchConSesion('/api/planta/equipo');
    assert.equal(result.status, 401);
    assert.equal(llamadas, 1);
    assert.equal(globalThis.window.localStorage.leer().access_token, 'vencido');
  } finally { restaurar(); }
});

test('si el refresh falla no borra sesión ni reintenta la petición protegida', async () => {
  const llamadas = [];
  const restaurar = instalarNavegador({ access_token: 'vencido', refresh_token: 'refresh-anterior', perfil: { planta_id: 'p-1' } }, async (url) => {
    llamadas.push(url);
    return url === '/api/cuenta' ? respuesta(503, { error: 'temporal' }) : respuesta(401, { error: 'expired' });
  });
  try {
    const result = await fetchConSesion('/api/planta/suscripcion');
    assert.equal(result.status, 401);
    assert.deepEqual(llamadas, ['/api/planta/suscripcion', '/api/cuenta']);
    assert.deepEqual(globalThis.window.localStorage.leer(), {
      access_token: 'vencido', refresh_token: 'refresh-anterior', perfil: { planta_id: 'p-1' },
    });
  } finally { restaurar(); }
});

test('no reintenta una mutación con la sesión de otra cuenta si cambia durante el 401', async () => {
  let responderPrimera;
  const primeraPendiente = new Promise((resolve) => { responderPrimera = resolve; });
  const autorizaciones = [];
  const cuentaA = {
    access_token: 'access-a', refresh_token: 'refresh-a',
    user: { id: 'usuario-a' }, perfil: { user_id: 'usuario-a', planta_id: 'planta-a' },
  };
  const cuentaB = {
    access_token: 'access-b', refresh_token: 'refresh-b',
    user: { id: 'usuario-b' }, perfil: { user_id: 'usuario-b', planta_id: 'planta-b' },
  };
  const restaurar = instalarNavegador(cuentaA, async (_url, init = {}) => {
    autorizaciones.push(new Headers(init.headers).get('authorization'));
    if (autorizaciones.length === 1) return primeraPendiente;
    return respuesta(200, { ok: true });
  });
  try {
    const body = JSON.stringify({ accion: 'cerrar', evento_id: 'evento-a' });
    const peticion = fetchConSesion('/api/planta/eventos', {
      method: 'PATCH',
      headers: { authorization: 'Bearer access-a', 'x-downtimeos-planta': 'planta-a' },
      body,
    });
    guardarSesionNavegador(cuentaB);
    responderPrimera(respuesta(401, { error: 'expired' }));

    const result = await peticion;

    assert.equal(result.status, 401);
    assert.deepEqual(autorizaciones, ['Bearer access-a']);
    assert.deepEqual(globalThis.window.localStorage.leer(), cuentaB);
  } finally { restaurar(); }
});

test('una renovación tardía no reemplaza la sesión de otra cuenta ni reintenta su mutación', async () => {
  let resolverRefresh;
  let indicarRefresh;
  const refreshIniciado = new Promise((resolve) => { indicarRefresh = resolve; });
  const respuestaRefresh = new Promise((resolve) => { resolverRefresh = resolve; });
  const solicitudesProtegidas = [];
  const cuentaA = {
    access_token: 'access-a', refresh_token: 'refresh-a',
    user: { id: 'usuario-a' }, perfil: { user_id: 'usuario-a', planta_id: 'planta-a' },
  };
  const cuentaB = {
    access_token: 'access-b', refresh_token: 'refresh-b',
    user: { id: 'usuario-b' }, perfil: { user_id: 'usuario-b', planta_id: 'planta-b' },
  };
  const restaurar = instalarNavegador(cuentaA, async (url, init = {}) => {
    if (url === '/api/cuenta') {
      indicarRefresh();
      return respuestaRefresh;
    }
    solicitudesProtegidas.push(new Headers(init.headers).get('authorization'));
    return solicitudesProtegidas.length === 1 ? respuesta(401, { error: 'expired' }) : respuesta(200, { ok: true });
  });
  try {
    const peticion = fetchConSesion('/api/planta/eventos', {
      method: 'PATCH',
      headers: { authorization: 'Bearer access-a', 'x-downtimeos-planta': 'planta-a' },
      body: JSON.stringify({ accion: 'cerrar', evento_id: 'evento-a' }),
    });
    await refreshIniciado;
    guardarSesionNavegador(cuentaB);
    resolverRefresh(respuesta(200, {
      access_token: 'access-a-renovado', refresh_token: 'refresh-a-renovado',
      perfil: { user_id: 'usuario-a', planta_id: 'planta-a' }, plantas_disponibles: [],
    }));

    const result = await peticion;

    assert.equal(result.status, 401);
    assert.deepEqual(solicitudesProtegidas, ['Bearer access-a']);
    assert.deepEqual(globalThis.window.localStorage.leer(), cuentaB);
  } finally { restaurar(); }
});

test('dos cuentas concurrentes renuevan por separado sin compartir ni pisar tokens', async () => {
  let liberarRefreshA;
  let indicarRefreshA;
  const refreshAIniciado = new Promise((resolve) => { indicarRefreshA = resolve; });
  const respuestaRefreshA = new Promise((resolve) => { liberarRefreshA = resolve; });
  const refreshTokens = [];
  const intentos = new Map();
  const cuentaA = {
    access_token: 'access-a', refresh_token: 'refresh-a',
    user: { id: 'usuario-a' }, perfil: { user_id: 'usuario-a', planta_id: 'planta-a' },
  };
  const cuentaB = {
    access_token: 'access-b', refresh_token: 'refresh-b',
    user: { id: 'usuario-b' }, perfil: { user_id: 'usuario-b', planta_id: 'planta-b' },
  };
  const restaurar = instalarNavegador(cuentaA, async (url, init = {}) => {
    if (url === '/api/cuenta') {
      const token = JSON.parse(init.body).refresh_token;
      refreshTokens.push(token);
      if (token === 'refresh-a') {
        indicarRefreshA();
        return respuestaRefreshA;
      }
      return respuesta(200, {
        access_token: 'access-b-renovado', refresh_token: 'refresh-b-renovado',
        perfil: { user_id: 'usuario-b', planta_id: 'planta-b' },
      });
    }
    const autorizacion = new Headers(init.headers).get('authorization');
    const numero = (intentos.get(url) || 0) + 1;
    intentos.set(url, numero);
    if (numero === 1) return respuesta(401, { error: 'expired' });
    return respuesta(200, { ok: true, autorizacion });
  });
  try {
    const peticionA = fetchConSesion('/api/recurso-a', { headers: { authorization: 'Bearer access-a' } });
    await refreshAIniciado;

    guardarSesionNavegador(cuentaB);
    const resultB = await fetchConSesion('/api/recurso-b', { headers: { authorization: 'Bearer access-b' } });
    liberarRefreshA(respuesta(200, {
      access_token: 'access-a-renovado', refresh_token: 'refresh-a-renovado',
      perfil: { user_id: 'usuario-a', planta_id: 'planta-a' },
    }));
    const resultA = await peticionA;

    assert.equal(resultB.status, 200);
    assert.equal(resultA.status, 401);
    assert.deepEqual(refreshTokens.sort(), ['refresh-a', 'refresh-b']);
    assert.deepEqual(globalThis.window.localStorage.leer(), {
      ...cuentaB, access_token: 'access-b-renovado', refresh_token: 'refresh-b-renovado',
    });
  } finally { restaurar(); }
});

test('una renovación tardía conserva la planta elegida mientras esperaba el servidor', async () => {
  let liberarRefresh;
  let indicarRefresh;
  const refreshIniciado = new Promise((resolve) => { indicarRefresh = resolve; });
  const respuestaRefresh = new Promise((resolve) => { liberarRefresh = resolve; });
  const cuenta = {
    access_token: 'access-actual', refresh_token: 'refresh-actual',
    user: { id: 'usuario-a' }, perfil: { user_id: 'usuario-a', planta_id: 'planta-vieja' },
    plantas_disponibles: [{ planta_id: 'planta-vieja' }],
  };
  const restaurar = instalarNavegador(cuenta, async (url, init = {}) => {
    if (url === '/api/cuenta') { indicarRefresh(); return respuestaRefresh; }
    return new Headers(init.headers).get('authorization') === 'Bearer access-renovado'
      ? respuesta(200, { ok: true }) : respuesta(401, { error: 'expired' });
  });
  try {
    const peticion = fetchConSesion('/api/planta/estructura', { headers: { authorization: 'Bearer access-actual' } });
    await refreshIniciado;
    guardarSesionNavegador({
      ...cuenta,
      perfil: { user_id: 'usuario-a', planta_id: 'planta-elegida' },
      plantas_disponibles: [{ planta_id: 'planta-elegida' }],
    });
    liberarRefresh(respuesta(200, {
      access_token: 'access-renovado', refresh_token: 'refresh-renovado',
      perfil: { user_id: 'usuario-a', planta_id: 'planta-vieja' },
      plantas_disponibles: [{ planta_id: 'planta-vieja' }],
    }));

    const result = await peticion;

    assert.equal(result.status, 200);
    assert.equal(globalThis.window.localStorage.leer().perfil.planta_id, 'planta-elegida');
    assert.deepEqual(globalThis.window.localStorage.leer().plantas_disponibles, [{ planta_id: 'planta-elegida' }]);
  } finally { restaurar(); }
});

test('peticiones simultáneas comparten una sola renovación', async () => {
  let refreshes = 0;
  let liberando;
  const esperaRefresh = new Promise((resolve) => { liberando = resolve; });
  const intentos = new Map();
  const restaurar = instalarNavegador({ access_token: 'vencido', refresh_token: 'refresh', user: { id: 'u-1' }, perfil: { user_id: 'u-1', planta_id: 'p-1' } }, async (url) => {
    if (url === '/api/cuenta') {
      refreshes += 1;
      await esperaRefresh;
      return respuesta(200, { access_token: 'nuevo', refresh_token: 'refresh-2', perfil: { user_id: 'u-1', planta_id: 'p-1' } });
    }
    const cuenta = (intentos.get(url) || 0) + 1;
    intentos.set(url, cuenta);
    if (cuenta === 1) {
      if (intentos.size === 2) liberando();
      return respuesta(401);
    }
    return respuesta(200);
  });
  try {
    const resultados = await Promise.all([
      fetchConSesion('/api/planta/equipo'),
      fetchConSesion('/api/planta/suscripcion'),
    ]);
    assert.deepEqual(resultados.map((r) => r.status), [200, 200]);
    assert.equal(refreshes, 1);
  } finally { restaurar(); }
});

test('endpoint renueva desde Supabase y reconstruye el perfil con identidad devuelta por Auth', async () => {
  const [cuenta, endpoint] = await Promise.all([
    readFile(new URL('../lib/cuenta.js', import.meta.url), 'utf8'),
    readFile(new URL('../api/cuenta/index.js', import.meta.url), 'utf8'),
  ]);
  assert.match(cuenta, /authPublico\.auth\.refreshSession\(\{\s*refresh_token:\s*token\s*\}\)/);
  assert.match(cuenta, /resolverPerfil\(data\.user\.id, plantaSolicitada\s*\|\|\s*null\)/);
  assert.match(endpoint, /cuerpo\.accion\s*===\s*'refrescar'/);
  assert.match(endpoint, /renovarSesion\(cuerpo\.refresh_token, req\.headers\?\.\['x-downtimeos-planta'\]/);
});

test('el dashboard legacy renueva solo fetch autenticados y conserva modo sin sesión/demo', async () => {
  const datos = await readFile(new URL('../public/demo/js/datos.js', import.meta.url), 'utf8');
  assert.match(datos, /function fetchConSesion\(url, opciones\)/);
  assert.match(datos, /if \(!authorization \|\| !\/\^Bearer\\s\+\/i\.test\(authorization\)\) return fetchNativo\(url, opciones\)/);
  assert.match(datos, /accion: "refrescar", refresh_token: sesion\.refresh_token/);
  assert.match(datos, /conAuthorization\(headers, tokenRenovado\)/);
  assert.match(datos, /if \(fetchNativo\) global\.fetch = fetchConSesion/);
  assert.match(datos, /tokenUsado !== sesion\.access_token\) return primera/);
  assert.match(datos, /var headers = cabecerasApi\([\s\S]*?fetchConSesion\(API, \{ headers: headers/);
  assert.match(datos, /return fetchConSesion\(API \+ ruta/);
});
