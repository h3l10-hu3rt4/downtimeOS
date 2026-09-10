import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearPlantillaMeta } from '../lib/integraciones.js';

test('construye plantilla de brigada con todos los parámetros del cuerpo', () => {
  const plantilla = crearPlantillaMeta('META_WHATSAPP_TEMPLATE_PAROS_PRUEBA', 'downtimeos_alerta_paros', ['7 paros activos', '3 cuellos de botella', 'C-01\nH-02']);
  assert.equal(plantilla.nombre, 'downtimeos_alerta_paros');
  assert.equal(plantilla.idioma, 'es_MX');
  assert.deepEqual(plantilla.componentes, [{
    type: 'body', parameters: [
      { type: 'text', text: '7 paros activos' },
      { type: 'text', text: '3 cuellos de botella' },
      { type: 'text', text: 'C-01\nH-02' },
    ],
  }]);
});

test('construye plantilla de reporte con documento y respuestas de aprobación', () => {
  const plantilla = crearPlantillaMeta('META_WHATSAPP_TEMPLATE_REPORTE_PRUEBA', 'downtimeos_reporte_ejecutivo', ['Reporte listo'], {
    documentoUrl: 'https://storage.example/reporte.pdf', respuestas: ['dtos:aprobar:F-1', 'dtos:rechazar:F-1'],
  });
  assert.equal(plantilla.componentes[0].type, 'header');
  assert.equal(plantilla.componentes[0].parameters[0].document.filename, 'DowntimeOS-reporte-ejecutivo.pdf');
  assert.equal(plantilla.componentes[1].parameters[0].text, 'Reporte listo');
  assert.equal(plantilla.componentes[2].parameters[0].payload, 'dtos:aprobar:F-1');
  assert.equal(plantilla.componentes[3].parameters[0].payload, 'dtos:rechazar:F-1');
});

test('respeta el nombre configurado y limita parámetros para Meta', () => {
  process.env.META_WHATSAPP_TEMPLATE_PAROS_PRUEBA = 'plantilla_aceptada';
  const plantilla = crearPlantillaMeta('META_WHATSAPP_TEMPLATE_PAROS_PRUEBA', 'predeterminada', ['x'.repeat(1200)]);
  assert.equal(plantilla.nombre, 'plantilla_aceptada');
  assert.equal(plantilla.componentes[0].parameters[0].text.length, 1000);
  delete process.env.META_WHATSAPP_TEMPLATE_PAROS_PRUEBA;
});
