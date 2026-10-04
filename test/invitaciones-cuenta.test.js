import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// Cliente Supabase/Auth enteramente en memoria: estos tests nunca envían correos
// ni abren conexiones de red.
process.env.SUPABASE_URL ??= 'https://unit-test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'unit-test-only';
process.env.APP_URL = 'https://downtimeos.test';

const { supabase } = await import('../lib/supabase.js');
const { aceptarInvitacion, invitarUsuario, reenviarInvitacion, sesionDesdeEncabezado } = await import('../lib/cuenta.js');

const OWNER = '11111111-1111-4111-8111-111111111111';
const INVITEE = '22222222-2222-4222-8222-222222222222';
const PLANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PLANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const INV_A = '33333333-3333-4333-8333-333333333333';
const INV_B = '44444444-4444-4444-8444-444444444444';
const TOKEN_A = 'A'.repeat(48);
const TOKEN_B = 'B'.repeat(48);
const hash = (token) => createHash('sha256').update(token).digest('hex');
const dentroDe72Horas = (timestamp, referencia = Date.now()) => {
  const diferencia = new Date(timestamp).getTime() - referencia;
  return diferencia >= 72 * 60 * 60 * 1000 - 5000 && diferencia <= 72 * 60 * 60 * 1000 + 5000;
};

let db;
let rpcCalls;
let authCalls;
let dbFailures;

function query(table) {
  const predicates = [];
  let operation = 'select';
  let payload;
  let selected = false;
  const matching = () => (db[table] || []).filter((row) => predicates.every((p) => p(row)));
  const execute = () => {
    const failureIndex = dbFailures.findIndex((failure) => failure.table === table && failure.operation === operation);
    if (failureIndex >= 0 && dbFailures[failureIndex].skip > 0) dbFailures[failureIndex].skip -= 1;
    else if (failureIndex >= 0) {
      const failure = dbFailures.splice(failureIndex, 1)[0];
      failure.onFailure?.();
      return { __failure: failure.error };
    }
    if (operation === 'insert') {
      const rows = Array.isArray(payload) ? payload : [payload];
      db[table].push(...rows.map((r) => ({ ...r })));
      return rows;
    }
    if (operation === 'upsert') {
      const old = db[table].find((r) => r.user_id === payload.user_id && r.planta_id === payload.planta_id);
      if (old) Object.assign(old, payload);
      else db[table].push({ ...payload });
      return [old || db[table].at(-1)];
    }
    if (operation === 'update') return matching().map((r) => Object.assign(r, payload));
    if (operation === 'delete') {
      const removed = matching();
      db[table] = db[table].filter((r) => !removed.includes(r));
      return removed;
    }
    return matching();
  };
  const q = {
    select() { selected = true; return q; },
    eq(key, value) { predicates.push((row) => row[key] === value); return q; },
    is(key, value) { predicates.push((row) => row[key] === value); return q; },
    order() { return q; },
    insert(value) { operation = 'insert'; payload = value; return q; },
    upsert(value) { operation = 'upsert'; payload = value; return q; },
    update(value) { operation = 'update'; payload = value; return q; },
    delete() { operation = 'delete'; return q; },
    maybeSingle: async () => { const result = execute(); return result?.__failure ? { data: null, error: result.__failure } : { data: result[0] ? { ...result[0] } : null, error: null }; },
    single: async () => { const result = execute(); return result?.__failure ? { data: null, error: result.__failure } : { data: result[0] ? { ...result[0] } : null, error: null }; },
    then(resolve, reject) { const result = execute(); return Promise.resolve(result?.__failure ? { data: null, error: result.__failure } : { data: result, error: null }).then(resolve, reject); },
  };
  return q;
}

const invitation = (id, plant, email, acceptanceToken) => ({
  id, organizacion_id: 'org-1', planta_id: plant, auth_user_id: INVITEE,
  email, nombre: 'Invitado', rol: 'operador', estado: 'pendiente',
  acceptance_token_hash: hash(acceptanceToken),
  expires_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
});

