import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { puedeLeerFacturacion, puedeEditarFacturacion } from '../lib/permisos-facturacion.js';

const api = await readFile(new URL('../api/planta/suscripcion.js', import.meta.url), 'utf8');
const rpcEquipo = await readFile(new URL('../supabase/migrations/20261003000700_proteger_roles_rpc.sql', import.meta.url), 'utf8');

test('el propietario siempre puede leer y editar facturación', () => {
  const perfil = { es_propietario_cuenta: true };
  assert.equal(puedeLeerFacturacion(perfil), true);
  assert.equal(puedeEditarFacturacion(perfil), true);
});

test('la administración delegada no implica permiso de facturación', () => {
  const perfil = { es_admin_cuenta: true, puede_administrar_facturacion: false };
  assert.equal(puedeLeerFacturacion(perfil), false);
  assert.equal(puedeEditarFacturacion(perfil), false);
});

test('Finanzas solo puede leer y editar facturación cuando tiene el permiso explícito', () => {
  assert.equal(puedeLeerFacturacion({ rol: 'finanzas' }), false);
  assert.equal(puedeEditarFacturacion({ rol: 'finanzas' }), false);
  const autorizado = { rol: 'finanzas', puede_administrar_facturacion: true };
  assert.equal(puedeLeerFacturacion(autorizado), true);
  assert.equal(puedeEditarFacturacion(autorizado), true);
});

test('la API usa permisos separados para consultar y mutar el flujo de suscripción', () => {
  assert.match(api, /puedeLeerFacturacion\(sesion\.perfil\)/);
  assert.match(api, /puedeEditarFacturacion\(sesion\.perfil\)/);
  assert.match(api, /Pide al titular de la cuenta que te otorgue el permiso de facturación/);
});

test('la RPC del equipo también reserva Finanzas y facturación al titular', () => {
  assert.match(rpcEquipo, /p_actor_id is distinct from v_propietario and \(p_rol = 'finanzas' or coalesce\(p_facturacion,false\)\)/);
  assert.match(rpcEquipo, /revoke all on function public\.planta_admin_cambiar_miembro[\s\S]*?from public,anon,authenticated/i);
  assert.match(rpcEquipo, /grant execute on function public\.planta_admin_cambiar_miembro[\s\S]*?to service_role/i);
});
