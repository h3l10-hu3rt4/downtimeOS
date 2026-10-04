import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const leer = (ruta) => readFile(new URL(`../${ruta}`, import.meta.url), 'utf8');

test('STOP y solicitud aprobada de Mantenimiento nacen en una transacción del servidor', async () => {
  const planta = await leer('lib/planta.js');
  const sql = await leer('supabase/migrations/20261002000600_cierre_paro_atomico.sql');
  const api = await leer('api/planta/reportes.js');
  const apiSolicitudes = await leer('api/planta/solicitudes.js');
  assert.match(api, /cuerpo\.accion === 'mantenimiento'[\s\S]*?reportarParoMantenimiento/);
  assert.match(planta, /rpc\('planta_reportar_paro_mantenimiento'/);
  assert.match(sql, /insert into public\.planta_estados[\s\S]*?insert into public\.planta_solicitudes/);
  assert.match(sql, /'aprobada'/);
  assert.match(sql, /grant execute on function public\.planta_reportar_paro_mantenimiento/);
  assert.match(apiSolicitudes, /const reporte = await reportarParo\([\s\S]*?reportado_por_user_id: sesion\.user\.id/);
  assert.doesNotMatch(await leer('lib/planta.js'), /export async function crearSolicitud\(/);
  assert.match(sql, /planta_descartar_solicitud[\s\S]*?mismo lock de activo[\s\S]*?for update/);
  assert.match(sql, /update public\.planta_estados set estado='RUN'[\s\S]*?update public\.planta_solicitudes set cerrada=true/);
});

test('descartar un reporte lo deshace: la máquina vuelve a RUN sin registrar paro', async () => {
  const datos = await leer('public/demo/js/datos.js');
  const operaciones = await leer('public/demo/js/operaciones.js');
  assert.match(operaciones, /D\.descartarSolicitudConfirmada\(s\.id\)\.then/);
  assert.match(datos, /function descartarSolicitudConfirmada\(id\)[\s\S]*?accion: "descartar"/);
  assert.match(operaciones, /No se pudo descartar el reporte/);
  const cuerpo = datos.slice(datos.indexOf('function descartarSolicitud(id)'), datos.indexOf('function cambiarCausaSolicitud(id'));
  assert.match(cuerpo, /s\.estado = "rechazada"/);
  assert.match(cuerpo, /estado: "RUN"/);
  assert.match(cuerpo, /o\.cerrada = true/);
  // El modo local mantiene la misma regla; el modo nube espera respuesta confirmada.
  assert.match(datos, /function descartarSolicitudConfirmada[\s\S]*?accion: "descartar"/);
  assert.doesNotMatch(cuerpo, /registrar\(/);
});

test('solo el panel de Mantenimiento se salta la bandeja; el operador sigue pendiente', async () => {
  const operaciones = await leer('public/demo/js/operaciones.js');
  const operador = await leer('public/demo/js/operador.js');
  const datos = await leer('public/demo/js/datos.js');
  assert.match(operaciones, /D\.reportarParoMantenimiento\(\{ activo: idActivo, causa: causaId, registradoPor: cuenta\.nombre \}\)\.then/);
  assert.match(operaciones, /No se registró el paro/);
  assert.doesNotMatch(operador, /validadaPor/);
  assert.match(datos, /estado: datos\.validadaPor \? "aprobada" : "pendiente"/);
  assert.match(datos, /validada_por: datos\.validadaPor \|\| null/);
});

test('resolver solicitudes toma la identidad auditada de la sesión y no del cuerpo', async () => {
  const api = await leer('api/planta/solicitudes.js');
  const resolver = api.slice(api.indexOf("if (accion === 'resolver')"));
  assert.match(resolver, /por: sesion\.perfil\.nombre \|\| sesion\.user\.email \|\| ''/);
  assert.doesNotMatch(resolver, /por:\s*cuerpo\.por/);
});

test('reclasificar solo permite solicitudes pendientes y abiertas', async () => {
  const planta = await leer('lib/planta.js');
  const migracion = await leer('supabase/migrations/20261003001100_endurecer_reclasificacion_solicitud.sql');
  const reclasificar = planta.slice(planta.indexOf('export async function reclasificarSolicitud'), planta.indexOf('/* -------------------------------------------------------------- auxiliares */'));
  assert.match(reclasificar, /rpc\('planta_reclasificar_solicitud'/);
  assert.match(migracion, /v_solicitud\.estado <> 'pendiente' or v_solicitud\.cerrada/);
  assert.match(migracion, /ya fue resuelta o cerrada/);
});

test('cerrar desde solicitudes entrega la sesión completa que exige la transacción auditada', async () => {
  const api = await leer('api/planta/solicitudes.js');
  const cierre = api.slice(api.indexOf("if (accion === 'cerrar')"), api.indexOf("const folio = req.query?.folio", api.indexOf("if (accion === 'cerrar')")));
  assert.match(cierre, /cerrarParoReportado\([\s\S]*?plantaId,[\s\S]*?organizacionId: sesion\.perfil\.organizacion_id,[\s\S]*?usuarioId: sesion\.user\.id/);
});

test('alta manual de eventos fija procedencia y autor desde el rol y la sesión', async () => {
  const api = await leer('api/planta/eventos.js');
  const alta = api.slice(api.indexOf("if (req.method === 'POST')"), api.indexOf('const folio = req.query?.folio'));
  assert.match(alta, /origen: sesion\.perfil\.rol === 'operador' \? 'piso' : 'mantenimiento'/);
  assert.match(alta, /registrado_por: sesion\.perfil\.nombre \|\| sesion\.user\.email \|\| ''/);
  assert.doesNotMatch(alta, /origen:\s*cuerpo\.|registrado_por:\s*cuerpo\./);
});

test('cancelar eventos toma la identidad auditada de la sesión y conserva el motivo del cuerpo', async () => {
  const api = await leer('api/planta/eventos.js');
  const cancelar = api.slice(api.indexOf('// DELETE:'));
  assert.match(cancelar, /motivo = cuerpo\.motivo \?\? ''/);
  assert.match(cancelar, /por: sesion\.perfil\.nombre \|\| sesion\.user\.email \|\| ''/);
  assert.doesNotMatch(cancelar, /cuerpo\.por/);
});