function setup() {
  db = {
    organizaciones: [{ id: 'org-1', propietario_id: OWNER }],
    organizacion_admin_delegados: [],
    planta_invitaciones: [
      invitation(INV_A, PLANT_A, 'persona@empresa.test', TOKEN_A),
      invitation(INV_B, PLANT_B, 'persona@empresa.test', TOKEN_B),
    ],
    planta_membresias: [
      { user_id: INVITEE, organizacion_id: 'org-1', planta_id: PLANT_A, rol: 'operador', activo: false, created_at: '2026-01-01' },
      { user_id: INVITEE, organizacion_id: 'org-1', planta_id: PLANT_B, rol: 'operador', activo: false, created_at: '2026-01-02' },
    ],
    planta_perfiles: [],
    planta_auditoria: [],
  };
  rpcCalls = [];
  authCalls = [];
  dbFailures = [];
  supabase.from = query;
  supabase.auth = {
    async getUser(sessionToken) {
      authCalls.push(['getUser', sessionToken]);
      if (sessionToken === 'session-valid') return { data: { user: { id: INVITEE, email: 'persona@empresa.test' } }, error: null };
      if (sessionToken === 'session-wrong-email') return { data: { user: { id: INVITEE, email: 'otra@empresa.test' } }, error: null };
      return { data: { user: null }, error: { message: 'invalid session' } };
    },
    admin: {
      async getUserById(id) {
        authCalls.push(['getUserById', id]);
        return { data: { user: { id, email: 'persona@empresa.test', email_confirmed_at: '2026-01-01' } }, error: null };
      },
    },
    async signInWithOtp(options) { authCalls.push(['signInWithOtp', options]); return { error: null }; },
    async resend(options) { authCalls.push(['resend', options]); return { error: null }; },
    async resetPasswordForEmail(...args) { authCalls.push(['resetPasswordForEmail', ...args]); return { error: null }; },
    async signUp() { throw new Error('No se esperaba signUp en este test'); },
  };
  supabase.rpc = async (name, args) => {
    rpcCalls.push([name, args]);
    assert.equal(name, 'planta_aceptar_invitacion');
    const row = db.planta_invitaciones.find((i) => i.id === args.p_invitacion_id);
    if (!row || row.auth_user_id !== args.p_usuario_id
      || row.email !== args.p_email || row.acceptance_token_hash !== args.p_token_hash) {
      return { data: null, error: { code: '42501', message: 'invitation mismatch' } };
    }
    if (row.estado === 'aceptada') {
      const membresiaAceptada = db.planta_membresias.some((m) => m.user_id === INVITEE && m.planta_id === row.planta_id && m.activo);
      return membresiaAceptada
        ? { data: { planta_id: row.planta_id, estado: 'aceptada' }, error: null }
        : { data: null, error: { code: 'P0002', message: 'invitation is not active' } };
    }
    if (row.estado !== 'pendiente') return { data: null, error: { code: 'P0002', message: 'invitation is not pending' } };
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      return { data: null, error: { code: 'P0002', message: 'invitation expired' } };
    }
    row.estado = 'aceptada';
    db.planta_membresias.find((m) => m.user_id === INVITEE && m.planta_id === row.planta_id).activo = true;
    return { data: { planta_id: row.planta_id, estado: 'aceptada' }, error: null };
  };
}

const ownerSession = {
  user: { id: OWNER },
  perfil: {
    es_admin_cuenta: true, organizacion_id: 'org-1', planta_id: PLANT_A,
    rol: 'direccion', plantas: { codigo: 'PL-A' }, onboarding_completado_en: '2026-01-01T00:00:00Z',
  },
};

beforeEach(setup);

