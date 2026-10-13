import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearPlantillaMeta, enviarPorMeta, enviarSolicitudAprobacion, usaPlantillasMeta, conReintentoProveedor, generarAnalisis } from '../lib/integraciones.js';
import { esCodigoDeVerificacionEntrante, hashCodigoVerificacionWhatsApp, normalizarTelefonoE164 } from '../lib/whatsapp-contactos.js';

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

test('construye plantilla de reporte con encabezado de documento', () => {
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

test('los idiomas predeterminados coinciden con las plantillas aprobadas de Meta', async () => {
  const fuente = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../lib/integraciones.js', import.meta.url), 'utf8'));
  const compose = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../docker-compose.yml', import.meta.url), 'utf8'));
  const ejemplo = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../.env.example', import.meta.url), 'utf8'));
  assert.match(fuente, /META_WHATSAPP_TEMPLATE_APROBACION_LANGUAGE \|\| 'en'/);
  assert.match(fuente, /META_WHATSAPP_TEMPLATE_ALERTA_ACTIVO_LANGUAGE \|\| 'en'/);
  assert.match(compose, /META_WHATSAPP_TEMPLATE_APROBACION_LANGUAGE: \$\{[^\n]+:-en\}/);
  assert.match(compose, /META_WHATSAPP_TEMPLATE_ALERTA_ACTIVO_LANGUAGE: \$\{[^\n]+:-en\}/);
  assert.match(ejemplo, /^META_WHATSAPP_TEMPLATE_APROBACION_LANGUAGE=en$/m);
  assert.match(ejemplo, /^META_WHATSAPP_TEMPLATE_ALERTA_ACTIVO_LANGUAGE=en$/m);
});

test('la validación sin plantilla conserva opciones de aprobación', () => {
  const fuente = enviarSolicitudAprobacion.toString();
  assert.match(fuente, /type: 'button'/);
  assert.match(fuente, /title: 'Aprobar'/);
  assert.match(fuente, /title: 'Rechazar'/);
});

test('el webhook de Meta conserva el cuerpo original y verifica firma HMAC', async () => {
  const fuente = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../api/whatsapp/alerta.js', import.meta.url), 'utf8'));
  assert.match(fuente, /bodyParser: false/);
  assert.match(fuente, /createHmac\('sha256'/);
  assert.match(fuente, /timingSafeEqual/);
  assert.match(fuente, /update\(raw\)/);
  assert.match(fuente, /cuerpo\?\.object === 'whatsapp_business_account'/);
  assert.match(fuente, /x-hub-signature-256/);
});

test('el estado de verificación WhatsApp distingue desafíos pendientes y vencidos', async () => {
  const endpoint = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../api/planta/whatsapp-contacto.js', import.meta.url), 'utf8'));
  const pagina = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../app/contacto-whatsapp/page.js', import.meta.url), 'utf8'));
  assert.match(endpoint, /verificacionResult[\s\S]*\.is\('consumido_en', null\)[\s\S]*\.order\('created_at'/);
  assert.match(endpoint, /estadoVerificacion[\s\S]*'pendiente'[\s\S]*'expirada'/);
  assert.match(pagina, /Revisando confirmación…/);
  assert.match(pagina, /Aún no llega la confirmación de Meta/);
  assert.match(pagina, /el código ya venció/);
});

test('SMS usa Twilio Verify para enviar y aprobar el código sin guardar el OTP', async () => {
  const endpoint = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../api/planta/whatsapp-contacto.js', import.meta.url), 'utf8'));
  const pagina = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../app/contacto-whatsapp/page.js', import.meta.url), 'utf8'));
  const migracion = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../supabase/migrations/20261013065113_twilio_sms_verification_channel.sql', import.meta.url), 'utf8'));
  assert.match(endpoint, /Services\/\$\{serviceSid\}\/\$\{endpoint\}/);
  assert.match(endpoint, /'Verifications', \{ To: telefono, Channel: 'sms' \}/);
  assert.match(endpoint, /'VerificationCheck', \{ To: contacto\.telefono_e164, Code: codigo \}/);
  assert.match(endpoint, /resultado\.datos\.status !== 'approved'/);
  assert.match(endpoint, /codigo_hash: hashCodigoVerificacionWhatsApp\(codigoInterno\)/);
  assert.match(endpoint, /MAX_INTENTOS_SMS = 5/);
  assert.match(endpoint, /REINTENTO_SMS_MS = 60 \* 1000/);
  assert.match(pagina, /Enviar código por SMS/);
  assert.match(pagina, /Confirmar código SMS/);
  assert.match(migracion, /canal in \('whatsapp', 'sms'\)/);
});

test('normaliza teléfonos internacionales y solo asume México para números locales de 10 dígitos', () => {
  assert.equal(normalizarTelefonoE164('55 1234 5678'), '+525512345678');
  assert.equal(normalizarTelefonoE164('+1 (415) 555-0100'), '+14155550100');
  assert.throws(() => normalizarTelefonoE164('12345'), /formato internacional/);
});

test('los desafíos WhatsApp usan texto válido y hash determinista sin almacenar el código', () => {
  const codigo = 'token-de-prueba-'.repeat(3);
  assert.match(hashCodigoVerificacionWhatsApp(codigo), /^[a-f0-9]{64}$/);
  assert.equal(hashCodigoVerificacionWhatsApp(codigo), hashCodigoVerificacionWhatsApp(codigo));
  assert.equal(esCodigoDeVerificacionEntrante(`DOWNTIMEOS VERIFICAR ${codigo}`), true);
  assert.equal(esCodigoDeVerificacionEntrante(`DOWNTIMEOS VERIFICAR ${codigo} extra`), false);
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
