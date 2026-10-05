#!/usr/bin/env node

/**
 * Opt-in integration runner for a disposable Supabase Local project and a
 * locally running Next.js app. This file deliberately does not load .env files,
 * start services, run migrations, or clean up created records.
 *
 * Required local shell variables:
 *   MVP_E2E_LOCAL=1
 *   MVP_E2E_DATABASE_DISPOSABLE=1
 *   SUPABASE_URL=http://127.0.0.1:54321
 *   SUPABASE_SECRET_KEY=<local Supabase service_role/secret key>
 *   SUPABASE_PUBLISHABLE_KEY=<local Supabase anon/publishable key>
 *   APP_URL=http://127.0.0.1:3000
 * Optional:
 *   MVP_E2E_MAILPIT_URL=http://127.0.0.1:54324 (or a local Mailpit URL)
 *   MVP_E2E_ADMIN_EMAIL / MVP_E2E_ADMIN_PASSWORD (to verify the local payment
 *   in the product's admin API and test paid-plan asset limits).
 *   MVP_E2E_BROWSER=1 plus MVP_E2E_BROWSER_EXECUTABLE (to run isolated Edge
 *   UI checks with the synthetic sessions produced by this disposable E2E).
 *
 * The app must be started in a shell/container configured with the SAME local
 * SUPABASE_URL and keys. The app's /api/config URL is checked before writes.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  BUCKETS_CON_ARCHIVOS_TENANT_E2E,
  esUrlFirmadaStorageLocal,
  TABLAS_CON_DATOS_TENANT_E2E,
  validarBaseE2E,
} from './e2e-mvp-preflight.js';

const SUITES = [];
const OMITTED = [];
const timeoutMs = 8_000;

function report(message) {
  console.log(`[e2e-mvp-local] ${message}`);
}

function fail(message) {
  throw new Error(message);
}

function localUrl(value, label, { required = true } = {}) {
  if (!value && !required) return null;
  if (!value) fail(`${label} es obligatorio para el E2E local.`);
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`${label} no es una URL válida.`);
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  const esLoopbackIPv4 = ipv4 && Number(ipv4[1]) === 127
    && ipv4.slice(1).every((octeto) => Number(octeto) >= 0 && Number(octeto) <= 255);
  const esLoopback = host === 'localhost' || host.endsWith('.localhost')
    || host === '::1' || esLoopbackIPv4;
  if (!esLoopback || !['http:', 'https:'].includes(url.protocol)
    || url.username || url.password || url.search || url.hash) {
    fail(`${label} debe ser HTTP(S) y apuntar únicamente a loopback/local (localhost, 127.0.0.0/8 o ::1), sin credenciales, query ni fragmento.`);
  }
  return url;
}

function validateEnvironment() {
  if (process.env.MVP_E2E_LOCAL !== '1') {
    fail('Ejecución bloqueada. Define MVP_E2E_LOCAL=1 solo en tu Supabase Local desechable.');
  }
  if (process.env.MVP_E2E_DATABASE_DISPOSABLE !== '1') {
    fail('Ejecución bloqueada. Confirma una base desechable con MVP_E2E_DATABASE_DISPOSABLE=1. El runner no elimina sus datos.');
  }

  // Check every URL-like environment variable supplied to the runner, not only
  // the one selected below, so a stray production URL cannot be silently used.
  const urlVariable = /(?:SUPABASE.*URL|(?:^|_)APP_URL$|SITE_URL$|MVP_E2E_MAILPIT_URL$)/i;
  for (const [name, value] of Object.entries(process.env)) {
    if (value && urlVariable.test(name)) localUrl(value, name);
  }

  const supabase = localUrl(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL, 'SUPABASE_URL');
  const app = localUrl(process.env.MVP_E2E_APP_URL || process.env.APP_URL || process.env.NEXT_PUBLIC_SITE_URL
    || 'http://127.0.0.1:3000', 'APP_URL');
  const publicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    ? localUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL') : null;
  if (publicUrl && publicUrl.origin !== supabase.origin) {
    fail('SUPABASE_URL y NEXT_PUBLIC_SUPABASE_URL no coinciden; no se harán escrituras.');
  }

  const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const anonBearerKey = process.env.SUPABASE_ANON_JWT_KEY || process.env.SUPABASE_ANON_KEY || anonKey;
  const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!anonKey || !secretKey) fail('Faltan la clave pública local y SUPABASE_SECRET_KEY local. Nunca se imprimirán.');
  const adminEmail = process.env.MVP_E2E_ADMIN_EMAIL;
  const adminPassword = process.env.MVP_E2E_ADMIN_PASSWORD;
  if (Boolean(adminEmail) !== Boolean(adminPassword)) fail('Para activar el pago local define ambos MVP_E2E_ADMIN_EMAIL y MVP_E2E_ADMIN_PASSWORD.');
  if (process.env.MVP_E2E_BROWSER && process.env.MVP_E2E_BROWSER !== '1') fail('MVP_E2E_BROWSER solo acepta el valor 1.');
  if (process.env.MVP_E2E_BROWSER === '1' && (!adminEmail || !process.env.MVP_E2E_BROWSER_EXECUTABLE)) {
    fail('El UI QA requiere la administración E2E local y una ruta absoluta a Edge en MVP_E2E_BROWSER_EXECUTABLE.');
  }
  if (adminEmail && (adminEmail !== process.env.DASHBOARD_ADMIN_EMAIL || adminPassword !== process.env.DASHBOARD_ADMIN_PASSWORD)) {
    fail('Las credenciales MVP_E2E_ADMIN_* deben coincidir con DASHBOARD_ADMIN_* del servidor Next local.');
  }

  return {
    supabase,
    app,
    anonKey,
    anonBearerKey,
    secretKey,
    mailpit: localUrl(process.env.MVP_E2E_MAILPIT_URL || 'http://127.0.0.1:54324', 'MVP_E2E_MAILPIT_URL'),
  };
}

async function fetchLocal(url, init = {}, expectedOrigin, label = 'petición', redirectAllowlist = [expectedOrigin]) {
  const target = url instanceof URL ? url : new URL(url);
  if (target.origin !== expectedOrigin) fail(`${label}: destino no local o inesperado; petición bloqueada.`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(target, { ...init, redirect: 'manual', signal: controller.signal });
    const location = response.headers.get('location');
    if (location) {
      const redirect = new URL(location, target);
      if (!redirectAllowlist.includes(redirect.origin)) fail(`${label}: redirección fuera del servicio local bloqueada.`);
    }
    return response;
  } catch (error) {
    if (error?.name === 'AbortError') fail(`${label}: excedió ${timeoutMs} ms.`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function responseJson(response, label) {
  const body = await response.text();
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    fail(`${label}: respuesta no JSON (HTTP ${response.status}).`);
  }
}

function assertStatus(response, expected, label) {
  if (!expected.includes(response.status)) {
    // Do not echo server-controlled content; errors can contain sensitive data.
    fail(`${label}: HTTP ${response.status}; esperado ${expected.join('/')}.`);
  }
}

async function countTableRows(table, headers, supabase, supabaseOrigin) {
  const response = await fetchLocal(new URL(`/rest/v1/${encodeURIComponent(table)}?select=*&limit=1`, supabase), {
    headers: { ...headers, prefer: 'count=exact' },
  }, supabaseOrigin, `verificación de datos previos en ${table}`);
  assertStatus(response, [200], `verificación de datos previos en ${table}`);
  const rows = await responseJson(response, `verificación de datos previos en ${table}`);
  const total = Number(response.headers.get('content-range')?.split('/')[1]);
  if (!Array.isArray(rows) || !Number.isSafeInteger(total) || total < 0) {
    fail(`No se pudo verificar de forma segura si ${table} está vacía; no se harán escrituras.`);
  }
  return { total };
}

function jsonHeaders(token = null, plantId = null) {
  return {
    'content-type': 'application/json',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(plantId ? { 'x-downtimeos-planta': plantId } : {}),
  };
}

function printableId(value, label) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''))) {
    fail(`${label} no devolvió un UUID válido.`);
  }
  return value;
}

function testEmail(role, suffix) {
  return `mvp-e2e-${role}-${suffix}@example.test`;
}

function htmlToText(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&').replace(/&#x2F;/gi, '/').replace(/&#47;/gi, '/')
    .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>');
}

async function tryMailpit(base) {
  try {
    const response = await fetchLocal(new URL('/api/v1/messages?limit=10', base), {}, base.origin, 'Mailpit');
    if (!response.ok) return false;
    const data = await responseJson(response, 'Mailpit');
    return Array.isArray(data.messages);
  } catch {
    return false;
  }
}

function recipients(message) {
  return (message?.To || message?.to || []).map((item) => String(item.Address || item.address || item).toLowerCase());
}

async function waitForMail(base, email, coincide = () => true) {
  const until = Date.now() + 12_000;
  while (Date.now() < until) {
    const listResponse = await fetchLocal(new URL('/api/v1/messages?limit=50', base), {}, base.origin, 'Mailpit mensajes');
    if (listResponse.ok) {
      const list = await responseJson(listResponse, 'Mailpit mensajes');
      const found = (list.messages || []).find((message) => recipients(message).includes(email.toLowerCase()) && coincide(message));
      if (found?.ID || found?.id) {
        const id = found.ID || found.id;
        const fullResponse = await fetchLocal(new URL(`/api/v1/message/${encodeURIComponent(id)}`, base), {}, base.origin, 'Mailpit correo');
        if (fullResponse.ok) return responseJson(fullResponse, 'Mailpit correo');
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return null;
}

function mailLinks(message) {
  const sources = [message?.HTML, message?.Text, message?.text, message?.html]
    .flatMap((value) => Array.isArray(value) ? value : [value]).filter(Boolean).join('\n');
  const links = [];
  for (const match of sources.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    const candidate = htmlToText(match[1]);
    try { links.push(new URL(candidate)); } catch { /* ignore non-URL attributes */ }
  }
  for (const match of sources.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    try { links.push(new URL(htmlToText(match[0]))); } catch { /* ignore malformed URL */ }
  }
  return links;
}

async function confirmFromEmail(mailpit, email, supabaseOrigin, appOrigin, tipo = 'invitation') {
  const subjectPattern = tipo === 'recovery' ? /password|reset|recovery/i : /confirm|invitation|invitation/i;
  const message = await waitForMail(mailpit, email, (item) => subjectPattern.test(String(item.Subject || item.subject || '')));
  if (!message) return null;
  const verifyUrl = mailLinks(message).find((url) => /\/auth\/v1\/verify\/?$/i.test(url.pathname));
  if (!verifyUrl || verifyUrl.origin !== supabaseOrigin) return null;
  // Supabase Auth's confirmation link may redirect only to the allow-listed
  // local app origin. Every hop is checked and redirects are never followed
  // automatically by fetch.
  let current = verifyUrl;
  for (let hop = 0; hop < 8; hop += 1) {
    if (current.origin === appOrigin) {
      const hashParams = new URLSearchParams(current.hash.slice(1));
      if (hashParams.get('access_token')) {
        return { accessToken: hashParams.get('access_token'), redirect: current };
      }
      return null;
    }
    if (current.origin !== supabaseOrigin) return null;
    const response = await fetchLocal(current, {}, supabaseOrigin, 'Confirmación Auth local', [supabaseOrigin, appOrigin]);
    const location = response.headers.get('location');
    if (!location) return null;
    current = new URL(location, current);
    if (current.origin !== supabaseOrigin && current.origin !== appOrigin) return null;
  }
  return null;
}