test('el token de una sesión no conserva acceso después de revocar la membresía activa', async () => {
  const membresia = db.planta_membresias.find((fila) => fila.planta_id === PLANT_A);
  membresia.activo = true;
  membresia.plantas = { nombre: 'Planta A', codigo: 'PL-A' };
  membresia.organizaciones = { nombre: 'Empresa', propietario_id: OWNER };

  const tokenVigente = 'Bearer session-valid';
  const sesionAntesDeRevocar = await sesionDesdeEncabezado(tokenVigente, PLANT_A);
  assert.equal(sesionAntesDeRevocar.user.id, INVITEE);
  assert.equal(sesionAntesDeRevocar.perfil.planta_id, PLANT_A);

  // Simula la revocación en la base mientras Auth todavía considera vigente el token.
  membresia.activo = false;
  await assert.rejects(sesionDesdeEncabezado(tokenVigente, PLANT_A), {
    status: 403,
    message: 'No tienes acceso a esa planta.',
  });
  assert.equal(authCalls.filter(([accion]) => accion === 'getUser').length, 2,
    'la validez del token se consulta, pero la autorización se vuelve a comprobar contra la membresía');
});

test('la membresía de invitado sigue inactiva hasta aceptar con sesión y token correctos', async () => {
  assert.equal(db.planta_membresias.find((m) => m.planta_id === PLANT_A).activo, false);
  const result = await aceptarInvitacion('Bearer session-valid', INV_A, TOKEN_A);
  assert.equal(result.perfil.planta_id, PLANT_A);
  assert.equal(db.planta_membresias.find((m) => m.planta_id === PLANT_A).activo, true);
  assert.equal(db.planta_membresias.find((m) => m.planta_id === PLANT_B).activo, false);
  assert.equal(db.planta_invitaciones.find((i) => i.id === INV_A).estado, 'aceptada');
  assert.equal(db.planta_invitaciones.find((i) => i.id === INV_B).estado, 'pendiente');
});

test('rechaza sesión inválida sin activar membresías ni llamar RPC', async () => {
  await assert.rejects(aceptarInvitacion('Bearer invalid', INV_A, TOKEN_A), { status: 401 });
  assert.equal(db.planta_membresias.some((m) => m.activo), false);
  assert.equal(rpcCalls.length, 0);
});

test('rechaza email de sesión que no corresponde a la invitación', async () => {
  await assert.rejects(aceptarInvitacion('Bearer session-wrong-email', INV_A, TOKEN_A), { status: 403 });
  assert.equal(db.planta_membresias.some((m) => m.activo), false);
  assert.equal(rpcCalls.length, 1, 'la validación atómica del servidor rechaza el email discordante');
});

test('rechaza token incorrecto y conserva todas las membresías inactivas', async () => {
  await assert.rejects(aceptarInvitacion('Bearer session-valid', INV_A, TOKEN_B), { status: 403 });
  assert.equal(db.planta_membresias.some((m) => m.activo), false);
  assert.equal(db.planta_invitaciones.every((i) => i.estado === 'pendiente'), true);
});

test('rechaza una invitación vencida y no activa membresías', async () => {
  db.planta_invitaciones[0].expires_at = new Date(Date.now() - 1).toISOString();
  await assert.rejects(aceptarInvitacion('Bearer session-valid', INV_A, TOKEN_A), { status: 409 });
  assert.equal(db.planta_membresias.some((m) => m.activo), false);
  assert.equal(db.planta_invitaciones[0].estado, 'pendiente');
});

test('aceptar una invitación activa solo esa invitación, aunque haya otra para el mismo usuario', async () => {
  await aceptarInvitacion('Bearer session-valid', INV_A, TOKEN_A);
  assert.deepEqual(db.planta_membresias.map((m) => [m.planta_id, m.activo]), [[PLANT_A, true], [PLANT_B, false]]);
  assert.deepEqual(db.planta_invitaciones.map((i) => [i.id, i.estado]), [[INV_A, 'aceptada'], [INV_B, 'pendiente']]);
});

