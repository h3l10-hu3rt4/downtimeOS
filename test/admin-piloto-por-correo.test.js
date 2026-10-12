import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

process.env.DASHBOARD_ADMIN_EMAIL = 'admin@example.test';
process.env.DASHBOARD_ADMIN_PASSWORD = 'clave-de-prueba';

const { crearCookieSesion } = await import('../lib/administracion.js');
const { supabase } = await import('../lib/supabase.js');
const endpoint = (await import('../api/administracion/suscripciones.js')).default;
const panel = await readFile(new URL('../app/administracion/suscripciones/panel.js', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20261005000100_piloto_por_correo_titular.sql', import.meta.url), 'utf8');
const migrationPlanes = await readFile(new URL('../supabase/migrations/20261012085332_pilot_catalog_and_selectable_tier.sql', import.meta.url), 'utf8');
const migrationCambioPiloto = await readFile(new URL('../supabase/migrations/20261012091600_admin_cambiar_plan_piloto_activo.sql', import.meta.url), 'utf8');
const migrationCancelarPiloto = await readFile(new URL('../supabase/migrations/20261012095513_admin_cancelar_piloto_inmediato.sql', import.meta.url), 'utf8');

function response() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    send(body) { this.body = body; return this; },
    end() { return this; },
  };
}

function mockLookup({ perfil, organizacion, resultado = { id: 'sub', plan_codigo: 'pro', termina_en: '2026-10-19T12:00:00Z' }, errorRpc = null }) {
  const llamadasRpc = [];
  supabase.auth = { admin: { async listUsers({ page, perPage }) {
    assert.equal(page, 1);
    assert.equal(perPage, 1000);
    return { data: { users: [{ id: 'owner-id', email: 'fundador@empresa.test' }] }, error: null };
  } } };
  supabase.from = (tabla) => {
    let eqCalls = [];
    const query = {
      select() { return query; },
      eq(campo, valor) { eqCalls.push([campo, valor]); return query; },
      maybeSingle: async () => {
        assert.equal(tabla, 'organizaciones');
        assert.deepEqual(eqCalls, [['id', 'org-id']]);
        return { data: organizacion, error: null };
      },
      then(resolve, reject) {
        assert.equal(tabla, 'planta_perfiles');
        assert.deepEqual(eqCalls, [['user_id', 'owner-id'], ['es_admin_cuenta', true], ['activo', true]]);
        return Promise.resolve({ data: perfil ? [perfil] : [], error: null }).then(resolve, reject);
      },
    };
    return query;
  };
  supabase.rpc = async (...args) => {
    llamadasRpc.push(args);
    return { data: resultado, error: errorRpc };
  };
  return llamadasRpc;
}

test('admin activa piloto de 14 días buscando al propietario fundador por correo', async () => {
  const originales = { from: supabase.from, rpc: supabase.rpc, auth: supabase.auth };
  const llamadas = mockLookup({
    perfil: { organizacion_id: 'org-id' },
    organizacion: { id: 'org-id', nombre: 'Diabtrack', propietario_id: 'owner-id' },
  });
  try {
    const res = response();
    await endpoint({ method: 'POST', headers: { cookie: crearCookieSesion() }, body: { accion: 'piloto_por_correo', correo: ' Fundador@Empresa.test ', plan_codigo: 'pro' } }, res);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.resultado.organizacion, 'Diabtrack');
    assert.equal(body.resultado.correo, 'fundador@empresa.test');
    assert.match(body.mensaje, /PRO.*14 días/);
    assert.deepEqual(llamadas, [['organizacion_admin_activar_piloto_titular', {
      p_organizacion_id: 'org-id', p_propietario_id: 'owner-id', p_plan_codigo: 'pro', p_admin: 'admin@example.test',
    }]]);
  } finally {
    supabase.from = originales.from;
    supabase.rpc = originales.rpc;
    supabase.auth = originales.auth;
  }
});

test('el endpoint no activa el piloto si el correo no es titular fundador', async () => {
  const originales = { from: supabase.from, rpc: supabase.rpc, auth: supabase.auth };
  const llamadas = mockLookup({ perfil: { organizacion_id: 'org-id' }, organizacion: { id: 'org-id', nombre: 'Otra', propietario_id: 'different-owner' } });
  try {
    const res = response();
    await endpoint({ method: 'POST', headers: { cookie: crearCookieSesion() }, body: { accion: 'piloto_por_correo', correo: 'fundador@empresa.test', plan_codigo: 'starter' } }, res);
    assert.equal(res.statusCode, 403);
    assert.equal(llamadas.length, 0);
  } finally {
    supabase.from = originales.from;
    supabase.rpc = originales.rpc;
    supabase.auth = originales.auth;
  }
});

