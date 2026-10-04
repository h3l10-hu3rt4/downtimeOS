import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const api = await readFile(new URL('../api/planta/estados.js', import.meta.url), 'utf8');
const migracion = await readFile(new URL('../supabase/migrations/20261002000900_privilegios_rpc_paros.sql', import.meta.url), 'utf8');
const migracionLegacy = await readFile(new URL('../supabase/migrations/20261003000000_drop_legacy_report_rpc.sql', import.meta.url), 'utf8');
const orden = await readFile(new URL('../supabase/ORDEN-DE-EJECUCION.md', import.meta.url), 'utf8');
const migraciones = (await readdir(new URL('../supabase/migrations/', import.meta.url)))
  .filter((archivo) => archivo.endsWith('.sql'))
  .sort();
const datosLegacy = await readFile(new URL('../public/demo/js/datos.js', import.meta.url), 'utf8');

test('el endpoint legado no permite mutar estado fuera de los flujos atómicos', () => {
  assert.doesNotMatch(api, /cambiarEstado\(/);
  assert.match(api, /return json\(res, 409,[\s\S]*?El estado no se puede cambiar directamente/);
  assert.match(api, /flujo de reporte o cierre de paro/);
});

test('el repositorio no conserva helpers sin uso para cambiar o borrar estado sin auditoría', async () => {
  const planta = await readFile(new URL('../lib/planta.js', import.meta.url), 'utf8');
  assert.doesNotMatch(planta, /export async function cambiarEstado\(/);
  assert.doesNotMatch(planta, /export async function cerrarSolicitudesDe\(/);
  assert.doesNotMatch(planta, /export async function eliminarSolicitud\(/);
});

test('el cliente legacy reserva las mutaciones en nube para operaciones confirmadas', () => {
  assert.doesNotMatch(datosLegacy, /enviar\("\/estados"/);
  assert.match(datosLegacy, /function cambiarEstado\(idActivo, nuevoEstado, causaId, opciones\) \{\s*if \(nube && modoActual === "nube"\)/);
  for (const mutador of ['cambiarEstado', 'resolverSolicitud', 'descartarSolicitud', 'cambiarCausaSolicitud', 'cerrarSolicitud', 'eliminarSolicitud']) {
    assert.doesNotMatch(datosLegacy, new RegExp(`\\b${mutador}:\\s*${mutador}\\b`));
  }
  assert.match(datosLegacy, /resolverSolicitudConfirmada:\s*resolverSolicitudConfirmada/);
  assert.match(datosLegacy, /descartarSolicitudConfirmada:\s*descartarSolicitudConfirmada/);
});

test('el tablero redirige sesión vencida y onboarding incompleto en vez de degradarse silenciosamente', async () => {
  assert.match(datosLegacy, /function errorApi\(respuesta, mensaje\)/);
  assert.match(datosLegacy, /e\.status === 401[\s\S]*?location\.replace\("\/acceso\?returnTo=" \+ encodeURIComponent\(retorno\)\)/);
  assert.match(datosLegacy, /e\.codigo === "ONBOARDING_INCOMPLETO"[\s\S]*?location\.replace\("\/configurar-planta"\)/);
  assert.match(datosLegacy, /e\.status === 402[\s\S]*?modoActual = "plan"/);
  assert.match(datosLegacy, /return errorApi\(r\)/);
  const sesion = await readFile(new URL('../public/demo/js/sesion.js', import.meta.url), 'utf8');
  assert.match(sesion, /modo === "plan"[\s\S]*?Suscripción requerida/);
});

test('la firma heredada de reporte de paro deja de ser ejecutable por roles públicos', () => {
  assert.match(migracion, /to_regprocedure\('public\.planta_reportar_paro\(text,text,text,timestamptz,text\)'\)/);
  assert.match(migracion, /revoke all on function public\.planta_reportar_paro\(text,text,text,timestamptz,text\) from public, anon, authenticated/i);
  assert.match(migracion, /grant execute on function public\.planta_reportar_paro\(text,text,text,timestamptz,text\) to service_role/i);
  assert.ok(
    migraciones.indexOf('20261002000900_privilegios_rpc_paros.sql') < migraciones.indexOf('20261003000000_drop_legacy_report_rpc.sql'),
    'se revocan los privilegios antes de retirar la función antigua',
  );
  assert.match(migracionLegacy, /drop function if exists public\.planta_reportar_paro\(text,text,text,timestamptz,text\)/i);
  assert.match(orden, /supabase\/migrations[\s\S]*Supabase[\s\S]*CLI/);
});
