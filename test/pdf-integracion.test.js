import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearPdf } from '../lib/integraciones.js';

test('genera un PDF ejecutivo legible con datos sintéticos y análisis de IA', async () => {
  const pdf = await crearPdf({
    resumen: {
      eventos: 2,
      minutos_paro: 42,
      costo_total_mxn: 8400,
      mttr_minutos: 21,
      causas_principales: [{ causa: 'Falla mecánica', eventos: 2, minutos: 42, costo_mxn: 8400 }],
      activos_principales: [{ activo: 'A-01', eventos: 2, minutos: 42, costo_mxn: 8400, linea: 'L-01' }],
      por_turno_linea: [{ turno: 'T1', linea: 'L-01', costo_mxn: 8400 }],
    },
    analisis: {
      resumen: 'Los eventos sintéticos se concentran en un equipo y justifican revisar la recurrencia.',
      hallazgos: ['Dos incidencias comparten causa registrada.'],
      recomendaciones: ['Validar el registro en la siguiente revisión financiera.'],
      acciones_criticas: [],
      consideraciones: ['Los datos son ficticios y no representan producción.'],
      advertencia: 'Validar cualquier decisión con el equipo responsable.',
      uso: { modelo: 'modelo-sintetico', nivel_razonamiento: 'low' },
    },
    modelo: 'modelo-sintetico',
  });

  assert.ok(Buffer.isBuffer(pdf));
  assert.ok(pdf.length > 500);
  assert.equal(pdf.subarray(0, 5).toString('ascii'), '%PDF-');
  assert.equal(pdf.subarray(-6).toString('ascii').includes('%%EOF'), true);
  assert.match(pdf.toString('latin1'), /\/Type \/Page\b/);
  assert.match(pdf.toString('latin1'), /startxref\s+\d+\s+%%EOF/);
});

test('reserva la pestaña del PDF antes de esperar a la API para evitar el bloqueo de popups', async () => {
  const { readFile } = await import('node:fs/promises');
  const fuente = await readFile(new URL('../public/demo/js/direccion.js', import.meta.url), 'utf8');
  const inicio = fuente.indexOf('$("#btnReporte").addEventListener');
  const fin = fuente.indexOf('$("#btnEnviarReporte").addEventListener', inicio);
  const manejador = fuente.slice(inicio, fin);

  assert.ok(inicio >= 0 && fin > inicio, 'debe localizar el manejador de exportación');
  assert.ok(manejador.indexOf('window.open("about:blank", "_blank")') < manejador.indexOf('crearReporteRemoto()'),
    'la pestaña se debe abrir durante el gesto, antes de iniciar el flujo asíncrono');
  assert.match(manejador, /ventanaReporte\.location\.replace\(respuesta\.reporte\.url\)/);
  assert.match(manejador, /window\.location\.assign\(respuesta\.reporte\.url\)/);
  assert.doesNotMatch(manejador, /window\.open\(respuesta\.reporte\.url/);
});