test('el endpoint convierte la FK de plan faltante en un mensaje operativo y no expone Postgres', async () => {
  const originales = { from: supabase.from, rpc: supabase.rpc, auth: supabase.auth };
  const llamadas = mockLookup({
    perfil: { organizacion_id: 'org-id' },
    organizacion: { id: 'org-id', nombre: 'Prueba', propietario_id: 'owner-id' },
    errorRpc: { code: '23503', message: 'insert or update violates foreign key constraint "organizacion_suscripciones_plan_codigo_fkey"' },
  });
  try {
    const res = response();
    await endpoint({ method: 'POST', headers: { cookie: crearCookieSesion() }, body: { accion: 'piloto_por_correo', correo: 'fundador@empresa.test', plan_codigo: 'starter' } }, res);
    assert.equal(res.statusCode, 503);
    const body = JSON.parse(res.body);
    assert.match(body.error, /falta el plan seleccionado/i);
    assert.doesNotMatch(body.error, /foreign key|organizacion_suscripciones_plan_codigo_fkey/i);
    assert.equal(llamadas.length, 1);
  } finally {
    supabase.from = originales.from;
    supabase.rpc = originales.rpc;
    supabase.auth = originales.auth;
  }
});

test('la activación de piloto exige sesión y correo válido', async () => {
  const resSinSesion = response();
  await endpoint({ method: 'POST', headers: { cookie: '' }, body: { accion: 'piloto_por_correo', correo: 'a@b.com' } }, resSinSesion);
  assert.equal(resSinSesion.statusCode, 401);

  const resCorreo = response();
  await endpoint({ method: 'POST', headers: { cookie: crearCookieSesion() }, body: { accion: 'piloto_por_correo', correo: 'no-es-correo', plan_codigo: 'starter' } }, resCorreo);
  assert.equal(resCorreo.statusCode, 400);
});

test('el endpoint solo permite los tres códigos de plan y exige escoger uno', async () => {
  const res = response();
  await endpoint({ method: 'POST', headers: { cookie: crearCookieSesion() }, body: { accion: 'piloto_por_correo', correo: 'fundador@empresa.test', plan_codigo: 'gold' } }, res);
  assert.equal(res.statusCode, 400);
  assert.match(JSON.parse(res.body).error, /plan válido/i);
});

test('admin cambia el nivel de un piloto vigente mediante RPC restringido y sin cargos', async () => {
  const originalRpc = supabase.rpc;
  const llamadas = [];
  supabase.rpc = async (...args) => { llamadas.push(args); return { data: { id: 'sub-id', plan_codigo: 'pro', termina_en: '2026-10-26T10:00:00Z' }, error: null }; };
  try {
    const res = response();
    await endpoint({ method: 'PATCH', headers: { cookie: crearCookieSesion() }, body: { id: 'sub-id', accion: 'cambiar_plan_piloto', plan_codigo: 'pro' } }, res);
    assert.equal(res.statusCode, 200);
    assert.match(JSON.parse(res.body).mensaje, /conserva la fecha de vencimiento y no hay cargos/i);
    assert.deepEqual(llamadas, [['organizacion_admin_cambiar_plan_piloto', {
      p_suscripcion_id: 'sub-id', p_plan_codigo: 'pro', p_admin: 'admin@example.test',
    }]]);
  } finally { supabase.rpc = originalRpc; }
});

test('admin cancela inmediatamente un piloto desde la acción auditada', async () => {
  const originalRpc = supabase.rpc;
  const llamadas = [];
  supabase.rpc = async (...args) => { llamadas.push(args); return { data: { id: 'sub-id', plan_codigo: 'starter', estado: 'cancelada' }, error: null }; };
  try {
    const res = response();
    await endpoint({ method: 'PATCH', headers: { cookie: crearCookieSesion() }, body: { id: 'sub-id', accion: 'cancelar_piloto' } }, res);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.match(body.mensaje, /cancelado ahora/i);
    assert.deepEqual(llamadas, [['organizacion_admin_cancelar_piloto', {
      p_suscripcion_id: 'sub-id', p_admin: 'admin@example.test',
    }]]);
  } finally { supabase.rpc = originalRpc; }
});

test('cancelación devuelve un error seguro si el piloto venció o ya no está activo', async () => {
  const originalRpc = supabase.rpc;
  supabase.rpc = async () => ({ data: null, error: { code: '22023', message: 'pilot is no longer active' } });
  try {
    const res = response();
    await endpoint({ method: 'PATCH', headers: { cookie: crearCookieSesion() }, body: { id: 'sub-id', accion: 'cancelar_piloto' } }, res);
    assert.equal(res.statusCode, 409);
    assert.match(JSON.parse(res.body).error, /vigente/i);
    assert.doesNotMatch(res.body, /22023|pilot is no longer active/i);
  } finally { supabase.rpc = originalRpc; }
});

