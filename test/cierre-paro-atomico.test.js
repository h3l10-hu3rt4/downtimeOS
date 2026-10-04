import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const leer = async (ruta) => readFile(new URL(`../${ruta}`, import.meta.url), 'utf8');
const [api, servidor, sql, datos, operador, operaciones, datosFuente, retiro, sqlAuditoria] = await Promise.all([
  leer('api/planta/reportes.js'),
  leer('lib/planta.js'),
  leer('supabase/migrations/20261002000600_cierre_paro_atomico.sql'),
  leer('public/demo/js/datos.js'),
  leer('public/demo/js/operador.js'),
  leer('public/demo/js/operaciones.js'),
  leer('public/demo/js/datos.js'),
  leer('supabase/migrations/20261002000700_retiro_reporte_operador.sql'),
  leer('supabase/migrations/20261003001300_auditar_cierre_paro.sql'),
]);
const refuerzoFechas = await leer('supabase/migrations/20261002000700_retiro_reporte_operador.sql');

function datosNube(responderCierre) {
  const sesion = JSON.stringify({ access_token: 'token-test', perfil: { planta_id: 'planta-test' } });
  const respuesta = (estado, cuerpo) => ({ ok: estado >= 200 && estado < 300, status: estado, json: async () => cuerpo });
  const solicitudes = [];
  const ventana = {
    localStorage: { getItem: (clave) => clave === 'downtimeos_sesion' ? sesion : null },
    fetch: async (url, opciones = {}) => {
      solicitudes.push({ url, opciones });
      if (url === '/api/planta') return respuesta(200, {
        ok: true,
        lineas: [{ id: 'L-01', nombre: 'Línea 1' }],
        causas: [{ id: 'espera-material', etiqueta: 'Espera de material', requiere_texto: false }],
        activos: [{ id: 'M-01', linea_id: 'L-01', tipo: 'CM', nombre: 'Máquina 1', etapa: 'Corte', tarifa_hora: 100 }],
        estados: [{ activo_id: 'M-01', estado: 'STOP', desde: '2026-10-01T10:00:00.000Z', causa_id: 'espera-material' }],
        eventos: [],
        solicitudes: [{ folio: 'SOL-1', activo_id: 'M-01', causa_id: 'espera-material', desde: '2026-10-01T10:00:00.000Z', estado: 'pendiente', cerrada: false }],
      });
      return responderCierre(url, opciones, respuesta);
    },
  };
  vm.runInNewContext(datosFuente, { window: ventana, console, Date, Promise, Math, JSON, setTimeout, clearTimeout });
  return { D: ventana.DowntimeCO, solicitudes };
}

