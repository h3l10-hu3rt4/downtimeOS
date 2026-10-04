import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { datosVisiblesPorRol } from '../api/planta/index.js';
import { agregarImpactoActual } from '../lib/visibilidad-financiera.js';

const estado = {
  activos: [{ id: 'C-01', tarifa_hora: 1250, costo_total_mxn: 900 }],
  eventos: [{ folio: 'F-1', tarifa_aplicada: 1250, costo_mxn: 500, impacto_financiero_mxn: 900 }],
};

test('Operaciones recibe impacto y costos para priorizar, pero no tarifas', () => {
  const resultado = datosVisiblesPorRol(estado, { rol: 'operaciones' });
  assert.deepEqual(resultado.activos, [{ id: 'C-01', costo_total_mxn: 900 }]);
  assert.deepEqual(resultado.eventos, [{ folio: 'F-1', costo_mxn: 500, impacto_financiero_mxn: 900 }]);
});

test('Operador no recibe tarifas ni costos del tablero', () => {
  const resultado = datosVisiblesPorRol(estado, { rol: 'operador' });
  assert.deepEqual(resultado.activos, [{ id: 'C-01' }]);
  assert.deepEqual(resultado.eventos, [{ folio: 'F-1' }]);
});

test('Dirección y Finanzas conservan acceso financiero', () => {
  assert.equal(datosVisiblesPorRol(estado, { rol: 'direccion' }), estado);
  assert.equal(datosVisiblesPorRol(estado, { rol: 'finanzas' }), estado);
});

test('administración de cuenta delegada no concede por sí sola visibilidad financiera de planta', () => {
  const delegado = datosVisiblesPorRol(estado, { rol: 'operador', es_admin_cuenta: true });
  assert.deepEqual(delegado.activos, [{ id: 'C-01' }]);
  assert.deepEqual(delegado.eventos, [{ folio: 'F-1' }]);
});

test('las respuestas anidadas de escritura también ocultan costos a Operaciones y Operadores', () => {
  const respuesta = {
    evento: { folio: 'F-2', costo_mxn: 80, tarifa_aplicada: 1200, minutos: 4 },
    estado: { activo_id: 'C-01', estado: 'RUN' },
    solicitud: { folio: 'S-2', importe_referencia: 80 },
  };
  const esperada = {
    evento: { folio: 'F-2', minutos: 4 },
    estado: { activo_id: 'C-01', estado: 'RUN' },
    solicitud: { folio: 'S-2' },
  };
  assert.deepEqual(datosVisiblesPorRol(respuesta, { rol: 'operaciones' }), {
    evento: { folio: 'F-2', costo_mxn: 80, minutos: 4 },
    estado: { activo_id: 'C-01', estado: 'RUN' },
    solicitud: { folio: 'S-2', importe_referencia: 80 },
  });
  assert.deepEqual(datosVisiblesPorRol(respuesta, { rol: 'operador' }), esperada);
  assert.equal(datosVisiblesPorRol(respuesta, { rol: 'direccion' }), respuesta);
  assert.equal(datosVisiblesPorRol(respuesta, { rol: 'finanzas' }), respuesta);
});

test('registro, corrección y cierre aplican el filtro financiero antes de responder', async () => {
  const [eventos, reportes] = await Promise.all([
    readFile(new URL('../api/planta/eventos.js', import.meta.url), 'utf8'),
    readFile(new URL('../api/planta/reportes.js', import.meta.url), 'utf8'),
  ]);
  assert.match(eventos, /datosVisiblesPorRol\(\{ ok: true, mensaje: 'Paro registrado\.', evento, alerta \}, sesion\.perfil\)/);
  assert.match(eventos, /datosVisiblesPorRol\(\{ ok: true, mensaje: 'Evento corregido\.', evento \}, sesion\.perfil\)/);
  assert.match(reportes, /datosVisiblesPorRol\(\{ ok: true, mensaje: 'Paro cerrado y guardado\.', \.\.\.cierre \}, sesion\.perfil\)/);
});

test('impacto vivo se calcula en servidor sin mandar tarifas a Operaciones', () => {
  const estadoVivo = agregarImpactoActual({
    activos: [
      { id: 'A', linea_id: 'L1', etapa: 'prensa', tarifa_hora: 600 },
      { id: 'B', linea_id: 'L1', etapa: 'prensa', tarifa_hora: 400 },
      { id: 'C', linea_id: 'L1', etapa: 'ensamble', tarifa_hora: 500 },
    ],
    estados: [
      { activo_id: 'A', estado: 'STOP', desde: '2026-10-03T10:00:00.000Z' },
      { activo_id: 'C', estado: 'RUN', desde: '2026-10-03T10:00:00.000Z' },
    ],
  }, Date.parse('2026-10-03T11:00:00.000Z'));
  const visible = datosVisiblesPorRol(estadoVivo, { rol: 'operaciones' });
  assert.equal(visible.estados[0].impacto_actual_mxn, 750);
  assert.equal('tarifa_hora' in visible.activos[0], false);
  assert.equal(datosVisiblesPorRol(estadoVivo, { rol: 'operador' }).estados[0].impacto_actual_mxn, undefined);
});

test('el tablero de Operaciones consume el impacto vivo en vez de inferir tarifa del activo', async () => {
  const [datos, operaciones, estadoVivo] = await Promise.all([
    readFile(new URL('../public/demo/js/datos.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/demo/js/operaciones.js', import.meta.url), 'utf8'),
    readFile(new URL('../api/planta/estado-vivo.js', import.meta.url), 'utf8'),
  ]);
  assert.match(datos, /impactoActual: f\.impacto_actual_mxn == null \? null : Number\(f\.impacto_actual_mxn\)/);
  assert.match(operaciones, /e\.impactoActual != null \? e\.impactoActual/);
  assert.match(estadoVivo, /impactoActualEstados\(vivo\.estados/);
});