test('un fallo temporal al cargar el perfil no presenta como bloqueada una invitación ya aceptada y permite reintentar', async () => {
  dbFailures.push({ table: 'planta_membresias', operation: 'select', error: { message: 'simulated database timeout' } });

  await assert.rejects(aceptarInvitacion('Bearer session-valid', INV_A, TOKEN_A), {
    status: 503,
    code: 'INVITATION_ACCEPTED_PROFILE_PENDING',
    message: /invitación quedó aceptada.*problema temporal.*no necesitas otro enlace/i,
  });
  assert.equal(db.planta_invitaciones.find((i) => i.id === INV_A).estado, 'aceptada');
  assert.equal(db.planta_membresias.find((m) => m.planta_id === PLANT_A).activo, true);

  const result = await aceptarInvitacion('Bearer session-valid', INV_A, TOKEN_A);
  assert.equal(result.perfil.planta_id, PLANT_A);
});

test('invitarUsuario prepara la membresía inactiva y persiste invitación antes de disparar correo simulado', async () => {
  db.planta_invitaciones = db.planta_invitaciones.filter((i) => i.planta_id !== PLANT_A);
  supabase.auth.admin = {
    async listUsers() { return { data: { users: [{ id: INVITEE, email: 'persona@empresa.test', email_confirmed_at: '2026-01-01' }] }, error: null }; },
  };
  let membershipWasInactiveAtSend = false;
  supabase.auth.signInWithOtp = async ({ email, options }) => {
    const membership = db.planta_membresias.find((m) => m.user_id === INVITEE && m.planta_id === PLANT_A);
    const savedInvite = db.planta_invitaciones.find((i) => i.email === email && i.planta_id === PLANT_A);
    membershipWasInactiveAtSend = membership?.activo === false && savedInvite?.estado === 'pendiente';
    authCalls.push(['signInWithOtp', { email, options }]);
    return { error: null };
  };
  await invitarUsuario(ownerSession, { email: 'persona@empresa.test', nombre: 'Invitado', rol: 'operador' });
  assert.equal(membershipWasInactiveAtSend, true);
  assert.equal(db.planta_membresias.find((m) => m.planta_id === PLANT_A).activo, false);
  assert.equal(db.planta_invitaciones.find((i) => i.planta_id === PLANT_A).estado, 'pendiente');
  const savedInvite = db.planta_invitaciones.find((i) => i.planta_id === PLANT_A);
  assert.equal(dentroDe72Horas(savedInvite.expires_at, new Date(savedInvite.enviada_en).getTime()), true);
  assert.match(savedInvite.acceptance_token_hash, /^[a-f0-9]{64}$/);
  const url = new URL(authCalls.find((c) => c[0] === 'signInWithOtp')[1].options.emailRedirectTo);
  assert.equal(url.searchParams.get('flujo'), 'invitacion');
  assert.ok(url.searchParams.get('token'));
});

test('si falla la auditoría después de enviar la invitación, registra el fallo sin ocultar el envío exitoso', async () => {
  db.planta_invitaciones = db.planta_invitaciones.filter((i) => i.planta_id !== PLANT_A);
  supabase.auth.admin = {
    async listUsers() { return { data: { users: [{ id: INVITEE, email: 'persona@empresa.test', email_confirmed_at: '2026-01-01' }] }, error: null }; },
  };
  supabase.auth.signInWithOtp = async ({ email, options }) => {
    authCalls.push(['signInWithOtp', { email, options }]);
    return { error: null };
  };
  dbFailures.push({ table: 'planta_auditoria', operation: 'insert', error: { message: 'audit table unavailable' } });
  const errorOriginal = console.error;
  const avisos = [];
  console.error = (...args) => avisos.push(args);
  try {
    const resultado = await invitarUsuario(ownerSession, { email: 'persona@empresa.test', nombre: 'Invitado', rol: 'operador' });
    assert.equal(resultado.email, 'persona@empresa.test');
    assert.equal(db.planta_invitaciones.some((fila) => fila.planta_id === PLANT_A && fila.estado === 'pendiente'), true);
    assert.equal(authCalls.some(([accion]) => accion === 'signInWithOtp'), true);
    assert.match(avisos[0]?.[0] || '', /no se pudo auditar la invitación/i);
    assert.match(avisos[0]?.[1] || '', /audit table unavailable/);
  } finally {
    console.error = errorOriginal;
  }
});