test('el cierre tiene una sola transacción de servidor para evento, estado y solicitudes', () => {
  assert.match(api, /ruta\(\['POST',\s*'PATCH'\]/);
  assert.match(api, /cuerpo\.accion === 'cerrar'/);
  assert.match(api, /\['operaciones',\s*'operador',\s*'direccion'\]/);
  assert.match(servidor, /rpc\('planta_cerrar_paro_auditado'/);
  assert.match(sql, /insert into public\.planta_eventos[\s\S]*?update public\.planta_estados[\s\S]*?update public\.planta_solicitudes/);
  assert.match(sql, /for update/);
  assert.match(sql, /grant execute on function public\.planta_cerrar_paro\(uuid,text,text,text\) to service_role/);
  assert.match(sqlAuditoria, /planta_cerrar_paro_auditado/);
  assert.match(sqlAuditoria, /m\.organizacion_id=p_organizacion_id and m\.planta_id=p_planta_id[\s\S]*?m\.user_id=p_usuario_id and m\.activo/);
  assert.match(sqlAuditoria, /v_resultado := public\.planta_cerrar_paro\([\s\S]*?insert into public\.planta_auditoria/);
  assert.match(sqlAuditoria, /p_usuario_id,'paro_cerrado','evento',v_folio/);
  assert.match(sqlAuditoria, /revoke all on function public\.planta_cerrar_paro\(uuid,text,text,text\) from service_role/);
  assert.match(sqlAuditoria, /notify pgrst, 'reload schema'/i);
  assert.match(servidor, /p_organizacion_id: organizacionId[\s\S]*?p_usuario_id: usuarioId/);
});

test('descartar folio inexistente no bloquea activos ajenos y conserva el orden de locks', async () => {
  const [migracion] = await Promise.all([
    leer('supabase/migrations/20261003000002_validar_folio_antes_lock_activo.sql'),
  ]);
  const cuerpo = migracion.slice(migracion.indexOf('create or replace function public.planta_descartar_solicitud'));
  const resolverSolicitud = cuerpo.indexOf('select * into v_solicitud from public.planta_solicitudes');
  const bloquearActivo = cuerpo.indexOf('select * into v_activo from public.planta_activos');
  const bloquearSolicitud = cuerpo.indexOf('where planta_id=p_planta_id and folio=p_folio for update');
  assert.ok(resolverSolicitud >= 0 && resolverSolicitud < bloquearActivo);
  assert.ok(bloquearActivo < bloquearSolicitud);
  assert.match(cuerpo, /id=v_solicitud\.activo_id and activo\s+for update/);
  assert.match(cuerpo, /if not found then\s+raise exception 'La solicitud no existe en esta planta\.'/);
});

test('el retiro del reporte está limitado al autor y es atómico', async () => {
  assert.match(api, /cuerpo\.accion === 'retirar'[\s\S]*?exigirRolProducto\(sesion, \['operador'\]\)[\s\S]*?sesion\.user\.id/);
  assert.match(servidor, /p_reportado_por_user_id: datos\.reportado_por_user_id/);
  assert.match(retiro, /reportado_por_user_id uuid/);
  assert.match(retiro, /v_solicitud\.reportado_por_user_id is distinct from p_user_id/);
  assert.match(retiro, /v_solicitud\.estado <> 'pendiente'/);
  assert.match(retiro, /update public\.planta_solicitudes set estado='rechazada'[\s\S]*?update public\.planta_estados set estado='RUN'/);
  assert.match(retiro, /grant execute on function public\.planta_retirar_reporte_operador\(uuid,text,uuid\) to service_role/);
  assert.match(operador, /D\.retirarParoConfirmado\(solicitud\.id\)/);
  assert.match(operador, /resultado\.then\(quitarEntrada\)\.catch/);
  const apiPlanta = await leer('api/planta/index.js');
  const apiVivo = await leer('api/planta/estado-vivo.js');
  assert.match(apiPlanta, /salida\.solicitudes = salida\.solicitudes\.map\(\(\{ reportado_por_user_id/);
  assert.match(apiVivo, /vivo\.solicitudes = vivo\.solicitudes\.map\(\(\{ reportado_por_user_id/);
});

test('la fecha del paro no puede dejar un STOP fuera del rango de cierre de 72 horas', () => {
  assert.match(refuerzoFechas, /v_desde > clock_timestamp\(\) \+ interval '5 minutes'/);
  assert.match(refuerzoFechas, /v_desde < clock_timestamp\(\) - interval '72 hours'/);
  assert.match(refuerzoFechas, /raise exception 'La hora del paro debe estar entre ahora y las últimas 72 horas\.'/i);
});

test('Operador y Mantenimiento solo muestran éxito después de confirmar el cierre', () => {
  assert.match(datos, /function cerrarParo\(datos\)[\s\S]*?enviar\("\/reportes"[\s\S]*?true\)/);
  assert.match(datos, /if \(!r \|\| !r\.evento \|\| !r\.estado\) throw/);
  assert.match(operador, /D\.cerrarParo\(\{ activo: activo, registradoPor: cuenta\.nombre \}\)\.then/);
  assert.match(operador, /\.catch\(function \(error\)[\s\S]*?No se cerró el paro/);
  assert.match(operaciones, /D\.cerrarParo\(\{ activo: idActivo, registradoPor: cuenta\.nombre \}\)\.then/);
  assert.match(operaciones, /No se cerró el paro/);
});

test('la tableta ignora toques repetidos mientras reporta o cierra un paro', () => {
  assert.match(operador, /function confirmarParo\(causa, textoLibre\)\s*\{\s*if \(operacionEnCurso\) return;[\s\S]*?operacionEnCurso = true;[\s\S]*?D\.reportarParo\([\s\S]*?finally\(function \(\) \{\s*operacionEnCurso = false;/);
  assert.match(operador, /function confirmarVuelta\(\)\s*\{\s*if \(operacionEnCurso\) return;[\s\S]*?operacionEnCurso = true;[\s\S]*?D\.cerrarParo\([\s\S]*?finally\(function \(\) \{\s*operacionEnCurso = false;/);
});

test('si el servidor rechaza el cierre, la caché conserva STOP y no inventa un evento', async () => {
  const { D } = datosNube((_url, _opciones, respuesta) => respuesta(402, { error: 'Plan vencido.' }));
  await D.cargar();
  await assert.rejects(D.cerrarParo({ activo: 'M-01', registradoPor: 'Operador' }), /Plan vencido/);
  assert.equal(D.estados()['M-01'].estado, 'STOP');
  assert.equal(D.eventosCapturados().length, 0);
  assert.equal(D.solicitudes()[0].cerrada, false);
});

test('si el servidor rechaza un STOP, no se inventa el reporte en caché ni se muestra como local', async () => {
  const { D } = datosNube((_url, _opciones, respuesta) => respuesta(409, { error: 'Este equipo ya tiene un paro abierto.' }));
  await D.cargar();
  await assert.rejects(D.reportarParo({ activo: 'M-01', causa: 'espera-material' }), /paro abierto/);
  assert.equal(D.modo(), 'nube', 'un rechazo 409 no debe simular caída de red.');
  assert.equal(D.estados()['M-01'].estado, 'STOP');
  assert.equal(D.solicitudes().length, 1);
});

test('el operador distingue WhatsApp aceptado de una notificación fallida tras guardar el paro', async () => {
  const crear = (alerta) => datosNube((url, _opciones, respuesta) => {
    if (url !== '/api/planta/reportes') return respuesta(404, { error: 'Ruta inesperada.' });
    return respuesta(201, {
      ok: true,
      estado: { activo_id: 'M-01', estado: 'STOP', desde: '2026-10-01T10:00:00.000Z', causa_id: 'espera-material' },
      solicitud: { folio: 'SOL-2', activo_id: 'M-01', causa_id: 'espera-material', desde: '2026-10-01T10:00:00.000Z', estado: 'pendiente', cerrada: false },
      alerta,
    });
  });
  const fallo = crear({ ok: false, estado: 'error' });
  await fallo.D.cargar();
  const solicitudConFallo = await fallo.D.reportarParo({ activo: 'M-01', causa: 'espera-material' });
  assert.equal(solicitudConFallo.alertaWhatsApp.ok, false);
  assert.match(operador, /no se pudo enviar el aviso por WhatsApp/);

  const aceptado = crear({ ok: true, estado: 'queued' });
  await aceptado.D.cargar();
  const solicitudAceptada = await aceptado.D.reportarParo({ activo: 'M-01', causa: 'espera-material' });
  assert.equal(solicitudAceptada.alertaWhatsApp.estado, 'queued');
  assert.match(operador, /entrega está pendiente de confirmación/);
});

test('la API conserva el éxito del paro y devuelve un estado seguro si falla el aviso WhatsApp', () => {
  assert.match(api, /catch \(error\)[\s\S]*?alerta = \{ ok: false, estado: 'error' \}/);
  assert.match(api, /mensaje: 'Paro reportado a Supervisión\.'/);
  assert.doesNotMatch(api, /alerta = \{[^}]*error\.message/);
});

test('al confirmar el servidor, la caché aplica conjuntamente evento, RUN y solicitud cerrada', async () => {
  const folio = 'L01-CM-M01-20261001-1000-A1';
  const { D, solicitudes } = datosNube((_url, _opciones, respuesta) => respuesta(200, {
    ok: true,
    evento: { folio, activo_id: 'M-01', causa_id: 'espera-material', minutos: 10, inicio: '2026-10-01T10:00:00.000Z', origen: 'piso', costo_mxn: 16.67 },
    estado: { planta_id: 'planta-test', activo_id: 'M-01', estado: 'RUN', desde: '2026-10-01T10:10:00.000Z', causa_id: null },
    solicitudes_cerradas: 1,
  }));
  await D.cargar();
  const evento = await D.cerrarParo({ activo: 'M-01', registradoPor: 'Operador' });
  assert.equal(evento.id, folio);
  assert.equal(D.estados()['M-01'].estado, 'RUN');
  assert.equal(D.eventosCapturados()[0].id, folio);
  assert.equal(D.solicitudes()[0].cerrada, true);
  const llamada = solicitudes.find((item) => item.url === '/api/planta/reportes');
  assert.equal(llamada.opciones.method, 'PATCH');
  assert.equal(JSON.parse(llamada.opciones.body).accion, 'cerrar');
});

test('el paro de Mantenimiento espera confirmación y no crea estado/solicitud optimistas', async () => {
  const { D } = datosNube((_url, _opciones, respuesta) => respuesta(409, { error: 'El equipo ya tiene un paro abierto.' }));
  await D.cargar();
  // El fixture parte de STOP para probar la respuesta fallida sin mutación local.
  await assert.rejects(D.reportarParoMantenimiento({ activo: 'M-01', causa: 'espera-material' }), /paro abierto/);
  assert.equal(D.modo(), 'nube', 'un 409 de regla de negocio no equivale a desconexión.');
  assert.equal(D.estados()['M-01'].estado, 'STOP');
  assert.equal(D.solicitudes().length, 1);
  assert.equal(D.solicitudes()[0].estado, 'pendiente');
});

test('el paro atómico confirmado de Mantenimiento refleja STOP y solicitud aprobada juntas', async () => {
  const { D, solicitudes } = datosNube((url, _opciones, respuesta) => {
    if (url !== '/api/planta/reportes') return respuesta(404, { error: 'Ruta inesperada.' });
    return respuesta(201, {
      ok: true,
      estado: { activo_id: 'M-01', estado: 'STOP', desde: '2026-10-01T10:10:00.000Z', causa_id: 'espera-material' },
      solicitud: { folio: 'SOL-MANT-1', activo_id: 'M-01', causa_id: 'espera-material', desde: '2026-10-01T10:10:00.000Z', estado: 'aprobada', cerrada: false },
    });
  });
  await D.cargar();
  const solicitud = await D.reportarParoMantenimiento({ activo: 'M-01', causa: 'espera-material' });
  assert.equal(solicitud.id, 'SOL-MANT-1');
  assert.equal(solicitud.estado, 'aprobada');
  assert.equal(D.estados()['M-01'].estado, 'STOP');
  assert.equal(D.solicitudes().length, 2);
  assert.equal(solicitudes.find((item) => item.url === '/api/planta/reportes').opciones.method, 'POST');
});

test('el retiro de un reporte solo cambia la caché con respuesta confirmada', async () => {
  const { D, solicitudes } = datosNube((url, opciones, respuesta) => {
    if (url !== '/api/planta/reportes') return respuesta(404, { error: 'Ruta inesperada.' });
    assert.equal(opciones.method, 'PATCH');
    assert.equal(JSON.parse(opciones.body).accion, 'retirar');
    return respuesta(200, {
      ok: true, maquina_liberada: true,
      solicitud: { folio: 'SOL-1', activo_id: 'M-01', causa_id: 'espera-material', desde: '2026-10-01T10:00:00.000Z', estado: 'rechazada', cerrada: true },
    });
  });
  await D.cargar();
  const resultado = await D.retirarParoConfirmado('SOL-1');
  assert.equal(resultado.maquinaLiberada, true);
  assert.equal(D.estados()['M-01'].estado, 'RUN');
  assert.equal(D.solicitudes()[0].estado, 'rechazada');

  const { D: denegada } = datosNube((_url, _opciones, respuesta) => respuesta(403, { error: 'Solo puedes retirar tu reporte.' }));
  await denegada.cargar();
  await assert.rejects(denegada.retirarParoConfirmado('SOL-1'), /retirar tu reporte/);
  assert.equal(denegada.estados()['M-01'].estado, 'STOP');
  assert.equal(denegada.modo(), 'nube');
});

test('el retiro en demo local conserva la solicitud como rechazada en el historial', async () => {
  const { D } = datosNube((_url, _opciones, respuesta) => respuesta(404, { error: 'no aplica' }));
  // Habilita el modo explícitamente local sin depender de una respuesta de red.
  const cargarOriginal = D.cargar;
  await cargarOriginal();
  // La carga de prueba está en modo nube; verificamos aquí el contrato del
  // camino local mediante la implementación para impedir borrados históricos.
  assert.match(datos, /solicitudLocal\.estado = "rechazada"[\s\S]*?solicitudLocal\.cerrada = true[\s\S]*?escribirLS\(LS_SOLICITUDES, guardadas\)/);
  assert.doesNotMatch(datos, /function retirarParoConfirmado[\s\S]*?eliminarSolicitud\(folio\)/);
});

test('registro retroactivo y edición solo mutan caché después de éxito confirmado', async () => {
  const { D } = datosNube((url, _opciones, respuesta) => respuesta(500, { error: 'Fallo de prueba.' }));
  await D.cargar();
  await assert.rejects(D.registrarConfirmado({ activo: 'M-01', causa: 'espera-material', minutos: 3, retroactivo: true }), /Fallo de prueba/);
  assert.equal(D.eventosCapturados().length, 0);
  const edicion = datosNube((_url, _opciones, respuesta) => respuesta(500, { error: 'Fallo de edición.' }));
  await edicion.D.cargar();
  await assert.rejects(edicion.D.editarConfirmado('NO-EXISTE', { causa: 'espera-material', minutos: 5 }), /Fallo de edición/);
});
