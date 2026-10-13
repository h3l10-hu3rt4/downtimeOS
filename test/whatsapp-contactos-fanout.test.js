import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL ??= 'https://x.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-only';
const { supabase } = await import('../lib/supabase.js');
const { contactosWhatsAppConConsentimiento, contactoWhatsAppAutorizado, enviarWhatsAppAContactos } = await import('../lib/integraciones.js');

const PLANTA = '11111111-1111-4111-8111-111111111111';
let db;
let originalFetch;
let originalFrom;
let originalEnv;

beforeEach(() => {
  originalFrom = supabase.from;
  originalFetch = global.fetch;
  originalEnv = Object.fromEntries([
    'WHATSAPP_PROVIDER', 'WHATSAPP_META_USE_TEMPLATES', 'META_WHATSAPP_ACCESS_TOKEN',
    'META_WHATSAPP_PHONE_NUMBER_ID', 'META_WHATSAPP_TEMPLATE_ALERTA_ACTIVO',
  ].map((key) => [key, process.env[key]]));
  process.env.WHATSAPP_PROVIDER = 'meta';
  process.env.WHATSAPP_META_USE_TEMPLATES = 'true';
  process.env.META_WHATSAPP_ACCESS_TOKEN = 'unit-test-token';
  process.env.META_WHATSAPP_PHONE_NUMBER_ID = 'unit-test-phone-id';
  process.env.META_WHATSAPP_TEMPLATE_ALERTA_ACTIVO = 'downtimeos_alerta_activo';
  db = {
    planta_interruptores_integraciones: [{ clave: 'global', whatsapp_activa: true, ia_activa: true, pdf_activa: true }],
    planta_membresias: [
      { user_id: 'ops-1', planta_id: PLANTA, rol: 'operaciones', activo: true },
      { user_id: 'ops-2', planta_id: PLANTA, rol: 'operaciones', activo: true },
      { user_id: 'ops-unverified', planta_id: PLANTA, rol: 'operaciones', activo: true },
      { user_id: 'fin-1', planta_id: PLANTA, rol: 'finanzas', activo: true },
      { user_id: 'ops-inactive', planta_id: PLANTA, rol: 'operaciones', activo: false },
    ],
    planta_whatsapp_contactos: [
      { user_id: 'ops-1', planta_id: PLANTA, telefono_e164: '+5215550000001', consentimiento_en: 'yes', verificado_en: 'yes' },
      { user_id: 'ops-2', planta_id: PLANTA, telefono_e164: '+5215550000002', consentimiento_en: 'yes', verificado_en: 'yes' },
      { user_id: 'fin-1', planta_id: PLANTA, telefono_e164: '+5215550000003', consentimiento_en: 'yes', verificado_en: 'yes' },
      { user_id: 'ops-inactive', planta_id: PLANTA, telefono_e164: '+5215550000004', consentimiento_en: 'yes', verificado_en: 'yes' },
      { user_id: 'ops-unverified', planta_id: PLANTA, telefono_e164: '+5215550000005', consentimiento_en: 'yes', verificado_en: null },
      { user_id: 'ops-no-consent', planta_id: PLANTA, telefono_e164: '+5215550000006', consentimiento_en: null, verificado_en: 'yes' },
    ],
    planta_mensajes: [],
  };
  supabase.from = (table) => query(table);
  global.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body);
    return new Response(JSON.stringify({ messages: [{ id: `wamid.${payload.to}` }] }), { status: 200 });
  };
});

afterEach(() => {
  supabase.from = originalFrom;
  global.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function query(table) {
  const filters = [];
  let op = 'select';
  let values;
  const rows = () => (db[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
  const execute = () => {
    if (op === 'insert') {
      const created = { id: `message-${db.planta_mensajes.length + 1}`, ...values };
      db[table].push(created);
      return [created];
    }
    if (op === 'update') return rows().map((row) => Object.assign(row, values));
    return rows();
  };
  const q = {
    select() { return q; },
    eq(key, value) { filters.push((row) => row[key] === value); return q; },
    in(key, list) { filters.push((row) => list.includes(row[key])); return q; },
    not(key, operator, value) {
      if (operator === 'is' && value === null) filters.push((row) => row[key] !== null && row[key] !== undefined);
      return q;
    },
    insert(value) { op = 'insert'; values = value; return q; },
    update(value) { op = 'update'; values = value; return q; },
    maybeSingle: async () => ({ data: execute()[0] ?? null, error: null }),
    single: async () => ({ data: execute()[0] ?? null, error: null }),
    then(resolve, reject) { return Promise.resolve({ data: execute(), error: null }).then(resolve, reject); },
  };
  return q;
}

test('fan-out entrega una plantilla aprobada a miembros activos con consentimiento aunque el número siga sin verificar', async () => {
  const contactos = await contactosWhatsAppConConsentimiento(PLANTA, 'operaciones');
  assert.deepEqual(contactos.map((contacto) => contacto.telefono_e164).sort(), ['+5215550000001', '+5215550000002', '+5215550000005']);
  assert.equal(await contactoWhatsAppAutorizado(PLANTA, '+5215550000005', 'operaciones'), false,
    'un teléfono no verificado no puede autorizar comandos entrantes');

  const resultado = await enviarWhatsAppAContactos({ tipo: 'operaciones', plantaId: PLANTA,
    contenido: 'Prueba sintética de alerta operativa',
    plantilla: { nombre: 'downtimeos_alerta_activo', idioma: 'en', componentes: [] } });
  assert.deepEqual({ destinatarios: resultado.destinatarios, enviados: resultado.enviados, fallidos: resultado.fallidos },
    { destinatarios: 3, enviados: 3, fallidos: 0 });
  const requests = db.planta_mensajes;
  assert.deepEqual(requests.map((message) => message.destinatario).sort(), ['5215550000001', '5215550000002', '5215550000005']);
  assert.equal(requests.every((message) => message.estado === 'queued'), true);
});

test('los reportes financieros se distribuyen a Dirección/Finanzas, no a Operaciones', async () => {
  const contactos = await contactosWhatsAppConConsentimiento(PLANTA, 'finanzas');
  assert.deepEqual(contactos.map((contacto) => contacto.telefono_e164), ['+5215550000003']);
});

test('sin contactos habilitados falla cerrado y no invoca Meta', async () => {
  let llamadas = 0;
  global.fetch = async () => { llamadas += 1; throw new Error('No debe llamar al proveedor'); };
  db.planta_whatsapp_contactos = [];
  await assert.rejects(enviarWhatsAppAContactos({ tipo: 'operaciones', plantaId: PLANTA, contenido: 'prueba' }),
    (error) => error.status === 409);
  assert.equal(llamadas, 0);
});
