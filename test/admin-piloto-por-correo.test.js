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

function response() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    send(body) { this.body = body; return this; },
    end() { return this; },
  };
}

function mockLookup({ perfil, organizacion, resultado = { id: 'sub', termina_en: '2026-10-19T12:00:00Z' }, errorRpc = null }) {
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
    await endpoint({ method: 'POST', headers: { cookie: crearCookieSesion() }, body: { accion: 'piloto_por_correo', correo: ' Fundador@Empresa.test ' } }, res);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.resultado.organizacion, 'Diabtrack');
    assert.equal(body.resultado.correo, 'fundador@empresa.test');
    assert.match(body.mensaje, /14 días/);
    assert.deepEqual(llamadas, [['organizacion_admin_activar_piloto_titular', {
      p_organizacion_id: 'org-id', p_propietario_id: 'owner-id', p_admin: 'admin@example.test',
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
    await endpoint({ method: 'POST', headers: { cookie: crearCookieSesion() }, body: { accion: 'piloto_por_correo', correo: 'fundador@empresa.test' } }, res);
    assert.equal(res.statusCode, 403);
    assert.equal(llamadas.length, 0);
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
  await endpoint({ method: 'POST', headers: { cookie: crearCookieSesion() }, body: { accion: 'piloto_por_correo', correo: 'no-es-correo' } }, resCorreo);
  assert.equal(resCorreo.statusCode, 400);
});

test('el panel expone piloto por correo fundador con alcance y límites explícitos', () => {
  assert.match(panel, /Activar piloto para una cuenta/);
  assert.match(panel, /administrador fundador/);
  assert.match(panel, /piloto_por_correo/);
  assert.match(panel, /no envía una invitación/);
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