test('permite invitar operadores con correo personal aunque el alta de empresa sea B2B', async () => {
  for (const email of ['operador@gmail.com', 'operaciones@outlook.com']) {
    setup();
    supabase.auth.admin = {
      async listUsers() {
        return { data: { users: [{ id: INVITEE, email, email_confirmed_at: '2026-01-01' }] }, error: null };
      },
    };

    const resultado = await invitarUsuario(ownerSession, { email, nombre: 'Operador de prueba', rol: 'operador' });

    assert.equal(resultado.email, email);
    assert.equal(db.planta_invitaciones.find((i) => i.planta_id === PLANT_A && i.email === email)?.email, email);
    assert.equal(db.planta_membresias.find((m) => m.planta_id === PLANT_A)?.activo, false);
    assert.equal(authCalls.some(([accion]) => accion === 'signInWithOtp'), true);
  }
});

test('si falla guardar la invitación, no manda correo y mantiene inactiva la membresía', async () => {
  db.planta_invitaciones = db.planta_invitaciones.filter((i) => i.planta_id !== PLANT_A);
  supabase.auth.admin = {
    async listUsers() { return { data: { users: [{ id: INVITEE, email: 'persona@empresa.test', email_confirmed_at: '2026-01-01' }] }, error: null }; },
  };
  dbFailures.push({ table: 'planta_invitaciones', operation: 'insert', error: { message: 'simulated database failure' } });

  await assert.rejects(
    invitarUsuario(ownerSession, { email: 'persona@empresa.test', nombre: 'Invitado', rol: 'operador' }),
    { status: 500, message: /no se envió ningún enlace/i },
  );

  assert.equal(db.planta_membresias.find((m) => m.planta_id === PLANT_A).activo, false);
  assert.equal(db.planta_invitaciones.some((i) => i.planta_id === PLANT_A), false);
  assert.equal(authCalls.some(([accion]) => ['signInWithOtp', 'resend'].includes(accion)), false);
});

test('si se pierde la respuesta de envío, conserva la invitación pendiente para un enlace que pudo llegar', async () => {
  db.planta_invitaciones = db.planta_invitaciones.filter((i) => i.planta_id !== PLANT_A);
  supabase.auth.admin = {
    async listUsers() { return { data: { users: [{ id: INVITEE, email: 'persona@empresa.test', email_confirmed_at: '2026-01-01' }] }, error: null }; },
  };
  supabase.auth.signInWithOtp = async () => { throw new Error('fetch failed after provider accepted request'); };

  await assert.rejects(
    invitarUsuario(ownerSession, { email: 'persona@empresa.test', nombre: 'Invitado', rol: 'operador' }),
    { status: 503, code: 'INVITATION_EMAIL_DELIVERY_UNKNOWN', message: /no pudimos confirmar.*invitación sigue pendiente.*pudo haberse enviado/i },
  );

  const pendiente = db.planta_invitaciones.find((i) => i.planta_id === PLANT_A);
  assert.ok(pendiente, 'conserva el token que pudo quedar en un correo ya entregado');
  assert.equal(pendiente.estado, 'pendiente');
  assert.equal(db.planta_membresias.find((m) => m.planta_id === PLANT_A).activo, false);
});

test('si otra solicitud concurrente guardó la invitación, el intento perdedor conserva la membresía pendiente', async () => {
  db.planta_invitaciones = db.planta_invitaciones.filter((i) => i.planta_id !== PLANT_A);
  supabase.auth.admin = {
    async listUsers() { return { data: { users: [{ id: INVITEE, email: 'persona@empresa.test', email_confirmed_at: '2026-01-01' }] }, error: null }; },
  };
  dbFailures.push({
    table: 'planta_invitaciones', operation: 'insert',
    error: { code: '23505', message: 'duplicate key' },
    onFailure() { db.planta_invitaciones.push(invitation(INV_A, PLANT_A, 'persona@empresa.test', TOKEN_A)); },
  });

  await assert.rejects(
    invitarUsuario(ownerSession, { email: 'persona@empresa.test', nombre: 'Invitado', rol: 'operador' }),
    { status: 409, message: /quedó pendiente por una solicitud simultánea/i },
  );
  assert.equal(db.planta_invitaciones.some((i) => i.planta_id === PLANT_A && i.estado === 'pendiente'), true);
  assert.equal(db.planta_membresias.find((m) => m.planta_id === PLANT_A).activo, false);
  assert.equal(authCalls.some(([accion]) => ['signInWithOtp', 'resend'].includes(accion)), false);
});