async function localAuthUserId(authApi, adminHeaders, supabaseOrigin, email) {
  const response = await fetchLocal(new URL('admin/users?page=1&per_page=100', authApi), {
    headers: adminHeaders,
  }, supabaseOrigin, 'búsqueda local del usuario E2E');
  assertStatus(response, [200], 'Auth Admin local al resolver usuario E2E');
  const body = await responseJson(response, 'Auth Admin local al resolver usuario E2E');
  if (!Array.isArray(body.users)) fail('Auth Admin local no devolvió usuarios para el E2E.');
  const user = body.users.find((candidate) => String(candidate.email || '').toLowerCase() === email.toLowerCase());
  return printableId(user?.id, `usuario E2E ${email}`);
}

async function run() {
  const env = validateEnvironment();
  const supabaseOrigin = env.supabase.origin;
  const appOrigin = env.app.origin;
  const apiKey = env.anonKey;
  const serviceKey = env.secretKey;

  // Before any write, verify both local services and the runtime Supabase URL
  // advertised by the app. This cannot inspect another process's secret env;
  // the precondition is to launch Next with the same local variables.
  const configResponse = await fetchLocal(new URL('/api/config', env.app), {}, appOrigin, 'configuración local de la app');
  assertStatus(configResponse, [200], 'GET /api/config');
  const config = await responseJson(configResponse, 'GET /api/config');
  const runtimeSupabase = localUrl(config.supabase_url, 'URL de Supabase reportada por la app');
  assert.equal(runtimeSupabase.origin, supabaseOrigin, 'La app debe reportar exactamente el Supabase Local indicado por SUPABASE_URL.');
  assert.ok(config.supabase_publishable_key, 'La app debe tener configurada su clave pública local.');
  if (config.supabase_publishable_key !== env.anonKey) {
    fail('La clave pública del servidor Next no coincide con la clave local del runner; no se harán escrituras.');
  }
  const healthResponse = await fetchLocal(new URL('/api/health', env.app), {}, appOrigin, 'health local');
  assertStatus(healthResponse, [200], 'GET /api/health');
  const health = await responseJson(healthResponse, 'GET /api/health');
  assert.equal(health.ok, true, 'Next debe responder health OK con Supabase Local accesible.');

  const authApi = new URL('/auth/v1/', env.supabase);
  const adminHeaders = { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' };
  const publicHeaders = { apikey: apiKey, 'content-type': 'application/json' };

  const authProbe = await fetchLocal(new URL('admin/users?page=1&per_page=1', authApi), {
    headers: adminHeaders,
  }, supabaseOrigin, 'verificación de Supabase Local');
  assertStatus(authProbe, [200], 'Auth Admin local');
  const existingAuth = await responseJson(authProbe, 'Auth Admin local');
  if (!Array.isArray(existingAuth.users)) fail('Auth Admin local no devolvió una lista verificable; no se harán escrituras.');
  if (existingAuth.users.length) fail('La base Auth ya contiene usuarios. Usa una base Supabase Local vacía y desechable; este runner no limpia cuentas ni datos.');

  const organizationProbe = await fetchLocal(new URL('/rest/v1/organizaciones?select=id,nombre&limit=2', env.supabase), {
    headers: { ...adminHeaders, prefer: 'count=exact' },
  }, supabaseOrigin, 'verificación de organizaciones locales');
  assertStatus(organizationProbe, [200], 'REST organizaciones local');
  const existingOrganizations = await responseJson(organizationProbe, 'REST organizaciones local');
  const organizationTotal = Number(organizationProbe.headers.get('content-range')?.split('/')[1]);

  let bootstrap = { plantasLegacy: [], totalPlantasLegacy: 0 };
  if (organizationTotal === 1 && existingOrganizations?.length === 1
    && existingOrganizations[0]?.nombre === 'Histórico DowntimeOS') {
    const organizacionId = existingOrganizations[0].id;
    async function contarFilas(path, label) {
      const response = await fetchLocal(new URL(path, env.supabase), {
        headers: { ...adminHeaders, prefer: 'count=exact' },
      }, supabaseOrigin, label);
      assertStatus(response, [200], label);
      const filas = await responseJson(response, label);
      const total = Number(response.headers.get('content-range')?.split('/')[1]);
      if (!Array.isArray(filas) || !Number.isSafeInteger(total)) fail(`${label}: no se pudo verificar el total.`);
      return { filas, total };
    }

    bootstrap = await contarFilas(
      `/rest/v1/plantas?select=id,organizacion_id,codigo&organizacion_id=eq.${encodeURIComponent(organizacionId)}&limit=2`,
      'verificación de planta histórica local',
    ).then(({ filas, total }) => ({ plantasLegacy: filas, totalPlantasLegacy: total }));
  }

  const filasTenant = {};
  for (const tabla of TABLAS_CON_DATOS_TENANT_E2E) {
    const { total } = await countTableRows(tabla, adminHeaders, env.supabase, supabaseOrigin);
    filasTenant[tabla] = total;
  }

  const bucketsConArchivos = [];
  for (const bucket of BUCKETS_CON_ARCHIVOS_TENANT_E2E) {
    const response = await fetchLocal(new URL(`/storage/v1/object/list/${encodeURIComponent(bucket)}`, env.supabase), {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ prefix: '', limit: 1, offset: 0, sortBy: { column: 'name', order: 'asc' } }),
    }, supabaseOrigin, `verificación de archivos en Storage ${bucket}`);
    assertStatus(response, [200], `verificación de archivos en Storage ${bucket}`);
    const objetos = await responseJson(response, `verificación de archivos en Storage ${bucket}`);
    if (!Array.isArray(objetos)) fail(`No se pudo verificar el contenido del bucket ${bucket}; no se harán escrituras.`);
    if (objetos.length > 0) bucketsConArchivos.push(bucket);
  }

  if (!validarBaseE2E({
    organizaciones: existingOrganizations,
    totalOrganizaciones: organizationTotal,
    ...bootstrap,
    filasTenant,
    bucketsConArchivos,
  })) {
    const tablasConDatos = Object.entries(filasTenant).filter(([, total]) => total > 0).map(([tabla]) => tabla);
    const detalle = tablasConDatos.length ? ` Tablas con datos: ${tablasConDatos.join(', ')}.` : '';
    const archivosPrevios = bucketsConArchivos.length ? ` Buckets con archivos: ${bucketsConArchivos.join(', ')}.` : '';
    fail(`La base no está vacía para el E2E${detalle}${archivosPrevios} Usa un Supabase Local desechable; el runner no limpia datos.`);
  }

  const mailpitAvailable = await tryMailpit(env.mailpit);
  if (!mailpitAvailable) {
    OMITTED.push('Confirmación por correo del titular: Mailpit no respondió; se usará confirmación administrativa local como fallback.');
  }

  async function createCompany(label, email, suffix) {
    const password = `LocalMvp-${randomUUID()}-Aa9!`;
    const registration = await fetchLocal(new URL('/api/cuenta', env.app), {
      method: 'POST', headers: jsonHeaders(),
      body: JSON.stringify({ accion: 'registro', empresa: `E2E ${label} ${suffix}`, planta: `Planta ${label} ${suffix}`, nombre: `MVP ${label}`, email, password }),
    }, appOrigin, `registro ${label}`);
    const registrationData = await responseJson(registration, `registro ${label}`);
    assertStatus(registration, [201], `POST /api/cuenta registro ${label}`, registrationData);
    assert.deepEqual(registrationData, { ok: true, siguiente: 'confirmar_o_iniciar_sesion' }, 'registro no debe exponer si la cuenta existía ni datos de la organización');
    const userId = await localAuthUserId(authApi, adminHeaders, supabaseOrigin, email);

    if (mailpitAvailable) {
      const confirmacion = await confirmFromEmail(env.mailpit, email, supabaseOrigin, appOrigin, 'signup');
      assert.ok(confirmacion?.accessToken, `Mailpit debe entregar el enlace de confirmación del titular ${label}.`);
      assert.equal(confirmacion.redirect.pathname, '/activar', `el registro ${label} debe regresar al flujo de activación.`);
      const activarResponse = await fetchLocal(new URL('/activar', env.app), {}, appOrigin, `pantalla de activación ${label}`);
      assertStatus(activarResponse, [200], `GET /activar registro ${label}`);
      const perfilConfirmadoResponse = await fetchLocal(new URL('/api/cuenta', env.app), {
        headers: jsonHeaders(confirmacion.accessToken),
      }, appOrigin, `perfil confirmado ${label}`);
      const perfilConfirmado = await responseJson(perfilConfirmadoResponse, `perfil confirmado ${label}`);
      assertStatus(perfilConfirmadoResponse, [200], `GET /api/cuenta tras confirmar registro ${label}`, perfilConfirmado);
      assert.equal(perfilConfirmado.perfil.rol, 'direccion');
      report(`PASS confirmación de titular ${label} vía Mailpit · retorno /activar`);
    } else {
      // Fallback exclusivamente local: conserva la cobertura de registro/login
      // aunque una instalación no tenga el buzón de pruebas de Supabase.
      const confirmResponse = await fetchLocal(new URL(`admin/users/${userId}`, authApi), {
        method: 'PUT', headers: adminHeaders, body: JSON.stringify({ email_confirm: true }),
      }, supabaseOrigin, `confirmación local ${label}`);
      assertStatus(confirmResponse, [200], `Auth admin confirm ${label}`);
      await confirmResponse.arrayBuffer();
    }

    const loginResponse = await fetchLocal(new URL('/api/cuenta', env.app), {
      method: 'POST', headers: jsonHeaders(),
      body: JSON.stringify({ accion: 'inicio', email, password }),
    }, appOrigin, `login ${label}`);
    const login = await responseJson(loginResponse, `login ${label}`);
    assertStatus(loginResponse, [200], `POST /api/cuenta inicio ${label}`, login);
    assert.ok(login.access_token, `login ${label} debe emitir una sesión.`);

    const accountResponse = await fetchLocal(new URL('/api/cuenta', env.app), {
      headers: jsonHeaders(login.access_token),
    }, appOrigin, `perfil ${label}`);
    const account = await responseJson(accountResponse, `perfil ${label}`);
    assertStatus(accountResponse, [200], `GET /api/cuenta ${label}`, account);
    assert.equal(account.perfil.rol, 'direccion', `el propietario ${label} debe ser Dirección.`);
    assert.equal(account.perfil.es_admin_cuenta, true, `el propietario ${label} debe administrar su cuenta.`);
    const plantId = printableId(account.perfil.planta_id, `planta ${label}`);
    const orgId = printableId(account.perfil.organizacion_id, `organización ${label}`);
    report(`PASS registro/login ${label} · usuario=${userId} · organización=${orgId} · email=${email}`);
    return { label, email, password, userId, token: login.access_token, plantId, orgId, account };
  }

  async function configure(company, label, suffix) {
    const lineCode = 'L-01';
    const machineCode = 'M-01';
    const configResponse2 = await fetchLocal(new URL('/api/planta/configuracion', env.app), {
      method: 'POST', headers: jsonHeaders(company.token, company.plantId),
      body: JSON.stringify({
        lineas: [{ id: lineCode, nombre: `Línea ${label} ${suffix}`, orden: 1 }],
        activos: [{ id: machineCode, linea_id: lineCode, tipo: 'MA', nombre: `Máquina ${label} ${suffix}`, etapa: 'Ensamble', etapa_orden: 1, tarifa_hora: 100, cuello_botella: false }],
      }),
    }, appOrigin, `configuración planta ${label}`);
    const data = await responseJson(configResponse2, `configuración planta ${label}`);
    if (!configResponse2.ok) report(`DEBUG configuración ${label} · ${JSON.stringify(data).slice(0, 240)}`);
    assertStatus(configResponse2, [201], `POST /api/planta/configuracion ${label}`, data);
    assert.equal(Number(data.configuracion?.lineas), 1, `${label}: una línea persistida.`);
    assert.equal(Number(data.configuracion?.activos), 1, `${label}: un equipo persistido.`);
    report(`PASS configuración real ${label} · 1 línea/1 equipo`);
  }

  async function getState(company) {
    const response = await fetchLocal(new URL('/api/planta', env.app), {
      headers: jsonHeaders(company.token, company.plantId),
    }, appOrigin, `estado de planta ${company.label}`);
    const data = await responseJson(response, `estado de planta ${company.label}`);
    assertStatus(response, [200], `GET /api/planta ${company.label}`, data);
    return data;
  }

  async function assertPostgrestCannotSee(accessToken, table, select, filters, label) {
    const query = new URLSearchParams({ select });
    for (const [column, value] of Object.entries(filters)) query.set(column, `eq.${value}`);
    const response = await fetchLocal(new URL(`/rest/v1/${table}?${query}`, env.supabase), {
      headers: { apikey: apiKey, authorization: `Bearer ${accessToken}` },
    }, supabaseOrigin, label);
    if ([401, 403].includes(response.status)) {
      await response.arrayBuffer();
      return;
    }
    assertStatus(response, [200], label);
    const rows = await responseJson(response, label);
    assert.ok(Array.isArray(rows), `${label}: PostgREST debe responder una lista.`);
    assert.equal(rows.length, 0, `${label}: un JWT de otro tenant recibió filas ajenas.`);
  }

  async function assertPostgrestCannotList(accessToken, table, label) {
    const response = await fetchLocal(new URL(`/rest/v1/${table}?select=*&limit=1`, env.supabase), {
      headers: { apikey: apiKey, authorization: `Bearer ${accessToken}` },
    }, supabaseOrigin, label);
    if ([401, 403, 404].includes(response.status)) {
      await response.arrayBuffer();
      return;
    }
    assertStatus(response, [200], label);
    const rows = await responseJson(response, label);
    assert.ok(Array.isArray(rows), `${label}: PostgREST debe responder una lista.`);
    assert.equal(rows.length, 0, `${label}: un JWT de usuario recibió datos privados directamente.`);
  }

  async function assertPostgrestCannotSelect(accessToken, table, columns, label) {
    const query = new URLSearchParams({ select: columns, limit: '1' });
    const response = await fetchLocal(new URL(`/rest/v1/${table}?${query}`, env.supabase), {
      headers: { apikey: apiKey, authorization: `Bearer ${accessToken}` },
    }, supabaseOrigin, label);
    if (![401, 403].includes(response.status)) {
      await response.arrayBuffer();
      fail(`${label}: PostgREST no rechazó la lectura directa de columnas restringidas (HTTP ${response.status}).`);
    }
    await response.arrayBuffer();
  }

  async function assertPostgrestMutationDenied(accessToken, method, table, filters, body, label) {
    const query = new URLSearchParams(Object.fromEntries(
      Object.entries(filters).map(([column, value]) => [column, `eq.${value}`]),
    ));
    const response = await fetchLocal(new URL(`/rest/v1/${table}?${query}`, env.supabase), {
      method,
      headers: {
        apikey: apiKey,
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
        prefer: 'return=minimal',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }, supabaseOrigin, label);
    if (![401, 403].includes(response.status)) {
      await response.arrayBuffer();
      fail(`${label}: PostgREST permitió o no rechazó explícitamente ${method} (HTTP ${response.status}).`);
    }
    await response.arrayBuffer();
  }

  const suffix = randomUUID().slice(0, 8);
  const ownerAEmail = testEmail('titular-a', suffix);
  const ownerBEmail = testEmail('titular-b', suffix);
  const ownerA = await createCompany('A', ownerAEmail, suffix);
  await configure(ownerA, 'A', suffix);
  const stateA = await getState(ownerA);
  assert.ok(stateA.lineas.some((linea) => linea.nombre === `Línea A ${suffix}`));
  assert.ok(stateA.activos.some((activo) => activo.nombre === `Máquina A ${suffix}`));

  const ownerB = await createCompany('B', ownerBEmail, suffix);
  await configure(ownerB, 'B', suffix);
  const stateB = await getState(ownerB);
  assert.ok(stateB.lineas.some((linea) => linea.nombre === `Línea B ${suffix}`));
  assert.ok(stateB.activos.some((activo) => activo.nombre === `Máquina B ${suffix}`));
  assert.ok(!stateA.lineas.some((linea) => linea.nombre.includes(` ${suffix}`) && linea.nombre.includes('B ')));
  assert.ok(!stateA.activos.some((activo) => activo.nombre.includes(` ${suffix}`) && activo.nombre.includes('B ')));
  assert.ok(!stateB.lineas.some((linea) => linea.nombre.includes(` ${suffix}`) && linea.nombre.includes('A ')));
  assert.ok(!stateB.activos.some((activo) => activo.nombre.includes(` ${suffix}`) && activo.nombre.includes('A ')));
  assert.notEqual(ownerA.orgId, ownerB.orgId, 'las dos empresas deben tener tenant distinto.');
  for (const probe of [
    { table: 'organizaciones', select: 'id', column: 'id', a: ownerA.orgId, b: ownerB.orgId },
    { table: 'plantas', select: 'id', column: 'id', a: ownerA.plantId, b: ownerB.plantId },
    { table: 'planta_perfiles', select: 'user_id', column: 'user_id', a: ownerA.userId, b: ownerB.userId },
    { table: 'planta_membresias', select: 'user_id', column: 'user_id', a: ownerA.userId, b: ownerB.userId },
    { table: 'planta_lineas', select: 'id,planta_id', column: 'planta_id', a: ownerA.plantId, b: ownerB.plantId, extra: { id: 'L-01' } },
    { table: 'planta_activos', select: 'id,planta_id', column: 'planta_id', a: ownerA.plantId, b: ownerB.plantId, extra: { id: 'M-01' } },
    { table: 'planta_estados', select: 'activo_id,planta_id', column: 'planta_id', a: ownerA.plantId, b: ownerB.plantId, extra: { activo_id: 'M-01' } },
    { table: 'planta_analisis_ia', select: 'id,planta_id', column: 'planta_id', a: ownerA.plantId, b: ownerB.plantId },
    { table: 'planta_cancelaciones', select: 'id,planta_id', column: 'planta_id', a: ownerA.plantId, b: ownerB.plantId },
    { table: 'planta_eventos', select: 'folio,planta_id', column: 'planta_id', a: ownerA.plantId, b: ownerB.plantId },
    { table: 'planta_mensajes', select: 'id,planta_id', column: 'planta_id', a: ownerA.plantId, b: ownerB.plantId },
    { table: 'planta_reportes', select: 'id,planta_id', column: 'planta_id', a: ownerA.plantId, b: ownerB.plantId },
  ]) {
    await assertPostgrestCannotSee(ownerA.token, probe.table, probe.select,
      { ...probe.extra, [probe.column]: probe.b }, `JWT A no lee ${probe.table} de B`);
    await assertPostgrestCannotSee(ownerB.token, probe.table, probe.select,
      { ...probe.extra, [probe.column]: probe.a }, `JWT B no lee ${probe.table} de A`);
  }
  // Las tablas privadas de cobros, invitaciones, auditoría, perfiles y leads
  // no deben poder consultarse desde PostgREST aunque se conozca su nombre.
  // Se prueba acceso directo con JWT real, no solo desde las rutas del servidor.
  const postgrestPrivado = [
    'leads', 'organizacion_admin_delegados', 'organizacion_facturacion',
    'organizacion_pago_comprobante_intentos', 'organizacion_pagos',
    'organizacion_suscripcion_avisos', 'organizacion_suscripciones',
    'planta_auditoria', 'planta_causas', 'planta_interruptores_integraciones', 'planta_solicitudes',
    'planta_invitaciones', 'planta_perfiles', 'planta_proveedor_ia',
    'leads_por_modelo', 'leads_stats', 'planta_auditoria_costeo',
    'planta_bitacora', 'planta_pareto', 'planta_por_activo', 'planta_por_turno_linea',
  ];
  for (const table of postgrestPrivado) {
    await assertPostgrestCannotList(ownerA.token, table, `JWT A no lee directamente ${table}`);
    await assertPostgrestCannotList(ownerB.token, table, `JWT B no lee directamente ${table}`);
  }
  const lineaDirecta = `L-${String(90 + Number.parseInt(suffix.slice(0, 2), 16) % 10).padStart(2, '0')}`;
  const filtrosLineaDirecta = { id: lineaDirecta, planta_id: ownerA.plantId };
  const lineaDirectaBody = {
    ...filtrosLineaDirecta,
    nombre: 'Mutación directa que debe ser denegada',
    descripcion: '',
    orden: 99,
    activa: true,
  };
  for (const method of ['POST', 'PATCH', 'DELETE']) {
    await assertPostgrestMutationDenied(
      ownerA.token,
      method,
      'planta_lineas',
      method === 'POST' ? {} : filtrosLineaDirecta,
      method === 'DELETE' ? null : lineaDirectaBody,
      `JWT autenticado no puede ${method} planta_lineas directamente`,
    );
  }
  for (const method of ['POST', 'PATCH', 'DELETE']) {
    await assertPostgrestMutationDenied(
      env.anonBearerKey,
      method,
      'planta_lineas',
      method === 'POST' ? {} : filtrosLineaDirecta,
      method === 'DELETE' ? null : lineaDirectaBody,
      `JWT anon no puede ${method} planta_lineas directamente`,
    );
  }
  SUITES.push('PostgREST/JWT: aislamiento entre tenants, bloqueo de lecturas privadas y denegación directa de INSERT/UPDATE/DELETE para anon y authenticated');
  report(`PASS aislamiento entre tenants · orgA=${ownerA.orgId} · orgB=${ownerB.orgId}`);

  const order = `E2E-${suffix}`;
  for (const plantas of [0, 101]) {
    const invalidEnterpriseResponse = await fetchLocal(new URL('/api/planta/suscripcion', env.app), {
      method: 'POST', headers: jsonHeaders(ownerA.token, ownerA.plantId),
      body: JSON.stringify({ accion: 'solicitar', plan: 'enterprise', periodicidad: 'anual', plantas }),
    }, appOrigin, `cotización Enterprise inválida (${plantas})`);
    const invalidEnterprise = await responseJson(invalidEnterpriseResponse, `cotización Enterprise inválida (${plantas})`);
    assertStatus(invalidEnterpriseResponse, [400], `Enterprise debe rechazar ${plantas} plantas`, invalidEnterprise);
  }
  report('PASS cotización Enterprise · rechaza 0 y 101 plantas sin normalizarlas');

  const planResponse = await fetchLocal(new URL('/api/planta/suscripcion', env.app), {
    method: 'POST', headers: jsonHeaders(ownerA.token, ownerA.plantId),
    body: JSON.stringify({ accion: 'solicitar', plan: 'starter', periodicidad: 'anual', plantas: 1, orden_compra: order }),
  }, appOrigin, 'solicitud local de plan');
  const planData = await responseJson(planResponse, 'solicitud local de plan');
  assertStatus(planResponse, [201], 'POST /api/planta/suscripcion', planData);
  assert.equal(planData.suscripcion?.estado, 'solicitada', 'la solicitud debe quedar pendiente de validación manual.');
  const subscriptionId = printableId(planData.suscripcion?.id, 'suscripción');
  assert.equal(planData.suscripcion?.orden_compra, order, 'la referencia/OC debe persistir.');

  const billingResponse = await fetchLocal(new URL('/api/planta/suscripcion', env.app), {
    headers: jsonHeaders(ownerA.token, ownerA.plantId),
  }, appOrigin, 'consulta de facturación local');
  const billing = await responseJson(billingResponse, 'consulta de facturación local');
  assertStatus(billingResponse, [200], 'GET /api/planta/suscripcion A', billing);
  assert.ok(billing.suscripciones.some((sub) => sub.id === subscriptionId && sub.estado === 'solicitada'));
  const payment = billing.pagos.find((item) => item.suscripcion_id === subscriptionId);
  assert.ok(payment, 'la solicitud debe crear un pago manual relacionado.');
  assert.equal(payment.estado, 'pendiente', 'el pago manual debe requerir validación administrativa.');
  assert.ok(!billing.pagos.some((item) => item.estado === 'verificado'), 'solicitar un plan no debe autoactivarlo.');
  assert.ok(!Object.hasOwn(payment, 'comprobante_path'), 'la API de cuenta no debe revelar la ruta privada del comprobante.');

  const billingBResponse = await fetchLocal(new URL('/api/planta/suscripcion', env.app), {
    headers: jsonHeaders(ownerB.token, ownerB.plantId),
  }, appOrigin, 'facturación tenant B');
  const billingB = await responseJson(billingBResponse, 'facturación tenant B');
  assertStatus(billingBResponse, [200], 'GET /api/planta/suscripcion B', billingB);
  assert.ok(!billingB.suscripciones.some((sub) => sub.id === subscriptionId), 'tenant B no debe ver la suscripción A.');

  const fiscal = {
    accion: 'facturacion',
    razon_social: `Empresa E2E ${suffix}`,
    rfc: 'AAA010101AA1',
    correo: `cuentas-${suffix}@example.test`,
    domicilio_fiscal: 'Domicilio sintético de pruebas, Durango, Dgo.',
    referencia_cxp: `CXP-${suffix}`,
  };
  const rfcInvalidoResponse = await fetchLocal(new URL('/api/planta/suscripcion', env.app), {
    method: 'PATCH', headers: jsonHeaders(ownerA.token, ownerA.plantId),
    body: JSON.stringify({ ...fiscal, rfc: 'RFC-MAL' }),
  }, appOrigin, 'rechazo de RFC inválido');
  const rfcInvalido = await responseJson(rfcInvalidoResponse, 'rechazo de RFC inválido');
  assertStatus(rfcInvalidoResponse, [400], 'el formato RFC inválido debe rechazarse', rfcInvalido);
  const guardarFiscalResponse = await fetchLocal(new URL('/api/planta/suscripcion', env.app), {
    method: 'PATCH', headers: jsonHeaders(ownerA.token, ownerA.plantId),
    body: JSON.stringify(fiscal),
  }, appOrigin, 'guardar datos fiscales del tenant A');
  const guardarFiscal = await responseJson(guardarFiscalResponse, 'guardar datos fiscales del tenant A');
  assertStatus(guardarFiscalResponse, [200], 'el titular debe guardar datos fiscales', guardarFiscal);
  const leerFiscalResponse = await fetchLocal(new URL('/api/planta/suscripcion', env.app), {
    headers: jsonHeaders(ownerA.token, ownerA.plantId),
  }, appOrigin, 'leer datos fiscales guardados');
  const leerFiscal = await responseJson(leerFiscalResponse, 'leer datos fiscales guardados');
  assertStatus(leerFiscalResponse, [200], 'el titular debe releer sus datos fiscales', leerFiscal);
  assert.deepEqual(
    Object.fromEntries(Object.keys(fiscal).filter((key) => key !== 'accion').map((key) => [key, leerFiscal.facturacion?.[key]])),
    Object.fromEntries(Object.keys(fiscal).filter((key) => key !== 'accion').map((key) => [key, fiscal[key]])),
    'los datos fiscales guardados deben persistir con los valores normalizados.',
  );
  report(`PASS suscripción/pago manual pendiente · suscripción=${subscriptionId} · pago=${payment.id}`);
  report('PASS datos fiscales · validación RFC, guardado y lectura persistida');

  const comprobante = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n');
  const inicioComprobanteResponse = await fetchLocal(new URL('/api/planta/suscripcion', env.app), {
    method: 'POST', headers: jsonHeaders(ownerA.token, ownerA.plantId),
    body: JSON.stringify({ accion: 'iniciar_comprobante', pago_id: payment.id, tipo: 'application/pdf', bytes: comprobante.length }),
  }, appOrigin, 'inicio de comprobante local');
  const inicioComprobante = await responseJson(inicioComprobanteResponse, 'inicio de comprobante local');
  assertStatus(inicioComprobanteResponse, [201], 'iniciar comprobante de pago', inicioComprobante);
  assert.equal(inicioComprobante.bucket, 'comprobantes-suscripcion');
  const storagePath = String(inicioComprobante.path || '').split('/').map(encodeURIComponent).join('/');
  const uploadUrl = new URL(`/storage/v1/object/upload/sign/${encodeURIComponent(inicioComprobante.bucket)}/${storagePath}?${new URLSearchParams({ token: inicioComprobante.token })}`, env.supabase);
  const uploadResponse = await fetchLocal(uploadUrl, {
    method: 'PUT', headers: { apikey: apiKey, 'content-type': 'application/pdf', 'x-upsert': 'false' }, body: comprobante,
  }, supabaseOrigin, 'carga de comprobante a Storage Local');
  assertStatus(uploadResponse, [200], 'carga firmada de comprobante');
  await uploadResponse.arrayBuffer();
  const finalizarComprobanteResponse = await fetchLocal(new URL('/api/planta/suscripcion', env.app), {
    method: 'POST', headers: jsonHeaders(ownerA.token, ownerA.plantId),
    body: JSON.stringify({ accion: 'finalizar_comprobante', intento_id: inicioComprobante.intento_id }),
  }, appOrigin, 'confirmar comprobante local');
  const finalizarComprobante = await responseJson(finalizarComprobanteResponse, 'confirmar comprobante local');
  assertStatus(finalizarComprobanteResponse, [200], 'finalizar comprobante', finalizarComprobante);
  assert.equal(finalizarComprobante.comprobante?.estado, 'comprobante_recibido');
  const pagoTrasComprobanteResponse = await fetchLocal(new URL('/api/planta/suscripcion', env.app), {
    headers: jsonHeaders(ownerA.token, ownerA.plantId),
  }, appOrigin, 'consulta pago con comprobante');
  const pagoTrasComprobante = await responseJson(pagoTrasComprobanteResponse, 'consulta pago con comprobante');
  assert.equal(pagoTrasComprobante.pagos.find((item) => item.id === payment.id)?.estado, 'comprobante_recibido');
  report(`PASS comprobante PDF · carga privada firmada y revisión pendiente · pago=${payment.id}`);

  const cancelarBResponse = await fetchLocal(new URL('/api/planta/suscripcion', env.app), {
    method: 'POST', headers: jsonHeaders(ownerB.token, ownerB.plantId),
    body: JSON.stringify({ accion: 'solicitar', plan: 'starter', periodicidad: 'semestral', plantas: 1, orden_compra: `CANCEL-${suffix}` }),
  }, appOrigin, 'solicitud de plan B para probar cancelación');
  const cancelarB = await responseJson(cancelarBResponse, 'solicitud de plan B para probar cancelación');
  assertStatus(cancelarBResponse, [201], 'solicitud B para cancelación', cancelarB);
  const canceladaResponse = await fetchLocal(new URL('/api/planta/suscripcion', env.app), {
    method: 'POST', headers: jsonHeaders(ownerB.token, ownerB.plantId),
    body: JSON.stringify({ accion: 'cancelar', id: cancelarB.suscripcion?.id }),
  }, appOrigin, 'cancelación de solicitud local');
  const cancelada = await responseJson(canceladaResponse, 'cancelación de solicitud local');
  assertStatus(canceladaResponse, [200], 'cancelar solicitud pendiente', cancelada);
  assert.equal(cancelada.estado, 'cancelada');
  const canceladaFacturacionResponse = await fetchLocal(new URL('/api/planta/suscripcion', env.app), {
    headers: jsonHeaders(ownerB.token, ownerB.plantId),
  }, appOrigin, 'confirmar cancelación local');
  const canceladaFacturacion = await responseJson(canceladaFacturacionResponse, 'confirmar cancelación local');
  assert.equal(canceladaFacturacion.pagos.find((item) => item.suscripcion_id === cancelarB.suscripcion.id)?.estado, 'anulado');
  report('PASS cancelación de solicitud pendiente · pago anulado y sin afectar tenant A');

  // Before manual validation, API writes that need an active plan must be
  // denied. If local admin credentials are supplied, validate the payment via
  // the actual local admin route and verify Starter's hard server-side quota.
  const rejectedAssetResponse = await fetchLocal(new URL('/api/planta/estructura', env.app), {
    method: 'POST', headers: jsonHeaders(ownerA.token, ownerA.plantId),
    body: JSON.stringify({ tipo: 'activo', activo: { id: 'M-02', linea_id: 'L-01', tipo: 'MA', nombre: `Máquina bloqueo ${suffix}`, etapa: 'Ensamble', etapa_orden: 1, tarifa_hora: 100 } }),
  }, appOrigin, 'límite antes del pago');
  const rejectedAsset = await responseJson(rejectedAssetResponse, 'límite antes del pago');
  assertStatus(rejectedAssetResponse, [402], 'API debe negar alta sin plan activo', rejectedAsset);
  assert.match(rejectedAsset.error || '', /no tiene un plan activo/i, 'el rechazo debe deberse a plan no vigente.');
  report('PASS API bloquea cambios de estructura mientras el pago está pendiente');

  const recoveryEmailResponse = await fetchLocal(new URL('/api/cuenta', env.app), {
    method: 'POST', headers: jsonHeaders(),
    body: JSON.stringify({ accion: 'recuperar', email: ownerA.email }),
  }, appOrigin, 'solicitud de recuperación local');
  const recoveryRequest = await responseJson(recoveryEmailResponse, 'solicitud de recuperación local');
  assertStatus(recoveryEmailResponse, [200], 'POST /api/cuenta recuperar', recoveryRequest);
  const recovery = await confirmFromEmail(env.mailpit, ownerA.email, supabaseOrigin, appOrigin, 'recovery');
  assert.ok(recovery?.accessToken, 'Mailpit debe entregar el enlace de recuperación de la cuenta local.');
  assert.equal(recovery.redirect.pathname, '/recuperar', 'la recuperación debe regresar a la pantalla correcta.');
  assert.equal(new URLSearchParams(recovery.redirect.hash.slice(1)).get('type'), 'recovery', 'Supabase debe marcar la sesión como recuperación.');
  const recoveredPassword = `Recovered-${randomUUID()}-Aa9!`;
  const recoveryUpdateResponse = await fetchLocal(new URL('user', authApi), {
    method: 'PUT', headers: { ...publicHeaders, authorization: `Bearer ${recovery.accessToken}` },
    body: JSON.stringify({ password: recoveredPassword }),
  }, supabaseOrigin, 'cambio de contraseña local');
  const recoveryUpdate = await responseJson(recoveryUpdateResponse, 'cambio de contraseña local');
  assertStatus(recoveryUpdateResponse, [200], 'Auth contraseña recuperada', recoveryUpdate);
  const recoveryLoginResponse = await fetchLocal(new URL('/api/cuenta', env.app), {
    method: 'POST', headers: jsonHeaders(),
    body: JSON.stringify({ accion: 'inicio', email: ownerA.email, password: recoveredPassword }),
  }, appOrigin, 'login tras recuperación local');
  const recoveryLogin = await responseJson(recoveryLoginResponse, 'login tras recuperación local');
  assertStatus(recoveryLoginResponse, [200], 'login tras recuperar contraseña', recoveryLogin);
  ownerA.token = recoveryLogin.access_token;
  const oldPasswordResponse = await fetchLocal(new URL('/api/cuenta', env.app), {
    method: 'POST', headers: jsonHeaders(),
    body: JSON.stringify({ accion: 'inicio', email: ownerA.email, password: ownerA.password }),
  }, appOrigin, 'rechazo de contraseña anterior local');
  assertStatus(oldPasswordResponse, [401], 'la contraseña anterior debe dejar de funcionar');
  report('PASS recuperación por correo local · enlace /recuperar · contraseña renovada y anterior revocada');

  if (process.env.MVP_E2E_ADMIN_EMAIL && process.env.MVP_E2E_ADMIN_PASSWORD) {
    const adminLoginResponse = await fetchLocal(new URL('/api/health?admin_sesion=1', env.app), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ correo: process.env.MVP_E2E_ADMIN_EMAIL, clave: process.env.MVP_E2E_ADMIN_PASSWORD }),
    }, appOrigin, 'login admin local');
    const adminLogin = await responseJson(adminLoginResponse, 'login admin local');
    assertStatus(adminLoginResponse, [200], 'POST /api/health?admin_sesion=1', adminLogin);
    const setCookie = adminLoginResponse.headers.get('set-cookie') || '';
    const cookie = setCookie.split(';')[0];
    assert.ok(cookie.startsWith('downtimeos_admin='), 'el login admin local debe emitir cookie de sesión.');
    const activateResponse = await fetchLocal(new URL('/api/administracion/suscripciones', env.app), {
      method: 'PATCH', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ id: subscriptionId, accion: 'activar' }),
    }, appOrigin, 'verificación manual de pago local');
    const activate = await responseJson(activateResponse, 'verificación manual de pago local');
    assertStatus(activateResponse, [200], 'PATCH /api/administracion/suscripciones activar', activate);
    assert.equal(activate.ok, true);
    report(`PASS administrador local valida el pago · suscripción=${subscriptionId}`);

    const billingActiveResponse = await fetchLocal(new URL('/api/planta/suscripcion', env.app), {
      headers: jsonHeaders(ownerA.token, ownerA.plantId),
    }, appOrigin, 'consulta del periodo activo para renovar');
    const billingActive = await responseJson(billingActiveResponse, 'consulta del periodo activo para renovar');
    assertStatus(billingActiveResponse, [200], 'GET suscripción activa antes de renovar', billingActive);
    const activeSubscription = billingActive.suscripciones.find((item) => item.id === subscriptionId);
    assert.equal(activeSubscription?.estado, 'activa');
    const activeEnd = activeSubscription.termina_en;
    assert.ok(activeEnd && Date.parse(activeEnd) > Date.now(), 'el periodo base debe continuar vigente.');

    const monthlyRenewalResponse = await fetchLocal(new URL('/api/planta/suscripcion', env.app), {
      method: 'POST', headers: jsonHeaders(ownerA.token, ownerA.plantId),
      body: JSON.stringify({ accion: 'renovar', suscripcion_actual_id: subscriptionId, plan: 'starter', periodicidad: 'mensual', plantas: 1 }),
    }, appOrigin, 'rechazo de renovación mensual');
    const monthlyRenewal = await responseJson(monthlyRenewalResponse, 'rechazo de renovación mensual');
    assertStatus(monthlyRenewalResponse, [400], 'la API debe rechazar una renovación mensual como entrada no válida', monthlyRenewal);

    const pendingRenewalResponse = await fetchLocal(new URL('/api/planta/suscripcion', env.app), {
      method: 'POST', headers: jsonHeaders(ownerA.token, ownerA.plantId),
      body: JSON.stringify({ accion: 'renovar', suscripcion_actual_id: subscriptionId, plan: 'starter', periodicidad: 'anual', plantas: 1, orden_compra: `RENEW-CANCEL-${suffix}` }),
    }, appOrigin, 'solicitud pendiente de renovación');
    const pendingRenewal = await responseJson(pendingRenewalResponse, 'solicitud pendiente de renovación');
    assertStatus(pendingRenewalResponse, [201], 'renovación anual pendiente', pendingRenewal);
    assert.equal(pendingRenewal.suscripcion?.estado, 'solicitada');
    assert.equal(pendingRenewal.suscripcion?.inicio_programado, activeEnd, 'la renovación debe empezar al terminar el periodo vigente.');
    const pendingRenewalId = printableId(pendingRenewal.suscripcion?.id, 'renovación pendiente');

    const duplicateRenewalResponse = await fetchLocal(new URL('/api/planta/suscripcion', env.app), {
      method: 'POST', headers: jsonHeaders(ownerA.token, ownerA.plantId),
      body: JSON.stringify({ accion: 'renovar', suscripcion_actual_id: subscriptionId, plan: 'starter', periodicidad: 'anual', plantas: 1 }),
    }, appOrigin, 'rechazo de renovación duplicada');
    const duplicateRenewal = await responseJson(duplicateRenewalResponse, 'rechazo de renovación duplicada');
    assertStatus(duplicateRenewalResponse, [409], 'no se debe duplicar una renovación pendiente', duplicateRenewal);

    const cancelPendingRenewalResponse = await fetchLocal(new URL('/api/planta/suscripcion', env.app), {
      method: 'POST', headers: jsonHeaders(ownerA.token, ownerA.plantId),
      body: JSON.stringify({ accion: 'cancelar', id: pendingRenewalId }),
    }, appOrigin, 'cancelación de renovación pendiente');
    const cancelPendingRenewal = await responseJson(cancelPendingRenewalResponse, 'cancelación de renovación pendiente');
    assertStatus(cancelPendingRenewalResponse, [200], 'cancelar renovación pendiente', cancelPendingRenewal);
    assert.equal(cancelPendingRenewal.estado, 'cancelada');
    const billingAfterPendingCancelResponse = await fetchLocal(new URL('/api/planta/suscripcion', env.app), {
      headers: jsonHeaders(ownerA.token, ownerA.plantId),
    }, appOrigin, 'verificación pago de renovación cancelada');
    const billingAfterPendingCancel = await responseJson(billingAfterPendingCancelResponse, 'verificación pago de renovación cancelada');
    const pendingRenewalPayment = billingAfterPendingCancel.pagos.find((item) => item.suscripcion_id === pendingRenewalId);
    assert.equal(pendingRenewalPayment?.estado, 'anulado', 'cancelar la renovación debe anular el pago pendiente.');

    const verifiedRenewalResponse = await fetchLocal(new URL('/api/planta/suscripcion', env.app), {
      method: 'POST', headers: jsonHeaders(ownerA.token, ownerA.plantId),
      body: JSON.stringify({ accion: 'renovar', suscripcion_actual_id: subscriptionId, plan: 'starter', periodicidad: 'semestral', plantas: 1, orden_compra: `RENEW-PAID-${suffix}` }),
    }, appOrigin, 'solicitud de renovación para validar');
    const verifiedRenewal = await responseJson(verifiedRenewalResponse, 'solicitud de renovación para validar');
    assertStatus(verifiedRenewalResponse, [201], 'segunda renovación semestral', verifiedRenewal);
    const verifiedRenewalId = printableId(verifiedRenewal.suscripcion?.id, 'renovación por validar');
    const activateRenewalResponse = await fetchLocal(new URL('/api/administracion/suscripciones', env.app), {
      method: 'PATCH', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ id: verifiedRenewalId, accion: 'activar' }),
    }, appOrigin, 'validación del pago de renovación');
    const activateRenewal = await responseJson(activateRenewalResponse, 'validación del pago de renovación');
    assertStatus(activateRenewalResponse, [200], 'activar renovación pagada', activateRenewal);
    assert.equal(activateRenewal.resultado?.renovacion_programada, true);
    assert.equal(activateRenewal.resultado?.inicia_en, activeEnd, 'la renovación pagada debe quedar concatenada al periodo vigente.');

    const cancelVerifiedRenewalResponse = await fetchLocal(new URL('/api/planta/suscripcion', env.app), {
      method: 'POST', headers: jsonHeaders(ownerA.token, ownerA.plantId),
      body: JSON.stringify({ accion: 'cancelar', id: verifiedRenewalId }),
    }, appOrigin, 'cancelación de renovación pagada futura');
    const cancelVerifiedRenewal = await responseJson(cancelVerifiedRenewalResponse, 'cancelación de renovación pagada futura');
    assertStatus(cancelVerifiedRenewalResponse, [200], 'cancelar renovación futura pagada', cancelVerifiedRenewal);
    assert.equal(cancelVerifiedRenewal.estado, 'cancelada');
    assert.match(cancelVerifiedRenewal.mensaje, /no se reembolsa automáticamente/i);
    const billingAfterVerifiedCancelResponse = await fetchLocal(new URL('/api/planta/suscripcion', env.app), {
      headers: jsonHeaders(ownerA.token, ownerA.plantId),
    }, appOrigin, 'verificación de pago conciliado tras cancelar renovación');
    const billingAfterVerifiedCancel = await responseJson(billingAfterVerifiedCancelResponse, 'verificación de pago conciliado tras cancelar renovación');
    assert.equal(billingAfterVerifiedCancel.pagos.find((item) => item.suscripcion_id === verifiedRenewalId)?.estado, 'verificado',
      'la cancelación no debe ocultar ni anular un pago ya validado; el reembolso requiere gestión manual.');
    assert.equal(billingAfterVerifiedCancel.suscripciones.find((item) => item.id === subscriptionId)?.termina_en, activeEnd,
      'cancelar la renovación futura no debe acortar el periodo actual.');

    const cancelActiveResponse = await fetchLocal(new URL('/api/planta/suscripcion', env.app), {
      method: 'POST', headers: jsonHeaders(ownerA.token, ownerA.plantId),
      body: JSON.stringify({ accion: 'cancelar', id: subscriptionId }),
    }, appOrigin, 'programación de cancelación del periodo activo');
    const cancelActive = await responseJson(cancelActiveResponse, 'programación de cancelación del periodo activo');
    assertStatus(cancelActiveResponse, [200], 'cancelar plan activo al fin del periodo', cancelActive);
    assert.equal(cancelActive.estado, 'cancelacion_programada');
    const billingAfterActiveCancelResponse = await fetchLocal(new URL('/api/planta/suscripcion', env.app), {
      headers: jsonHeaders(ownerA.token, ownerA.plantId),
    }, appOrigin, 'verificar vigencia tras programar cancelación');
    const billingAfterActiveCancel = await responseJson(billingAfterActiveCancelResponse, 'verificar vigencia tras programar cancelación');
    const canceledAtPeriodEnd = billingAfterActiveCancel.suscripciones.find((item) => item.id === subscriptionId);
    assert.equal(canceledAtPeriodEnd?.estado, 'cancelacion_programada');
    assert.equal(canceledAtPeriodEnd?.termina_en, activeEnd, 'la cancelación no debe cortar acceso antes del fin pagado.');
    report('PASS ciclo de suscripción · renovación concatenada, duplicado/mensual bloqueados, pago pendiente anulado, pago verificado conciliado y cancelación al fin del periodo');

    const adminListResponse = await fetchLocal(new URL('/api/administracion/suscripciones', env.app), {
      headers: { cookie },
    }, appOrigin, 'consulta administrativa de comprobantes');
    const adminList = await responseJson(adminListResponse, 'consulta administrativa de comprobantes');
    assertStatus(adminListResponse, [200], 'GET administrativo de suscripciones', adminList);
    const pagoAdmin = adminList.suscripciones.flatMap((item) => item.organizacion_pagos || []).find((item) => item.id === payment.id);
    assert.equal(pagoAdmin?.estado, 'verificado');
    assert.equal(pagoAdmin?.comprobante?.estado, 'verificado');
    assert.equal(esUrlFirmadaStorageLocal(pagoAdmin?.comprobante?.url, env.supabase.origin), true,
      'El comprobante debe devolver una URL firmada del Storage de la instancia Supabase local.');
    report('PASS panel administrativo · comprobante privado con URL firmada y auditoría');

    for (let number = 2; number <= 5; number += 1) {
      const assetResponse = await fetchLocal(new URL('/api/planta/estructura', env.app), {
        method: 'POST', headers: jsonHeaders(ownerA.token, ownerA.plantId),
        body: JSON.stringify({ tipo: 'activo', activo: { id: `M-${String(number).padStart(2, '0')}`, linea_id: 'L-01', tipo: 'MA', nombre: `Equipo límite ${number} ${suffix}`, etapa: 'Ensamble', etapa_orden: number, tarifa_hora: 100 } }),
      }, appOrigin, `alta equipo dentro del plan ${number}`);
      const assetData = await responseJson(assetResponse, `alta equipo dentro del plan ${number}`);
      assertStatus(assetResponse, [201], `Starter permite equipo ${number}`, assetData);
    }
    const overLimitResponse = await fetchLocal(new URL('/api/planta/estructura', env.app), {
      method: 'POST', headers: jsonHeaders(ownerA.token, ownerA.plantId),
      body: JSON.stringify({ tipo: 'activo', activo: { id: 'M-06', linea_id: 'L-01', tipo: 'MA', nombre: `Equipo excedido ${suffix}`, etapa: 'Ensamble', etapa_orden: 6, tarifa_hora: 100 } }),
    }, appOrigin, 'límite Starter');
    const overLimit = await responseJson(overLimitResponse, 'límite Starter');
    assertStatus(overLimitResponse, [409], 'API debe rechazar equipo Starter número 6', overLimit);
    assert.equal(overLimit.codigo, 'PLAN_ASSET_LIMIT');
    report('PASS límite Starter: cinco equipos permitidos, el sexto rechazado por API');
  } else {
    OMITTED.push('Verificación administrativa del pago y cuota Starter de cinco activos: define MVP_E2E_ADMIN_EMAIL/PASSWORD locales para ejercitar el endpoint administrativo.');
  }

  let postgrestCostosVerificado = false;
  let cerrarPlanVencidoVerificado = false;
  let foliosUnicosVerificados = false;
  if (!mailpitAvailable) {
    OMITTED.push('Invitaciones, entrega de correo y aceptación/roles: Mailpit no respondió en el URL local configurado; no se enviaron invitaciones. Supabase Local puede usar Inbucket por defecto.');
  } else {
    const roleSpecs = [
      { rol: 'direccion', facturacion: false },
      { rol: 'finanzas', facturacion: true },
      { rol: 'operaciones', facturacion: false },
      { rol: 'operador', facturacion: false },
      { rol: 'operador', facturacion: false, emailKey: 'operador-secundario' },
    ];
    const members = [];
    let mailDeliveryWorks = true;
    for (const spec of roleSpecs) {
      const email = testEmail(spec.emailKey || spec.rol, suffix);
      const inviteResponse = await fetchLocal(new URL('/api/cuenta', env.app), {
        method: 'POST', headers: jsonHeaders(ownerA.token),
        body: JSON.stringify({ accion: 'invitar', email, nombre: `MVP ${spec.emailKey || spec.rol}`, rol: spec.rol, administrar_facturacion: spec.facturacion }),
      }, appOrigin, `invitación ${spec.rol}`);
      const invited = await responseJson(inviteResponse, `invitación ${spec.rol}`);
      if (inviteResponse.status === 422 && /correo de invitación|smtp/i.test(String(invited.error || ''))) {
        OMITTED.push(`Invitación/roles: Supabase Local rechazó el envío SMTP del rol ${spec.rol}; no se probó aceptación por correo.`);
        mailDeliveryWorks = false;
        break;
      }
      assertStatus(inviteResponse, [201], `POST /api/cuenta invitación ${spec.rol}`, invited);
      const accepted = await confirmFromEmail(env.mailpit, email, supabaseOrigin, appOrigin);
      if (!accepted?.accessToken) {
        mailDeliveryWorks = false;
        OMITTED.push(`Aceptación de correo/rol ${spec.rol}: invitación creada para ${email}, pero Mailpit no expuso un enlace local de confirmación interpretable.`);
        break;
      }
      const redirect = accepted.redirect;
      if (!redirect || redirect.origin !== appOrigin) {
        mailDeliveryWorks = false;
        OMITTED.push(`Aceptación de correo/rol ${spec.rol}: el enlace no redirigió al APP_URL loopback configurado.`);
        break;
      }
      assert.equal(redirect.pathname, '/activar', `la invitación ${spec.rol} debe regresar al flujo de activación, no a la página principal.`);
      const inviteId = redirect.searchParams.get('invitacion');
      const inviteToken = redirect.searchParams.get('token');
      if (!inviteId || !inviteToken) {
        mailDeliveryWorks = false;
        OMITTED.push(`Aceptación de correo/rol ${spec.rol}: el enlace de correo no contenía los parámetros seguros de invitación esperados.`);
        break;
      }
      const password = `LocalMvp-${randomUUID()}-Aa9!`;
      const passwordResponse = await fetchLocal(new URL('user', authApi), {
        method: 'PUT', headers: { ...publicHeaders, authorization: `Bearer ${accepted.accessToken}` },
        body: JSON.stringify({ password }),
      }, supabaseOrigin, `crear contraseña ${spec.rol}`);
      const passwordData = await responseJson(passwordResponse, `crear contraseña ${spec.rol}`);
      assertStatus(passwordResponse, [200], `Auth contraseña ${spec.rol}`, passwordData);
      const acceptResponse = await fetchLocal(new URL('/api/cuenta', env.app), {
        method: 'POST', headers: jsonHeaders(accepted.accessToken),
        body: JSON.stringify({ accion: 'aceptar-invitacion', invitacion_id: inviteId, token: inviteToken }),
      }, appOrigin, `aceptar invitación ${spec.rol}`);
      const acceptedData = await responseJson(acceptResponse, `aceptar invitación ${spec.rol}`);
      assertStatus(acceptResponse, [200], `POST /api/cuenta aceptar ${spec.rol}`, acceptedData);
      assert.equal(acceptedData.perfil?.rol, spec.rol, `el usuario invitado debe recibir el rol ${spec.rol}.`);
      members.push({ ...spec, email, token: accepted.accessToken, userId: acceptedData.user?.id, profile: acceptedData.perfil });
      report(`PASS invitación aceptada · rol=${spec.rol} · email=${email} · usuario=${acceptedData.user?.id}`);
    }
    if (mailDeliveryWorks && members.length === roleSpecs.length) {
      for (const member of members) {
        const stateResponse = await fetchLocal(new URL('/api/planta', env.app), {
          headers: jsonHeaders(member.token, ownerA.plantId),
        }, appOrigin, `permisos lectura ${member.rol}`);
        const state = await responseJson(stateResponse, `permisos lectura ${member.rol}`);
        assertStatus(stateResponse, [200], `GET /api/planta rol ${member.rol}`, state);
        const hasTariff = state.activos.some((asset) => Object.hasOwn(asset, 'tarifa_hora'));
        assert.equal(hasTariff, ['direccion', 'finanzas'].includes(member.rol), `acceso financiero esperado para ${member.rol}.`);

        if (['operaciones', 'operador'].includes(member.rol)) {
          await assertPostgrestCannotSelect(
            member.token,
            'planta_activos',
            'tarifa_hora',
            `PostgREST no expone tarifa_hora a ${member.rol}`,
          );
          await assertPostgrestCannotSelect(
            member.token,
            'planta_eventos',
            'tarifa_aplicada,costo_mxn',
            `PostgREST no expone tarifa_aplicada/costo_mxn a ${member.rol}`,
          );
        }

        if (member.rol === 'operador') {
          assert.deepEqual(state.eventos, [], 'Operador no debe recibir el historial de eventos.');
          assert.deepEqual(state.solicitudes, [], 'Operador no debe recibir la bandeja de solicitudes.');
          assert.equal(state.meta.eventos, 0, 'la metadata tampoco debe revelar el tamaño del historial.');
          assert.equal(state.meta.solicitudes_abiertas, 0, 'la metadata tampoco debe revelar el tamaño de la bandeja.');
          const consultaBitacora = new URL('/api/planta', env.app);
          consultaBitacora.searchParams.set('solo_eventos', '1');
          consultaBitacora.searchParams.set('cursor', JSON.stringify({
            created_at: new Date().toISOString(),
            snapshot: new Date().toISOString(),
            folio: 'E2E-OPERADOR-PRIVACIDAD',
          }));
          const bitacoraResponse = await fetchLocal(consultaBitacora, {
            headers: jsonHeaders(member.token, ownerA.plantId),
          }, appOrigin, 'acceso directo de Operador a la bitácora');
          const bitacora = await responseJson(bitacoraResponse, 'acceso directo de Operador a la bitácora');
          assertStatus(bitacoraResponse, [403], 'Operador no puede paginar la bitácora por API', bitacora);

          if (process.env.MVP_E2E_ADMIN_EMAIL && process.env.MVP_E2E_ADMIN_PASSWORD) {
            const stopResponse = await fetchLocal(new URL('/api/planta/reportes', env.app), {
              method: 'POST', headers: jsonHeaders(member.token, ownerA.plantId),
              body: JSON.stringify({
                activo_id: 'M-01', causa_id: 'espera-material',
                desde: new Date(Date.now() - 90_000).toISOString(),
                reportado_por: 'E2E Operador',
              }),
            }, appOrigin, 'paro reportado por Operador');
            const stop = await responseJson(stopResponse, 'paro reportado por Operador');
            assertStatus(stopResponse, [201], 'Operador puede reportar un paro', stop);
            assert.equal(stop.estado?.estado, 'STOP');

            const closeResponse = await fetchLocal(new URL('/api/planta/reportes', env.app), {
              method: 'PATCH', headers: jsonHeaders(member.token, ownerA.plantId),
              body: JSON.stringify({ accion: 'cerrar', activo_id: 'M-01' }),
            }, appOrigin, 'cierre atómico de paro por Operador');
            const close = await responseJson(closeResponse, 'cierre atómico de paro por Operador');
            assertStatus(closeResponse, [200], 'Operador puede cerrar un paro abierto', close);
            assert.equal(close.estado?.estado, 'RUN', 'el activo debe cerrar en RUN.');
            assert.ok(close.evento?.folio, 'el cierre debe devolver el evento persistido.');
            assert.equal(close.evento?.origen, 'piso');

            const closedState = await getState(ownerA);
            assert.equal(closedState.estados.find((item) => item.activo_id === 'M-01')?.estado, 'RUN');
            assert.ok(closedState.eventos.some((item) => item.folio === close.evento.folio));
            assert.ok(closedState.solicitudes.some((item) => item.folio === stop.solicitud?.folio && item.cerrada));

            const auditoriaCierreUrl = new URL('/rest/v1/planta_auditoria', env.supabase);
            auditoriaCierreUrl.searchParams.set('select', 'actor_id,accion,entidad,entidad_id');
            auditoriaCierreUrl.searchParams.set('accion', 'eq.paro_cerrado');
            auditoriaCierreUrl.searchParams.set('entidad_id', `eq.${close.evento.folio}`);
            const auditoriaCierreResponse = await fetchLocal(auditoriaCierreUrl, {
              headers: adminHeaders,
            }, supabaseOrigin, 'auditoría del cierre de paro');
            assertStatus(auditoriaCierreResponse, [200], 'leer auditoría del cierre', null);
            const auditoriaCierre = await responseJson(auditoriaCierreResponse, 'auditoría del cierre');
            assert.equal(auditoriaCierre.length, 1, 'el cierre y su actor deben quedar auditados atómicamente.');
            assert.equal(auditoriaCierre[0].actor_id, member.userId, 'la auditoría debe señalar al usuario autenticado que cerró el paro.');
            assert.equal(auditoriaCierre[0].entidad_id, close.evento.folio);

            const duplicateClose = await fetchLocal(new URL('/api/planta/reportes', env.app), {
              method: 'PATCH', headers: jsonHeaders(member.token, ownerA.plantId),
              body: JSON.stringify({ accion: 'cerrar', activo_id: 'M-01' }),
            }, appOrigin, 'cierre duplicado de paro');
            const duplicateCloseBody = await responseJson(duplicateClose, 'cierre duplicado de paro');
            assertStatus(duplicateClose, [409], 'el cierre repetido no debe crear otro evento', duplicateCloseBody);
            report(`PASS ciclo Operador STOP→RUN · actor autenticado auditado · evento=${close.evento.folio} · solicitud cerrada`);
          }

          for (const [tabla, columnas] of [
            ['planta_analisis_ia', 'resultado,entrada'],
            ['planta_mensajes', 'destinatario,contenido'],
            ['planta_reportes', 'storage_path'],
          ]) {
            const respuestaPrivada = await fetchLocal(new URL(`/rest/v1/${tabla}?select=${encodeURIComponent(columnas)}&limit=1`, env.supabase), {
              headers: { apikey: apiKey, authorization: `Bearer ${member.token}` },
            }, supabaseOrigin, `lectura directa de ${tabla} por Operador`);
            assert.ok([401, 403].includes(respuestaPrivada.status), `PostgREST no debe exponer ${tabla} a Operador (HTTP ${respuestaPrivada.status}).`);
            await respuestaPrivada.arrayBuffer();
          }
          postgrestCostosVerificado = true;
        }

        if (member.rol === 'operaciones' && process.env.MVP_E2E_ADMIN_EMAIL && process.env.MVP_E2E_ADMIN_PASSWORD) {
          const maintenanceStopResponse = await fetchLocal(new URL('/api/planta/reportes', env.app), {
            method: 'POST', headers: jsonHeaders(member.token, ownerA.plantId),
            body: JSON.stringify({ accion: 'mantenimiento', activo_id: 'M-01', causa_id: 'espera-material' }),
          }, appOrigin, 'paro atómico de Mantenimiento');
          const maintenanceStop = await responseJson(maintenanceStopResponse, 'paro atómico de Mantenimiento');
          assertStatus(maintenanceStopResponse, [201], 'Mantenimiento registra STOP atómico', maintenanceStop);
          assert.equal(maintenanceStop.estado?.estado, 'STOP');
          assert.equal(maintenanceStop.solicitud?.estado, 'aprobada');
          const maintenanceState = await getState(ownerA);
          assert.equal(maintenanceState.estados.find((item) => item.activo_id === 'M-01')?.estado, 'STOP');
          assert.ok(maintenanceState.solicitudes.some((item) => item.folio === maintenanceStop.solicitud.folio && item.estado === 'aprobada'));

          const maintenanceCloseResponse = await fetchLocal(new URL('/api/planta/reportes', env.app), {
            method: 'PATCH', headers: jsonHeaders(member.token, ownerA.plantId),
            body: JSON.stringify({ accion: 'cerrar', activo_id: 'M-01' }),
          }, appOrigin, 'cierre de paro de Mantenimiento');
          const maintenanceClose = await responseJson(maintenanceCloseResponse, 'cierre de paro de Mantenimiento');
          assertStatus(maintenanceCloseResponse, [200], 'Mantenimiento cierra STOP atómico', maintenanceClose);
          assert.equal(maintenanceClose.estado?.estado, 'RUN');
          assert.ok(maintenanceClose.evento?.folio);
          report(`PASS ciclo Mantenimiento STOP→RUN · evento=${maintenanceClose.evento.folio} · solicitud aprobada/cerrada`);

          const operador = members.find((item) => item.rol === 'operador');
          const reporteFalsoResponse = await fetchLocal(new URL('/api/planta/reportes', env.app), {
            method: 'POST', headers: jsonHeaders(operador.token, ownerA.plantId),
            body: JSON.stringify({ activo_id: 'M-01', causa_id: 'espera-material', reportado_por: 'E2E Operador' }),
          }, appOrigin, 'reporte a descartar');
          const reporteFalso = await responseJson(reporteFalsoResponse, 'reporte a descartar');
          assertStatus(reporteFalsoResponse, [201], 'crear reporte previo a descarte', reporteFalso);
          const eventosAntesDescarte = (await getState(ownerA)).eventos.length;
          const descarteResponse = await fetchLocal(new URL(`/api/planta/solicitudes?folio=${encodeURIComponent(reporteFalso.solicitud.folio)}`, env.app), {
            method: 'PATCH', headers: jsonHeaders(member.token, ownerA.plantId),
            body: JSON.stringify({ accion: 'descartar' }),
          }, appOrigin, 'descarte transaccional de reporte');
          const descarte = await responseJson(descarteResponse, 'descarte transaccional de reporte');
          assertStatus(descarteResponse, [200], 'Mantenimiento descarta reporte atómicamente', descarte);
          assert.equal(descarte.maquina_liberada, true);
          assert.equal(descarte.solicitud?.estado, 'rechazada');
          assert.equal(descarte.solicitud?.cerrada, true);
          const despuesDescarte = await getState(ownerA);
          assert.equal(despuesDescarte.estados.find((item) => item.activo_id === 'M-01')?.estado, 'RUN');
          assert.equal(despuesDescarte.eventos.length, eventosAntesDescarte, 'descartar no genera paro ni costo.' );
          report(`PASS descarte transaccional · solicitud=${descarte.solicitud.folio} · RUN sin evento financiero`);
        }

        const billingRoleResponse = await fetchLocal(new URL('/api/planta/suscripcion', env.app), {
          headers: jsonHeaders(member.token, ownerA.plantId),
        }, appOrigin, `permiso suscripción ${member.rol}`);
        const billingRole = await responseJson(billingRoleResponse, `permiso suscripción ${member.rol}`);
        if (member.rol === 'finanzas') {
          assertStatus(billingRoleResponse, [200], 'Finanzas con permiso de facturación', billingRole);
          assert.equal(billingRole.puede_editar, true);
        } else if (['operaciones', 'operador'].includes(member.rol)) {
          assertStatus(billingRoleResponse, [403], `billing denegado ${member.rol}`, billingRole);
        }

        const guardarFiscalRoleResponse = await fetchLocal(new URL('/api/planta/suscripcion', env.app), {
          method: 'PATCH', headers: jsonHeaders(member.token, ownerA.plantId),
          body: JSON.stringify({ accion: 'facturacion', razon_social: 'No autorizado E2E', rfc: 'AAA010101AA1' }),
        }, appOrigin, `guardar facturación por ${member.rol}`);
        const guardarFiscalRole = await responseJson(guardarFiscalRoleResponse, `guardar facturación por ${member.rol}`);
        if (member.rol === 'finanzas') {
          assertStatus(guardarFiscalRoleResponse, [200], 'Finanzas con permiso puede editar datos fiscales', guardarFiscalRole);
        } else {
          assertStatus(guardarFiscalRoleResponse, [403], `edición fiscal denegada ${member.rol}`, guardarFiscalRole);
        }

        const configRoleResponse = await fetchLocal(new URL('/api/planta/configuracion', env.app), {
          method: 'POST', headers: jsonHeaders(member.token, ownerA.plantId),
          body: JSON.stringify({ lineas: [], activos: [] }),
        }, appOrigin, `permiso configurar planta ${member.rol}`);
        const configRole = await responseJson(configRoleResponse, `permiso configurar planta ${member.rol}`);
        if (['finanzas', 'operaciones', 'operador'].includes(member.rol)) {
          assertStatus(configRoleResponse, [403], `configuración denegada ${member.rol}`, configRole);
        }
      }

      if (process.env.MVP_E2E_BROWSER === '1') {
        const { verificarNavegacionConSesiones } = await import('./e2e-browser-roles.mjs');
        await verificarNavegacionConSesiones({
          appUrl: env.app.toString(),
          owner: { token: ownerA.token, userId: ownerA.userId, email: ownerA.email, account: ownerA.account },
          members,
          admin: { email: process.env.MVP_E2E_ADMIN_EMAIL, password: process.env.MVP_E2E_ADMIN_PASSWORD },
        });
        SUITES.push('UI Edge: Acceso/Registro/Recuperación/Activación, viewport móvil, tableros por rol, Equipo/Suscripción con permisos y Administración/Suscripciones');
      } else {
        OMITTED.push('UI autenticada por rol en Edge: define MVP_E2E_BROWSER=1 en un E2E desechable con Edge instalado para verificar el DOM real con sesiones sintéticas.');
      }

      if (process.env.MVP_E2E_ADMIN_EMAIL && process.env.MVP_E2E_ADMIN_PASSWORD) {
        const operador = members.find((item) => item.rol === 'operador');
        const otroOperador = members.find((item) => item.rol === 'operador' && item.email !== operador.email);
        const reporteRetirableResponse = await fetchLocal(new URL('/api/planta/reportes', env.app), {
          method: 'POST', headers: jsonHeaders(operador.token, ownerA.plantId),
          body: JSON.stringify({ activo_id: 'M-01', causa_id: 'espera-material' }),
        }, appOrigin, 'reporte propio para probar retiro');
        const reporteRetirable = await responseJson(reporteRetirableResponse, 'reporte propio para probar retiro');
        assertStatus(reporteRetirableResponse, [201], 'crear reporte propio para retiro', reporteRetirable);
        await assertPostgrestCannotSee(ownerB.token, 'planta_solicitudes', 'folio,planta_id',
          { folio: reporteRetirable.solicitud.folio }, 'JWT B no lee solicitudes de planta A');
        const retiroAjenoResponse = await fetchLocal(new URL('/api/planta/reportes', env.app), {
          method: 'PATCH', headers: jsonHeaders(otroOperador.token, ownerA.plantId),
          body: JSON.stringify({ accion: 'retirar', folio: reporteRetirable.solicitud.folio }),
        }, appOrigin, 'otro operador intenta retirar el reporte');
        const retiroAjeno = await responseJson(retiroAjenoResponse, 'otro operador intenta retirar el reporte');
        assertStatus(retiroAjenoResponse, [403], 'un operador no puede retirar el reporte de otro', retiroAjeno);
        assert.equal((await getState(ownerA)).estados.find((item) => item.activo_id === 'M-01')?.estado, 'STOP');

        const retiroPropioResponse = await fetchLocal(new URL('/api/planta/reportes', env.app), {
          method: 'PATCH', headers: jsonHeaders(operador.token, ownerA.plantId),
          body: JSON.stringify({ accion: 'retirar', folio: reporteRetirable.solicitud.folio }),
        }, appOrigin, 'el operador retira su reporte');
        const retiroPropio = await responseJson(retiroPropioResponse, 'el operador retira su reporte');
        assertStatus(retiroPropioResponse, [200], 'el operador puede retirar su propio reporte pendiente', retiroPropio);
        assert.equal(retiroPropio.maquina_liberada, true);
        assert.equal(retiroPropio.solicitud?.estado, 'rechazada');
        assert.equal((await getState(ownerA)).estados.find((item) => item.activo_id === 'M-01')?.estado, 'RUN');
        report(`PASS retiro por autor · reportado por ${operador.email}; otro operador recibió 403`);

        // Fuerza muchos ciclos del mismo equipo en el mismo minuto de folio.
        // Con el sufijo anterior de 2 caracteres, las colisiones eran probables
        // y la base respondía error interno por la clave primaria duplicada.
        const folioDesdeFijo = new Date(Date.now() - 30_000).toISOString();
        const foliosSolicitudes = new Set();
        const foliosEventos = new Set();
        for (let intento = 0; intento < 64; intento += 1) {
          const abrir = await fetchLocal(new URL('/api/planta/reportes', env.app), {
            method: 'POST', headers: jsonHeaders(operador.token, ownerA.plantId),
            body: JSON.stringify({ activo_id: 'M-01', causa_id: 'espera-material', desde: folioDesdeFijo, reportado_por: 'E2E colisiones folio' }),
          }, appOrigin, `apertura para estrés de folios ${intento + 1}`);
          const reporte = await responseJson(abrir, `apertura para estrés de folios ${intento + 1}`);
          assertStatus(abrir, [201], `crear solicitud con folio único ${intento + 1}`, reporte);
          const folioSolicitud = reporte.solicitud?.folio;
          assert.match(folioSolicitud || '', /-[A-F0-9]{12}$/, 'la solicitud debe recibir el sufijo largo que asigna la base.');
          assert.ok(!foliosSolicitudes.has(folioSolicitud), 'no debe repetirse el folio de solicitud en el mismo minuto.');
          foliosSolicitudes.add(folioSolicitud);

          const cerrar = await fetchLocal(new URL('/api/planta/reportes', env.app), {
            method: 'PATCH', headers: jsonHeaders(operador.token, ownerA.plantId),
            body: JSON.stringify({ accion: 'cerrar', activo_id: 'M-01' }),
          }, appOrigin, `cierre para estrés de folios ${intento + 1}`);
          const evento = await responseJson(cerrar, `cierre para estrés de folios ${intento + 1}`);
          assertStatus(cerrar, [200], `cerrar ciclo con folio único ${intento + 1}`, evento);
          const folioEvento = evento.evento?.folio;
          assert.match(folioEvento || '', /-[A-F0-9]{12}$/, 'el evento debe recibir el sufijo largo que asigna la base.');
          assert.ok(!foliosEventos.has(folioEvento), 'no debe repetirse el folio de evento en el mismo minuto.');
          foliosEventos.add(folioEvento);
        }
        assert.equal(foliosSolicitudes.size, 64);
        assert.equal(foliosEventos.size, 64);
        foliosUnicosVerificados = true;
        report('PASS resistencia a colisiones · 64 reportes y cierres de la misma máquina/minuto, todos con folio único');

        const reporteAntesVencimiento = await fetchLocal(new URL('/api/planta/solicitudes', env.app), {
          method: 'POST', headers: jsonHeaders(operador.token, ownerA.plantId),
          body: JSON.stringify({ activo_id: 'M-01', causa_id: 'espera-material', reportado_por: 'E2E Operador' }),
        }, appOrigin, 'abrir paro mediante alias atómico antes del vencimiento');
        const paroAbierto = await responseJson(reporteAntesVencimiento, 'abrir paro antes del vencimiento');
        assertStatus(reporteAntesVencimiento, [201], 'alias de solicitudes debe abrir paro y reporte juntos', paroAbierto);

        const vencimientoAntesDeCierre = await fetchLocal(new URL(`/rest/v1/organizacion_suscripciones?id=eq.${encodeURIComponent(subscriptionId)}`, env.supabase), {
          method: 'PATCH',
          headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json', prefer: 'return=minimal' },
          body: JSON.stringify({ inicia_en: '2019-01-01T00:00:00.000Z', termina_en: '2020-01-01T00:00:00.000Z', renueva_en: null, estado: 'activa' }),
        }, supabaseOrigin, 'vencer plan con paro abierto');
        assertStatus(vencimientoAntesDeCierre, [204], 'preparar plan vencido con paro abierto');
        await vencimientoAntesDeCierre.arrayBuffer();
        const materializarVencimiento = await fetchLocal(new URL('/api/planta/suscripcion', env.app), {
          headers: jsonHeaders(ownerA.token, ownerA.plantId),
        }, appOrigin, 'materializar vencimiento antes de cerrar el paro');
        const vencida = await responseJson(materializarVencimiento, 'materializar vencimiento antes de cerrar el paro');
        assertStatus(materializarVencimiento, [200], 'materializar el plan vencido', vencida);
        assert.equal(vencida.suscripciones.find((item) => item.id === subscriptionId)?.estado, 'vencida');

        const cerrarTrasVencimientoResponse = await fetchLocal(new URL('/api/planta/reportes', env.app), {
          method: 'PATCH', headers: jsonHeaders(operador.token, ownerA.plantId),
          body: JSON.stringify({ accion: 'cerrar', activo_id: 'M-01' }),
        }, appOrigin, 'cerrar paro con plan vencido');
        const cierreTrasVencimiento = await responseJson(cerrarTrasVencimientoResponse, 'cerrar paro con plan vencido');
        assertStatus(cerrarTrasVencimientoResponse, [200], 'permitir cerrar un paro existente con plan vencido', cierreTrasVencimiento);
        assert.equal(cierreTrasVencimiento.estado?.estado, 'RUN');
        const folioCierreTrasVencimiento = cierreTrasVencimiento.evento?.folio;
        assert.ok(folioCierreTrasVencimiento, `El cierre tras vencimiento debe devolver el folio auditado; campos=${Object.keys(cierreTrasVencimiento).join(',')}`);
        const estadoTrasVencimiento = await getState(ownerA);
        assert.ok(
          estadoTrasVencimiento.eventos.some((item) => item.folio === folioCierreTrasVencimiento),
          `La bitácora debe incluir el cierre ${folioCierreTrasVencimiento}; meta=${JSON.stringify(estadoTrasVencimiento.meta)}; eventos=${estadoTrasVencimiento.eventos.length}`,
        );
        cerrarPlanVencidoVerificado = true;
        report('PASS continuidad tras vencimiento · puede cerrarse un paro abierto sin habilitar nuevas operaciones');
      }
      report('PASS permisos API por Dirección/Finanzas/Operaciones/Operador y redacción financiera');
    }
  }
  if (!postgrestCostosVerificado) {
    OMITTED.push('Denegación de costos por PostgREST directo: no se completó la invitación/aceptación del rol Operador en este intento.');
  }

  // Solo modifica la suscripción sintética del tenant local desechable; el
  // GET de facturación materializa el vencimiento tal como hace la aplicación.
  if (process.env.MVP_E2E_ADMIN_EMAIL && process.env.MVP_E2E_ADMIN_PASSWORD) {
    const vencimientoFixture = await fetchLocal(new URL(`/rest/v1/organizacion_suscripciones?id=eq.${encodeURIComponent(subscriptionId)}`, env.supabase), {
      method: 'PATCH',
      headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json', prefer: 'return=minimal' },
      body: JSON.stringify({ inicia_en: '2019-01-01T00:00:00.000Z', termina_en: '2020-01-01T00:00:00.000Z', renueva_en: null }),
    }, supabaseOrigin, 'preparar suscripción vencida local');
    assertStatus(vencimientoFixture, [204], 'preparar vencimiento de la suscripción sintética');
    await vencimientoFixture.arrayBuffer();
    const vencimientoResponse = await fetchLocal(new URL('/api/planta/suscripcion', env.app), {
      headers: jsonHeaders(ownerA.token, ownerA.plantId),
    }, appOrigin, 'materializar vencimiento local');
    const vencimiento = await responseJson(vencimientoResponse, 'materializar vencimiento local');
    assertStatus(vencimientoResponse, [200], 'consultar suscripción vencida', vencimiento);
    assert.equal(vencimiento.suscripciones.find((item) => item.id === subscriptionId)?.estado, 'vencida');
    const bloqueoVencidaResponse = await fetchLocal(new URL('/api/planta/estructura', env.app), {
      method: 'POST', headers: jsonHeaders(ownerA.token, ownerA.plantId),
      body: JSON.stringify({ tipo: 'activo', activo: { id: 'M-EXPIRED', linea_id: 'L-01', tipo: 'MA', nombre: `Máquina vencida ${suffix}`, etapa: 'Ensamble', etapa_orden: 6, tarifa_hora: 100 } }),
    }, appOrigin, 'bloqueo tras vencimiento local');
    const bloqueoVencida = await responseJson(bloqueoVencidaResponse, 'bloqueo tras vencimiento local');
    assertStatus(bloqueoVencidaResponse, [402], 'el plan vencido debe bloquear nuevas altas', bloqueoVencida);
    assert.match(bloqueoVencida.error || '', /no tiene un plan activo/i);
    report('PASS vencimiento materializado y nuevas altas bloqueadas');
  }

  SUITES.push('registro y login por API real');
  if (mailpitAvailable) SUITES.push('confirmación del registro del titular desde el correo real de Mailpit y retorno a /activar');
  SUITES.push('configuración inicial transaccional de dos empresas');
  SUITES.push('aislamiento de datos en GET /api/planta y suscripción');
  SUITES.push('solicitud de plan y pago manual pendiente');
  SUITES.push('carga privada y validación administrativa del comprobante PDF');
  SUITES.push('cancelación segura de solicitud/pago pendiente');
  if (process.env.MVP_E2E_ADMIN_EMAIL && process.env.MVP_E2E_ADMIN_PASSWORD) {
    SUITES.push('renovación semestral/anual, cancelación de renovación pendiente y pagada, y fin de periodo activo');
  }
  SUITES.push('bloqueo API mientras no hay plan activo');
  SUITES.push('recuperación de contraseña por correo vía Mailpit');
  if (postgrestCostosVerificado) SUITES.push('acceso directo PostgREST denegado para costos a Operador');
  if (process.env.MVP_E2E_ADMIN_EMAIL && process.env.MVP_E2E_ADMIN_PASSWORD) {
    SUITES.push('verificación administrativa local y cuota Starter por API');
    SUITES.push('vencimiento de plan y bloqueo de nuevas altas');
    if (cerrarPlanVencidoVerificado) SUITES.push('cierre seguro de paro abierto después del vencimiento del plan');
    if (foliosUnicosVerificados) SUITES.push('64 ciclos seguidos de paro/cierre sin colisión de folios');
    SUITES.push('ciclo atómico de cierre por Operador, reflejo persistido e idempotencia ante doble toque');
    SUITES.push('ciclo atómico de paro validado y cierre por Mantenimiento');
    SUITES.push('descarte atómico de falso positivo sin evento financiero');
    SUITES.push('el operador solo puede retirar su propio reporte pendiente');
  }
  if (mailpitAvailable) SUITES.push('invitaciones/roles vía Mailpit (si logró entregar los mensajes)');

  report('RESUMEN:');
  for (const suite of SUITES) report(`PASS · ${suite}`);
  if (OMITTED.length) {
    for (const item of OMITTED) report(`NO EJECUTADO · ${item}`);
  }
  report('NO EJECUTADO · transición automática por calendario de una renovación futura; cargas 10k/100k; CFDI/retención y proveedores externos de WhatsApp/PDF/IA/SMTP.');
  report(`Datos locales creados y no borrados: email propietario A=${ownerAEmail}; propietario B=${ownerBEmail}; orgA=${ownerA.orgId}; orgB=${ownerB.orgId}; suscripción=${subscriptionId}.`);
  report('Nunca se imprimieron contraseñas, tokens ni claves. El runner no limpió ni borró datos.');
}

run().catch((error) => {
  console.error(`[e2e-mvp-local] FAIL · ${String(error?.message || error).replace(/[\r\n\t]/g, ' ').slice(0, 500)}`);
  process.exitCode = 1;
});
