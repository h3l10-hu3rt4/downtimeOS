import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

process.env.SUPABASE_URL ??= 'https://unit-test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'unit-test-only';

const { supabase } = await import('../lib/supabase.js');
const { exigirAdministracionEquipo, permisosAdministracionCuenta } = await import('../lib/cuenta.js');
const MIGRACION = new URL('../supabase/migrations/20261002000000_delegacion.sql', import.meta.url);
const API = new URL('../api/planta/equipo.js', import.meta.url);
const UI = new URL('../app/equipo/page.js', import.meta.url);

const OWNER = '11111111-1111-4111-8111-111111111111';
const DELEGATE = '22222222-2222-4222-8222-222222222222';
const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let delegados;

function stubCuenta({ titular = OWNER } = {}) {
  supabase.from = (table) => {
    const filters = [];
    const q = {
      select() { return q; },
      eq(key, value) { filters.push([key, value]); return q; },
      maybeSingle: async () => {
        if (table === 'organizaciones') {
          return { data: filters.some(([key, value]) => key === 'id' && value === ORG) ? { propietario_id: titular } : null, error: null };
        }
        if (table === 'organizacion_admin_delegados') {
          const row = delegados.find((d) => filters.every(([key, value]) => d[key] === value));
          return { data: row || null, error: null };
        }
        throw new Error(`Tabla inesperada en test: ${table}`);
      },
    };
    return q;
  };
}

beforeEach(() => {
  delegados = [{ organizacion_id: ORG, user_id: DELEGATE }];
  stubCuenta();
});

const sesion = (userId, perfil = {}) => ({
  user: { id: userId },
  perfil: { organizacion_id: ORG, es_admin_cuenta: false, ...perfil },
});

test('la titularidad autoriza siempre aunque la bandera de administrador de membresía sea falsa', async () => {
  const permisos = await permisosAdministracionCuenta(sesion(OWNER));
  assert.deepEqual(permisos, { es_propietario: true, es_admin_cuenta: true });
  assert.deepEqual(await exigirAdministracionEquipo(sesion(OWNER)), permisos);
});

test('la delegación canónica autoriza al delegado, aunque el flag legado de la sesión venga falso', async () => {
  const permisos = await permisosAdministracionCuenta(sesion(DELEGATE));
  assert.deepEqual(permisos, { es_propietario: false, es_admin_cuenta: true });
  assert.deepEqual(await exigirAdministracionEquipo(sesion(DELEGATE)), permisos);
});

test('no confía en es_admin_cuenta del cliente si no existe delegación vigente en la organización', async () => {
  delegados = [];
  const forged = sesion('33333333-3333-4333-8333-333333333333', { es_admin_cuenta: true, es_propietario_cuenta: true });
  const permisos = await permisosAdministracionCuenta(forged);
  assert.deepEqual(permisos, { es_propietario: false, es_admin_cuenta: false });
  await assert.rejects(exigirAdministracionEquipo(forged), { status: 403 });
});

test('la UI solo ofrece delegación al titular; servidor y RPC exigen autoridad y protegen titular/delegados', async () => {
  const [sql, api, ui] = await Promise.all([
    readFile(MIGRACION, 'utf8'), readFile(API, 'utf8'), readFile(UI, 'utf8'),
  ]);
  assert.match(sql, /create table if not exists public\.organizacion_admin_delegados/);
  assert.match(sql, /if v_propietario is distinct from p_actor_id[\s\S]*?using errcode='42501'/i);
  assert.match(sql, /i\.es_admin_cuenta and i\.invitada_por is distinct from v_propietario/i);
  assert.match(sql, /insert into public\.organizacion_admin_delegados\(organizacion_id,user_id,concedido_por,concedido_en\)/i);
  assert.match(sql, /update public\.planta_membresias set es_admin_cuenta=true[\s\S]*?where organizacion_id=i\.organizacion_id and user_id=i\.auth_user_id/i);
  assert.match(sql, /p_actor_id is distinct from v_propietario and \(v_objetivo_admin or i\.es_admin_cuenta\)/i);
  assert.match(sql, /revoke all on function public\.planta_admin_delegar_cuenta[\s\S]*?grant execute[\s\S]*?to service_role/i);
  assert.match(api, /await exigirAdministracionEquipo\(sesion\)/);
  assert.match(api, /\['direccion', 'finanzas'\]\.includes\(cuerpo\.rol\)[\s\S]*?&& !esTitular/);
  assert.match(api, /supabase\.rpc\('planta_admin_delegar_cuenta'/);
  assert.match(api, /Solo el titular puede conceder o revocar administración delegada/);
  assert.match(ui, /permisos\.es_propietario \? <label/);
  assert.match(ui, /delegar_admin/);
  assert.match(ui, /revocar_delegacion/);
});

test('solo la persona titular puede invitar o promover miembros a Dirección o Finanzas', async () => {
  const [sql, api, cuenta, ui] = await Promise.all([
    readFile(new URL('../supabase/migrations/20261003000900_titular_asigna_direccion.sql', import.meta.url), 'utf8'),
    readFile(API, 'utf8'),
    readFile(new URL('../lib/cuenta.js', import.meta.url), 'utf8'),
    readFile(UI, 'utf8'),
  ]);
  assert.match(sql, /p_rol in \('direccion','finanzas'\)/);
  assert.match(api, /\['direccion', 'finanzas'\]\.includes\(cuerpo\.rol\)[\s\S]*?!esTitular/);
  assert.match(cuenta, /rol === 'direccion' \|\| rol === 'finanzas'[\s\S]*?!permisosCuenta\.es_propietario/);
  assert.match(ui, /permisos\.es_propietario \? <option value="direccion">Dirección<\/option>/);
});
