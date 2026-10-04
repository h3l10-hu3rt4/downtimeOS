import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { reanudarRegistroPendienteConDependencias, resolverPerfilConReanudacion } from '../lib/cuenta.js';

const migration = await readFile(new URL('../supabase/migrations/20261003001400_retomar_registro_pendiente.sql', import.meta.url), 'utf8');
const usuario = {
  id: '11111111-1111-4111-8111-111111111111',
  user_metadata: { downtimeos_registro: { version: 1, empresa: 'Empresa Demo', planta: 'Planta Norte', nombre: 'Ana Tester' } },
};

test('el reintento de registro envía al RPC idempotente solo los datos del usuario Auth autenticado', async () => {
  let argumentos;
  const resultado = await reanudarRegistroPendienteConDependencias(usuario, {
    async registrar(valor) {
      argumentos = valor;
      return { data: { empresa: { id: 'org-1' }, planta: { id: 'planta-1' } }, error: null };
    },
  });
  assert.equal(resultado, true);
  assert.deepEqual(argumentos, {
    p_usuario_id: usuario.id,
    p_empresa: 'Empresa Demo',
    p_planta: 'Planta Norte',
    p_nombre: 'Ana Tester',
  });
});

test('no intenta crear empresa para usuarios Auth que no proceden del registro del producto', async () => {
  let llamadas = 0;
  assert.equal(await reanudarRegistroPendienteConDependencias({ id: usuario.id, user_metadata: {} }, {
    async registrar() { llamadas += 1; },
  }), false);
  assert.equal(llamadas, 0);
});

test('solo recupera la ausencia de membresía y luego vuelve a cargar el perfil', async () => {
  let intentos = 0;
  let reanudaciones = 0;
  const perfil = { perfil: { rol: 'direccion' }, plantas_disponibles: [{ planta_id: 'planta-1' }] };
  const resultado = await resolverPerfilConReanudacion(usuario, null, {
    async resolver() {
      intentos += 1;
      if (intentos === 1) throw Object.assign(new Error('Tu usuario no tiene una planta asignada.'), { status: 403 });
      return perfil;
    },
    async reanudar(authUser) { reanudaciones += 1; assert.equal(authUser.id, usuario.id); return true; },
  });
  assert.equal(resultado, perfil);
  assert.equal(intentos, 2);
  assert.equal(reanudaciones, 1);
});

test('no usa la recuperación automática para acceso a una planta solicitada que no existe', async () => {
  let reanudaciones = 0;
  const error = Object.assign(new Error('No tienes acceso a esa planta.'), { status: 403 });
  await assert.rejects(resolverPerfilConReanudacion(usuario, 'planta-ajena', {
    async resolver() { throw error; },
    async reanudar() { reanudaciones += 1; return true; },
  }), error);
  assert.equal(reanudaciones, 0);
});

test('la RPC de reanudación serializa los reintentos, reutiliza el alta completa y solo admite service_role', () => {
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\(p_usuario_id::text,0\)\)/);
  assert.match(migration, /return public\.organizacion_registrar_empresa\(p_usuario_id,p_empresa,p_planta,p_nombre\)/);
  assert.match(migration, /from public\.organizaciones o[\s\S]*join public\.planta_membresias m[\s\S]*m\.activo/);
  assert.match(migration, /revoke all on function public\.organizacion_reanudar_registro_empresa\(uuid,text,text,text\)[\s\S]*from public,anon,authenticated/);
  assert.match(migration, /grant execute on function public\.organizacion_reanudar_registro_empresa\(uuid,text,text,text\)[\s\S]*to service_role/);
});