test('si falla la invitación al volver a invitar, restaura el rol y permisos de la membresía inactiva', async () => {
  db.planta_invitaciones = db.planta_invitaciones.filter((i) => i.planta_id !== PLANT_A);
  const membresia = db.planta_membresias.find((m) => m.planta_id === PLANT_A);
  Object.assign(membresia, { rol: 'finanzas', nombre: 'Finanzas previo', puede_administrar_facturacion: true, es_admin_cuenta: true, onboarding_completado_en: null });
  const previa = { ...membresia };
  supabase.auth.admin = {
    async listUsers() { return { data: { users: [{ id: INVITEE, email: 'persona@empresa.test', email_confirmed_at: '2026-01-01' }] }, error: null }; },
  };
  dbFailures.push({ table: 'planta_invitaciones', operation: 'insert', error: { message: 'simulated database failure' } });

  await assert.rejects(
    invitarUsuario(ownerSession, { email: 'persona@empresa.test', nombre: 'Invitado', rol: 'operador' }),
    { status: 500, message: /no se envió ningún enlace/i },
  );

  assert.deepEqual(db.planta_membresias.find((m) => m.planta_id === PLANT_A), previa);
  assert.equal(db.planta_perfiles.length, 0);
  assert.equal(authCalls.some(([accion]) => ['signInWithOtp', 'resend'].includes(accion)), false);
});

test('invitarUsuario busca usuarios Auth más allá de la primera página', async () => {
  db.planta_invitaciones = db.planta_invitaciones.filter((i) => i.planta_id !== PLANT_A);
  const paginas = [];
  supabase.auth.admin = {
    async listUsers({ page, perPage }) {
      paginas.push({ page, perPage });
      if (page < 3) {
        return { data: { users: Array.from({ length: 1000 }, (_, index) => ({
          id: `usuario-${page}-${index}`, email: `usuario-${page}-${index}@empresa.test`,
        })) }, error: null };
      }
      return { data: { users: [{ id: INVITEE, email: 'persona@empresa.test', email_confirmed_at: '2026-01-01' }] }, error: null };
    },
  };

  await invitarUsuario(ownerSession, { email: 'persona@empresa.test', nombre: 'Invitado', rol: 'operador' });

  assert.deepEqual(paginas, [1, 2, 3].map((page) => ({ page, perPage: 1000 })));
  assert.equal(db.planta_invitaciones.find((i) => i.planta_id === PLANT_A).auth_user_id, INVITEE);
  assert.equal(authCalls.some(([accion]) => accion === 'signInWithOtp'), true);
});

test('invitarUsuario explica el límite de correos de Supabase y deja el acceso inactivo', async () => {
  db.planta_invitaciones = db.planta_invitaciones.filter((i) => i.planta_id !== PLANT_A);
  supabase.auth.admin = {
    async listUsers() { return { data: { users: [{ id: INVITEE, email: 'persona@empresa.test', email_confirmed_at: '2026-01-01' }] }, error: null }; },
  };
  supabase.auth.signInWithOtp = async () => ({ error: { status: 429, code: 'over_email_send_rate_limit' } });

  await assert.rejects(
    invitarUsuario(ownerSession, { email: 'persona@empresa.test', nombre: 'Invitado', rol: 'operador' }),
    { status: 429, message: /límite temporal de correos.*acceso quedó desactivado/i },
  );

  assert.equal(db.planta_invitaciones.find((i) => i.planta_id === PLANT_A).estado, 'revocada');
  assert.equal(db.planta_membresias.find((m) => m.planta_id === PLANT_A).activo, false);
  assert.equal(db.planta_perfiles.length, 0);
});

