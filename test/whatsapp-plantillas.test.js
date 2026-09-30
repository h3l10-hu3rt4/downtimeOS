import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearPlantillaMeta, enviarPorMeta, enviarSolicitudAprobacion, usaPlantillasMeta, conReintentoProveedor, destinatarioPredeterminadoWhatsApp, generarAnalisis } from '../lib/integraciones.js';

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

test('envía a Cloud API un mensaje de plantilla y no texto libre', async () => {
  const anteriorFetch = global.fetch;
  const anteriores = {
    token: process.env.META_WHATSAPP_ACCESS_TOKEN,
    phoneId: process.env.META_WHATSAPP_PHONE_NUMBER_ID,
    version: process.env.META_WHATSAPP_GRAPH_VERSION,
  };
  process.env.META_WHATSAPP_ACCESS_TOKEN = 'token-de-prueba';
  process.env.META_WHATSAPP_PHONE_NUMBER_ID = '123456';
  process.env.META_WHATSAPP_GRAPH_VERSION = 'v23.0';
  let solicitud;
  global.fetch = async (url, opciones) => {
    solicitud = { url, opciones };
    return new Response(JSON.stringify({ messages: [{ id: 'wamid.prueba' }] }), { status: 200 });
  };
  try {
    const plantilla = crearPlantillaMeta('META_WHATSAPP_TEMPLATE_PAROS_PRUEBA', 'downtimeos_alerta_paros', ['1 paro', '0 cuellos', 'C-01']);
    const resultado = await enviarPorMeta({ destino: '5215551234567', contenido: 'No debe enviarse como texto', plantilla });
    const cuerpo = JSON.parse(solicitud.opciones.body);
    assert.equal(solicitud.url, 'https://graph.facebook.com/v23.0/123456/messages');
    assert.equal(cuerpo.type, 'template');
    assert.equal(cuerpo.template.name, 'downtimeos_alerta_paros');
    assert.equal(cuerpo.text, undefined);
    assert.deepEqual(resultado, { proveedor_id: 'wamid.prueba', estado: 'queued', metadatos: { messages: [{ id: 'wamid.prueba' }] } });
  } finally {
    global.fetch = anteriorFetch;
    process.env.META_WHATSAPP_ACCESS_TOKEN = anteriores.token;
    process.env.META_WHATSAPP_PHONE_NUMBER_ID = anteriores.phoneId;
    process.env.META_WHATSAPP_GRAPH_VERSION = anteriores.version;
  }
});

test('normaliza espacios, Bearer y comillas de token antes de llamar a Meta', async () => {
  const anteriorFetch = global.fetch;
  const tokenAnterior = process.env.META_WHATSAPP_ACCESS_TOKEN;
  const phoneAnterior = process.env.META_WHATSAPP_PHONE_NUMBER_ID;
  process.env.META_WHATSAPP_ACCESS_TOKEN = ' "Bearer token-de-prueba" ';
  process.env.META_WHATSAPP_PHONE_NUMBER_ID = ' 987654 ';
  let solicitud;
  global.fetch = async (url, opciones) => {
    solicitud = { url, opciones };
    return new Response(JSON.stringify({ messages: [{ id: 'wamid.limpio' }] }), { status: 200 });
  };
  try {
    await enviarPorMeta({ destino: '5215551234567', contenido: 'x', plantilla: crearPlantillaMeta('NO_EXISTE', 'prueba', ['x']) });
    assert.equal(solicitud.url.includes('/987654/messages'), true);
    assert.equal(solicitud.opciones.headers.Authorization, 'Bearer token-de-prueba');
  } finally {
    global.fetch = anteriorFetch;
    process.env.META_WHATSAPP_ACCESS_TOKEN = tokenAnterior;
    process.env.META_WHATSAPP_PHONE_NUMBER_ID = phoneAnterior;
  }
});

test('las plantillas de Meta solo se habilitan de forma explícita', () => {
  const proveedorAnterior = process.env.WHATSAPP_PROVIDER;
  const plantillasAnterior = process.env.WHATSAPP_META_USE_TEMPLATES;
  process.env.WHATSAPP_PROVIDER = 'meta';
  process.env.WHATSAPP_META_USE_TEMPLATES = 'false';
  assert.equal(usaPlantillasMeta(), false);
  process.env.WHATSAPP_META_USE_TEMPLATES = 'true';
  assert.equal(usaPlantillasMeta(), true);
  process.env.WHATSAPP_PROVIDER = proveedorAnterior;
  process.env.WHATSAPP_META_USE_TEMPLATES = plantillasAnterior;
});

test('la validación sin plantilla conserva opciones de aprobación', () => {
  const fuente = enviarSolicitudAprobacion.toString();
  assert.match(fuente, /type: 'button'/);
  assert.match(fuente, /title: 'Aprobar'/);
  assert.match(fuente, /title: 'Rechazar'/);
});

test('el webhook de Meta se identifica después de interpretar su cuerpo', async () => {
  const fuente = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../api/whatsapp/alerta.js', import.meta.url), 'utf8'));
  assert.match(fuente, /const cuerpo = leerCuerpo\(req\)/);
  assert.match(fuente, /cuerpo\?\.object === 'whatsapp_business_account'/);
  assert.match(fuente, /x-hub-signature-256/);
});

test('separa destinatarios de Operaciones y Finanzas', () => {
  const operacionesAnterior = process.env.WHATSAPP_OPERACIONES_DESTINATARIO;
  const finanzasAnterior = process.env.WHATSAPP_FINANZAS_DESTINATARIO;
  const legadoAnterior = process.env.WHATSAPP_ALERTAS_DESTINATARIOS;
  process.env.WHATSAPP_OPERACIONES_DESTINATARIO = '5211111111111';
  process.env.WHATSAPP_FINANZAS_DESTINATARIO = '5222222222222';
  process.env.WHATSAPP_ALERTAS_DESTINATARIOS = '5233333333333';
  assert.equal(destinatarioPredeterminadoWhatsApp('operaciones'), '5211111111111');
  assert.equal(destinatarioPredeterminadoWhatsApp('finanzas'), '5222222222222');
  process.env.WHATSAPP_OPERACIONES_DESTINATARIO = operacionesAnterior;
  process.env.WHATSAPP_FINANZAS_DESTINATARIO = finanzasAnterior;
  process.env.WHATSAPP_ALERTAS_DESTINATARIOS = legadoAnterior;
});

test('reintenta errores transitorios del proveedor de IA', async () => {
  let llamadas = 0;
  const resultado = await conReintentoProveedor(async () => {
    llamadas += 1;
    if (llamadas < 3) throw Object.assign(new Error('ocupado'), { status: 503 });
    return 'listo';
  }, { intentos: 3, esperaBaseMs: 0 });
  assert.equal(resultado, 'listo');
  assert.equal(llamadas, 3);
});

test('acepta proveedor forzado para el respaldo del reporte', () => {
  const fuente = generarAnalisis.toString();
  assert.match(fuente, /proveedorForzado/);
});
