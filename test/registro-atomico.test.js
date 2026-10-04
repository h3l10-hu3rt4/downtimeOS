import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registrarEmpresaConDependencias } from '../lib/cuenta.js';

const cuenta = await readFile(new URL('../lib/cuenta.js', import.meta.url), 'utf8');
const sql = await readFile(new URL('../supabase/migrations/20260930000300_registro_atomico.sql', import.meta.url), 'utf8');

test('el alta usa una sola RPC transaccional para empresa, planta, perfil y membresía', () => {
  assert.match(cuenta, /organizacion_registrar_empresa/);
  assert.match(sql, /begin;[\s\S]*insert into public\.organizaciones[\s\S]*insert into public\.plantas[\s\S]*insert into public\.planta_perfiles[\s\S]*insert into public\.planta_membresias[\s\S]*insert into public\.planta_auditoria[\s\S]*commit;/);
});

test('la RPC de alta no puede ser ejecutada desde anon/authenticated', () => {
  assert.match(sql, /revoke all on function public\.organizacion_registrar_empresa\(uuid,text,text,text\)[\s\S]*from public,anon,authenticated/);
  assert.match(sql, /grant execute on function public\.organizacion_registrar_empresa\(uuid,text,text,text\)[\s\S]*to service_role/);
});

function crearDependencias({ resultadoRpc, lanzarRpc, identities = [{ id: 'identidad' }], errorAuth = null } = {}) {
  const eliminaciones = [];
  const solicitudesAuth = [];
  const llamadasRpc = [];
  return {
    eliminaciones,
    solicitudesAuth,
    llamadasRpc,
    dependencias: {
      crearAuthPublico: () => ({
        auth: {
          signUp: async (solicitud) => {
            solicitudesAuth.push(solicitud);
            return {
              data: errorAuth ? { user: null, session: null } : { user: { id: 'usuario-prueba', identities }, session: null },
              error: errorAuth,
            };
          },
        },
      }),
      registrarOrganizacion: async () => {
        llamadasRpc.push(true);
        if (lanzarRpc) throw lanzarRpc;
        return resultadoRpc;
      },
      eliminarUsuarioAuth: async (userId) => {
        eliminaciones.push(userId);
        return { error: null };
      },
    },
  };
}

test('un correo existente produce el mismo siguiente paso público sin revelar si hay una cuenta', async () => {
  const { dependencias, eliminaciones, llamadasRpc } = crearDependencias({ identities: [] });
  const resultado = await registrarEmpresaConDependencias(datosRegistro, dependencias);
  assert.deepEqual(resultado, { siguiente: 'confirmar_o_iniciar_sesion' });
  assert.deepEqual(llamadasRpc, [], 'no crea otra organización para una identidad existente');
  assert.deepEqual(eliminaciones, []);
  const endpoint = await readFile(new URL('../api/cuenta/index.js', import.meta.url), 'utf8');
  assert.match(endpoint, /await registrarEmpresa\(cuerpo\);[\s\S]*?return json\(res, 201, \{ ok: true, siguiente: 'confirmar_o_iniciar_sesion' \}\)/);
  assert.doesNotMatch(endpoint, /registro: registroPublico|sesion_disponible/);
});

test('un duplicado reportado como error por Auth también usa la respuesta genérica y no crea una organización', async () => {
  for (const errorAuth of [
    Object.assign(new Error('User already registered'), { status: 422 }),
    Object.assign(new Error('Email already exists'), { status: 422, code: 'user_already_exists' }),
  ]) {
    const { dependencias, llamadasRpc, eliminaciones } = crearDependencias({ errorAuth });
    assert.deepEqual(await registrarEmpresaConDependencias(datosRegistro, dependencias), { siguiente: 'confirmar_o_iniciar_sesion' });
    assert.deepEqual(llamadasRpc, []);
    assert.deepEqual(eliminaciones, []);
  }
});

const datosRegistro = {
  email: 'tester@empresa.test', password: 'contraseña-segura',
  nombre: 'Tester', empresa: 'Empresa Test', planta: 'Planta Test',
};