test('no permite invitar a operadores antes de terminar el onboarding de la planta', async () => {
  const sesionSinOnboarding = { ...ownerSession, perfil: { ...ownerSession.perfil, onboarding_completado_en: null } };
  await assert.rejects(
    invitarUsuario(sesionSinOnboarding, { email: 'persona@empresa.test', nombre: 'Invitado', rol: 'operador' }),
    { status: 409 },
  );
  assert.equal(authCalls.length, 0, 'no consulta ni envía correos antes de completar la planta');
});

test('solo el titular puede invitar con administración delegada y la solicitud queda persistida para aceptación', async () => {
  db.planta_invitaciones = db.planta_invitaciones.filter((i) => i.planta_id !== PLANT_A);
  supabase.auth.admin = {
    async listUsers() { return { data: { users: [{ id: INVITEE, email: 'persona@empresa.test', email_confirmed_at: '2026-01-01' }] }, error: null }; },
  };
  await invitarUsuario(ownerSession, {
    email: 'persona@empresa.test', nombre: 'Invitado', rol: 'operador', administrar_cuenta: true,
  });
  const savedInvite = db.planta_invitaciones.find((i) => i.planta_id === PLANT_A);
  const pendingMembership = db.planta_membresias.find((m) => m.planta_id === PLANT_A);
  assert.equal(savedInvite.es_admin_cuenta, true);
  assert.equal(savedInvite.invitada_por, OWNER);
  assert.equal(pendingMembership.es_admin_cuenta, true);
  assert.equal(pendingMembership.activo, false, 'la delegación no autoriza hasta que acepte la invitación');

  db.organizacion_admin_delegados.push({ organizacion_id: 'org-1', user_id: INVITEE });
  const delegate = { ...ownerSession, user: { id: INVITEE }, perfil: { ...ownerSession.perfil, es_admin_cuenta: true } };
  await assert.rejects(invitarUsuario(delegate, {
    email: 'otra@empresa.test', nombre: 'Otra persona', rol: 'operaciones', administrar_cuenta: true,
  }), { status: 403 });
  await assert.rejects(invitarUsuario(delegate, {
    email: 'finanzas@empresa.test', nombre: 'Finanzas', rol: 'finanzas',
  }), { status: 403 });
  await assert.rejects(invitarUsuario(delegate, {
    email: 'facturacion@empresa.test', nombre: 'Facturación', rol: 'operaciones', administrar_facturacion: true,
  }), { status: 403 });
});

test('reenviarInvitacion usa redirect con id/token protegidos y no resetPasswordForEmail', async () => {
  const pending = db.planta_invitaciones[0];
  pending.expires_at = new Date(Date.now() + 60_000).toISOString();
  const oldExpiry = pending.expires_at;
  await assert.doesNotReject(reenviarInvitacion(ownerSession, pending));
  const otp = authCalls.find((call) => call[0] === 'signInWithOtp');
  assert.ok(otp, 'cuenta existente recibe magic link');
  const redirect = new URL(otp[1].options.emailRedirectTo);
  assert.equal(redirect.pathname, '/activar');
  assert.equal(redirect.searchParams.get('flujo'), 'invitacion');
  assert.equal(redirect.searchParams.get('invitacion'), INV_A);
  const token = redirect.searchParams.get('token');
  assert.match(token, /^[A-Za-z0-9_-]{40,64}$/);
  assert.equal(db.planta_invitaciones[0].acceptance_token_hash, hash(token));
  assert.equal(dentroDe72Horas(db.planta_invitaciones[0].expires_at, new Date(db.planta_invitaciones[0].enviada_en).getTime()), true);
  assert.ok(new Date(db.planta_invitaciones[0].expires_at) > new Date(oldExpiry), 'el reenvío prolonga la vigencia');
  await assert.rejects(aceptarInvitacion('Bearer session-valid', INV_A, TOKEN_A), { status: 403 });
  assert.equal(authCalls.some((call) => call[0] === 'resetPasswordForEmail'), false);
});