test('cancelación inmediata solo afecta pilotos vigentes, registra auditoría y limita el RPC', () => {
  assert.match(migrationCancelarPiloto, /estado <> 'piloto'/i);
  assert.match(migrationCancelarPiloto, /termina_en <= now\(\)/i);
  assert.match(migrationCancelarPiloto, /estado = 'cancelada'/i);
  assert.match(migrationCancelarPiloto, /termina_en = now\(\)/i);
  assert.match(migrationCancelarPiloto, /piloto_cancelado_admin/i);
  assert.match(migrationCancelarPiloto, /v_termina_en/i);
  assert.match(migrationCancelarPiloto, /revoke all on function[\s\S]*from public, anon, authenticated/i);
  assert.match(migrationCancelarPiloto, /grant execute on function[\s\S]*to service_role/i);
});

test('el cambio de plan conserva vigencia, valida límites y solo da acceso al service_role', () => {
  assert.match(migrationCambioPiloto, /v_suscripcion\.estado <> 'piloto'/i);
  assert.match(migrationCambioPiloto, /v_suscripcion\.termina_en <= now\(\)/i);
  assert.match(migrationCambioPiloto, /v_plan\.max_activos/i);
  assert.match(migrationCambioPiloto, /v_plan\.max_plantas/i);
  assert.match(migrationCambioPiloto, /al menos tres plantas activas/i);
  assert.match(migrationCambioPiloto, /plan_codigo = v_plan\.codigo/i);
  assert.match(migrationCambioPiloto, /sin_reinicio_plazo/i);
  assert.match(migrationCambioPiloto, /revoke all on function[\s\S]*from public, anon, authenticated/i);
  assert.match(migrationCambioPiloto, /grant execute on function[\s\S]*to service_role/i);
});

test('el panel expone piloto por correo fundador con alcance y límites explícitos', () => {
  assert.match(panel, /Activar piloto para una cuenta/);
  assert.match(panel, /value="pro">Pro/);
  assert.match(panel, /value="enterprise">Enterprise/);
  assert.match(panel, /plan_codigo: planPiloto/);
  assert.match(panel, /CAMBIAR PLAN DEL PILOTO ACTIVO/);
  assert.match(panel, /cambiar_plan_piloto/);
  assert.match(panel, /cancelar_piloto/);
  assert.match(panel, /Cancelar piloto ahora/);
  assert.match(panel, /!periodoOfrecido && s\.estado !== 'piloto'/);
  assert.match(panel, /administrador fundador/);
  assert.match(panel, /piloto_por_correo/);
  assert.match(panel, /no envía una invitación/);
  assert.doesNotMatch(panel, /window\.confirm/);
  assert.match(panel, /admin-confirm-dialog/);
});

test('la migración repone catálogo con valores canónicos sin sobrescribir y habilita pilotos de cualquier nivel', () => {
  assert.match(migrationPlanes, /\('starter',\s*'Starter',\s*49,\s*294,\s*588/);
  assert.match(migrationPlanes, /\('pro',\s*'Pro',\s*149,\s*894,\s*1788/);
  assert.match(migrationPlanes, /\('enterprise',\s*'Enterprise',\s*299,\s*1794,\s*3588/);
  assert.match(migrationPlanes, /on conflict \(codigo\) do nothing/i);
  assert.match(migrationPlanes, /p_plan_codigo text/i);
  assert.match(migrationPlanes, /v_plan\.max_activos/i);
  assert.match(migrationPlanes, /v_plan\.max_plantas/i);
  assert.match(migrationPlanes, /al menos tres plantas activas/i);
  assert.match(migrationPlanes, /interval '14 days'/i);
  assert.match(migrationPlanes, /grant execute[\s\S]*to service_role/i);
});

test('el RPC valida propiedad, evita pilotos duplicados, aplica 14 días y solo acepta service_role', () => {
  assert.match(migration, /security definer/i);
  assert.match(migration, /propietario_id\s*=\s*p_propietario_id/i);
  assert.match(migration, /p\.es_admin_cuenta\s+and\s+p\.activo/i);
  assert.match(migration, /interval '14 days'/i);
  assert.match(migration, /estado in \('solicitada','pendiente_pago','activa','piloto','cancelacion_programada'\)/i);
  assert.match(migration, /revoke all on function[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function[\s\S]*to service_role/i);
});