test('un rechazo SQL 4xx con SQLSTATE confirma rollback y permite limpiar Auth', async () => {
  const { dependencias, eliminaciones } = crearDependencias({
    resultadoRpc: { data: null, error: { status: 400, code: '22023', message: 'datos inválidos' } },
  });
  await assert.rejects(registrarEmpresaConDependencias(datosRegistro, dependencias), (error) => {
    assert.equal(error.status, 422);
    assert.match(error.message, /solicitud fue rechazada/);
    return true;
  });
  assert.deepEqual(eliminaciones, ['usuario-prueba']);
});

test('un rechazo de integridad SQL 4xx también limpia Auth tras el rollback', async () => {
  const { dependencias, eliminaciones } = crearDependencias({
    resultadoRpc: { data: null, error: { status: 409, code: '23505', message: 'duplicado' } },
  });
  await assert.rejects(registrarEmpresaConDependencias(datosRegistro, dependencias), { status: 422 });
  assert.deepEqual(eliminaciones, ['usuario-prueba']);
});

test('un error SQL 5xx es ambiguo y conserva el usuario Auth', async () => {
  const { dependencias, eliminaciones } = crearDependencias({
    resultadoRpc: { data: null, error: { status: 500, code: 'P0001', message: 'error del servidor' } },
  });
  await assert.rejects(registrarEmpresaConDependencias(datosRegistro, dependencias), (error) => {
    assert.equal(error.status, 503);
    assert.match(error.message, /No vuelvas a registrarte todavía/);
    return true;
  });
  assert.deepEqual(eliminaciones, []);
});

test('timeout/red sin respuesta de RPC conserva el usuario Auth', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { dependencias, eliminaciones } = crearDependencias({
    lanzarRpc: Object.assign(new Error('fetch failed'), { code: 'ECONNRESET' }),
  });
  await assert.rejects(registrarEmpresaConDependencias(datosRegistro, dependencias), { status: 503 });
  assert.deepEqual(eliminaciones, []);
});

test('errores RPC sin SQLSTATE y respuestas incompletas se consideran ambiguos', async () => {
  for (const resultadoRpc of [
    { data: null, error: { status: 400, message: 'respuesta del proxy sin SQLSTATE' } },
    { data: { empresa: { id: 'empresa' }, planta: null }, error: null },
    undefined,
  ]) {
    const { dependencias, eliminaciones } = crearDependencias({ resultadoRpc });
    await assert.rejects(registrarEmpresaConDependencias(datosRegistro, dependencias), { status: 503 });
    assert.deepEqual(eliminaciones, []);
  }
});

test('registro confirmado devuelve el resultado y no elimina al usuario Auth', async () => {
  const { dependencias, eliminaciones, solicitudesAuth } = crearDependencias({ resultadoRpc: {
    data: {
      empresa: { id: 'empresa-1' }, planta: { id: 'planta-1' },
      usuario: { id: 'usuario-prueba', rol: 'direccion' },
    },
    error: null,
  } });
  const resultado = await registrarEmpresaConDependencias(datosRegistro, dependencias);
  assert.equal(resultado.empresa.id, 'empresa-1');
  assert.equal(resultado.usuario.email, 'tester@empresa.test');
  assert.equal(resultado.requiere_confirmacion, true);
  assert.deepEqual(solicitudesAuth[0].options.data.downtimeos_registro, {
    version: 1, empresa: 'Empresa Test', planta: 'Planta Test', nombre: 'Tester',
  });
  assert.deepEqual(eliminaciones, []);
});

test('si falla la limpieza tras rechazo SQL, avisa que no se reintente', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { dependencias } = crearDependencias({
    resultadoRpc: { data: null, error: { status: 400, code: '22023', message: 'datos inválidos' } },
  });
  dependencias.eliminarUsuarioAuth = async () => ({ error: new Error('Auth no disponible') });
  await assert.rejects(registrarEmpresaConDependencias(datosRegistro, dependencias), (error) => {
    assert.equal(error.status, 503);
    assert.match(error.message, /no pudimos limpiar la cuenta/);
    return true;
  });
});