test('reenviarInvitacion revierte el hash si el proveedor simulado falla', async () => {
  const pending = db.planta_invitaciones[0];
  const oldHash = pending.acceptance_token_hash;
  pending.expires_at = new Date(Date.now() + 60_000).toISOString();
  const oldExpiry = pending.expires_at;
  supabase.auth.signInWithOtp = async () => ({ error: { message: 'simulated mail failure' } });
  await assert.rejects(reenviarInvitacion(ownerSession, pending), { status: 422 });
  assert.equal(pending.acceptance_token_hash, oldHash);
  assert.equal(pending.expires_at, oldExpiry);
  assert.equal(authCalls.some((call) => call[0] === 'resetPasswordForEmail'), false);
});

test('reenviarInvitacion conserva el token nuevo si se pierde la respuesta del proveedor', async () => {
  const pending = db.planta_invitaciones[0];
  const oldHash = pending.acceptance_token_hash;
  supabase.auth.signInWithOtp = async () => { throw new Error('fetch failed after provider accepted request'); };

  await assert.rejects(reenviarInvitacion(ownerSession, pending), {
    status: 503,
    code: 'INVITATION_EMAIL_DELIVERY_UNKNOWN',
    message: /el enlace más reciente pudo haberse enviado/i,
  });

  assert.notEqual(pending.acceptance_token_hash, oldHash);
  assert.equal(pending.estado, 'pendiente');
  assert.ok(new Date(pending.expires_at).getTime() > Date.now());
});

test('reenviarInvitacion explica el límite de correo y conserva el enlace anterior', async () => {
  const pending = db.planta_invitaciones[0];
  const oldHash = pending.acceptance_token_hash;
  pending.expires_at = new Date(Date.now() + 60_000).toISOString();
  const oldExpiry = pending.expires_at;
  supabase.auth.signInWithOtp = async () => ({ error: { status: 429, code: 'over_email_send_rate_limit' } });

  await assert.rejects(reenviarInvitacion(ownerSession, pending), {
    status: 429,
    message: /límite temporal de correos.*enlace anterior sigue vigente/i,
  });

  assert.equal(pending.acceptance_token_hash, oldHash);
  assert.equal(pending.expires_at, oldExpiry);
});

test('reenviarInvitacion no afirma que el enlace anterior siga vigente si falla la compensación', async () => {
  const pending = db.planta_invitaciones[0];
  const oldHash = pending.acceptance_token_hash;
  dbFailures.push({ table: 'planta_invitaciones', operation: 'update', skip: 1, error: { message: 'database unavailable during rollback' } });
  supabase.auth.signInWithOtp = async () => ({ error: { message: 'simulated mail failure' } });

  await assert.rejects(reenviarInvitacion(ownerSession, pending), {
    status: 503,
    message: /no pudimos enviar el nuevo enlace ni confirmar que el anterior siga vigente/i,
  });
  assert.notEqual(pending.acceptance_token_hash, oldHash, 'no debe afirmar falsamente que el hash anterior fue restaurado');
});

test('dos reenvíos concurrentes con la misma invitación solo envían un enlace', async () => {
  const pending = db.planta_invitaciones[0];
  const snapshotA = { ...pending };
  const snapshotB = { ...pending };
  let liberarCorreo;
  let correoIniciado;
  const correoEnCurso = new Promise((resolve) => { correoIniciado = resolve; });
  const bloqueoCorreo = new Promise((resolve) => { liberarCorreo = resolve; });
  supabase.auth.signInWithOtp = async () => {
    authCalls.push(['signInWithOtp-concurrente']);
    correoIniciado();
    await bloqueoCorreo;
    return { error: null };
  };

  const primero = reenviarInvitacion(ownerSession, snapshotA);
  await correoEnCurso;
  await assert.rejects(reenviarInvitacion(ownerSession, snapshotB), { status: 409 });
  liberarCorreo();
  await assert.doesNotReject(primero);

  assert.equal(authCalls.filter((call) => call[0] === 'signInWithOtp-concurrente').length, 1);
});
