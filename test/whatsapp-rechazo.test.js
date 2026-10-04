import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';

/**
 * Simula el webhook real de Meta contra un Supabase en memoria: el toque de
 * «Rechazar» en WhatsApp debe deshacer el paro igual que el tablero web.
 */
process.env.SUPABASE_URL ??= 'https://x.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'k';
process.env.META_WHATSAPP_APP_SECRET = 'secreto-prueba';
process.env.WHATSAPP_APROBACIONES_ACTIVAS = 'true';
process.env.WHATSAPP_OPERACIONES_DESTINATARIO = '5216180000000';

const { supabase } = await import('../lib/supabase.js');
const { default: webhook } = await import('../api/whatsapp/alerta.js');

let db;
const FOLIO = 'L01-SR-C01-20260923-0840-R4';
const PLANTA = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  db = {
    planta_activos: [{ planta_id: PLANTA, id: 'C-01', nombre: 'Sierra de corte', linea_id: 'L-01', tarifa_hora: 1000, activo: true }],
    planta_estados: [{ planta_id: PLANTA, activo_id: 'C-01', estado: 'STOP', desde: '2026-09-23T14:40:00Z', causa_id: 'ruptura-herramental' }],
    planta_solicitudes: [{ planta_id: PLANTA, folio: FOLIO, activo_id: 'C-01', causa_id: 'ruptura-herramental', causa_libre: null, estado: 'pendiente', cerrada: false }],
    planta_eventos: [],
    planta_mensajes: [{ proveedor_id: 'SM123', estado: 'sent' }],
  };
});

/** Constructor de consultas mínimo con la forma de supabase-js. */
function consulta(tabla) {
  const filtros = [];
  let operacion = 'select';
  let datos = null;
  let conflicto = null;
  const filas = () => db[tabla].filter((f) => filtros.every((p) => p(f)));
  const ejecutar = () => {
    if (operacion === 'update') return filas().map((f) => Object.assign(f, datos));
    if (operacion === 'upsert') {
      const previa = db[tabla].find((f) => f[conflicto] === datos[conflicto]);
      if (previa) return [Object.assign(previa, datos)];
      db[tabla].push({ ...datos });
      return [db[tabla].at(-1)];
    }
    return filas();
  };
  const q = {
    select() { return q; },
    eq(k, v) { filtros.push((f) => f[k] === v); return q; },
    neq(k, v) { filtros.push((f) => f[k] !== v); return q; },
    update(p) { operacion = 'update'; datos = p; return q; },
    upsert(p, o) { operacion = 'upsert'; datos = p; conflicto = o.onConflict; return q; },
    maybeSingle: async () => ({ data: ejecutar()[0] ?? null, error: null }),
    single: async () => ({ data: ejecutar()[0] ?? null, error: null }),
    then: (ok, mal) => Promise.resolve({ data: ejecutar(), error: null }).then(ok, mal),
  };
  return q;
}
supabase.from = consulta;
supabase.rpc = async (nombre, args) => {
  if (nombre !== 'planta_descartar_solicitud') return { data: 1000, error: null };
  const actual = db.planta_solicitudes.find((item) => item.folio === args.p_folio && item.planta_id === args.p_planta_id);
  if (!actual) return { data: null, error: { code: 'P0002', message: 'La solicitud no existe.' } };
  Object.assign(actual, { estado: 'rechazada', causa_validada_id: actual.causa_id, resuelta_por: args.p_resuelta_por, cerrada: true });
  const maquinaLiberada = !db.planta_solicitudes.some((item) => item.activo_id === actual.activo_id && !item.cerrada && item.estado !== 'rechazada');
  if (maquinaLiberada) {
    const estado = db.planta_estados.find((item) => item.planta_id === args.p_planta_id && item.activo_id === actual.activo_id);
    if (estado) estado.estado = 'RUN';
    db.planta_solicitudes.filter((item) => item.activo_id === actual.activo_id).forEach((item) => { item.cerrada = true; });
  }
  return { data: { solicitud: actual, maquina_liberada: maquinaLiberada }, error: null };
};

async function llamar(cuerpo, firmaValida = true, comoStream = false) {
  const raw = Buffer.from(JSON.stringify(cuerpo));
  const secreto = process.env.META_WHATSAPP_APP_SECRET || process.env.META_WHATSAPP_WEBHOOK_SECRET;
  const firma = `sha256=${createHmac('sha256', secreto).update(raw).digest('hex')}`;
  const req = Object.assign(comoStream ? Readable.from([raw]) : {}, {
    method: 'POST', headers: { 'x-hub-signature-256': firmaValida ? firma : 'sha256=' + '0'.repeat(64), 'content-type': 'application/json' },
    body: comoStream ? undefined : raw, query: {},
  });
  const res = {
    codigo: 0, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.codigo = c; return this; },
    send(t) { this.cuerpo = t; return this; },
  };
  await webhook(req, res);
  return res;
}

test('webhook acepta META_WHATSAPP_WEBHOOK_SECRET como alias del secreto de Meta', async () => {
  const appSecretAnterior = process.env.META_WHATSAPP_APP_SECRET;
  process.env.META_WHATSAPP_WEBHOOK_SECRET = 'secreto-alias-prueba';
  delete process.env.META_WHATSAPP_APP_SECRET;
  try {
    const res = await llamar(mensajeMeta({ type: 'unknown' }));
    assert.equal(res.codigo, 200);
  } finally {
    if (appSecretAnterior === undefined) delete process.env.META_WHATSAPP_APP_SECRET;
    else process.env.META_WHATSAPP_APP_SECRET = appSecretAnterior;
    delete process.env.META_WHATSAPP_WEBHOOK_SECRET;
  }
});

const mensajeMeta = (mensaje, from = '5216180000000') => ({
  object: 'whatsapp_business_account',
  entry: [{ changes: [{ value: { messages: [{ from, ...mensaje }] } }] }],
});
const interactivo = (accion, from) => mensajeMeta({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: `dtos:${accion}:${PLANTA}:${FOLIO}`, title: 'x' } } }, from);
const dePlantilla = (accion, from) => mensajeMeta({ type: 'button', button: { payload: `dtos:${accion}:${PLANTA}:${FOLIO}`, text: 'Rechazar' } }, from);

const solicitud = () => db.planta_solicitudes.find((s) => s.folio === FOLIO);
const estadoC01 = () => db.planta_estados.find((e) => e.activo_id === 'C-01').estado;

test('rechazar desde un mensaje interactivo deshace el paro', async () => {
  const res = await llamar(interactivo('rechazar'));
  assert.equal(res.codigo, 200);
  assert.equal(solicitud().estado, 'rechazada');
  assert.equal(solicitud().cerrada, true);
  assert.match(solicitud().resuelta_por, /^WhatsApp /);
  assert.equal(estadoC01(), 'RUN');
  assert.equal(db.planta_eventos.length, 0, 'un rechazo no registra paro ni costo');
});

test('rechazar desde el botón de una plantilla aprobada también se aplica', async () => {
  await llamar(dePlantilla('rechazar'));
  assert.equal(solicitud().estado, 'rechazada');
  assert.equal(estadoC01(), 'RUN');
});

test('aprobar por WhatsApp confirma y deja la máquina en paro', async () => {
  await llamar(interactivo('aprobar'));
  assert.equal(solicitud().estado, 'aprobada');
  assert.equal(solicitud().cerrada, false);
  assert.equal(estadoC01(), 'STOP');
});

test('ignora aprobaciones de números distintos al WhatsApp configurado para Operaciones', async () => {
  const res = await llamar(interactivo('aprobar', '5219998887777'));
  assert.equal(res.codigo, 200, 'Meta recibe ACK y no reintenta un botón no autorizado');
  assert.equal(solicitud().estado, 'pendiente');
  assert.equal(solicitud().cerrada, false);
  assert.equal(estadoC01(), 'STOP');
});

test('falla cerrada si no existe un destinatario operativo configurado', async () => {
  const anterior = process.env.WHATSAPP_OPERACIONES_DESTINATARIO;
  delete process.env.WHATSAPP_OPERACIONES_DESTINATARIO;
  delete process.env.WHATSAPP_ALERTAS_DESTINATARIOS;
  try {
    const res = await llamar(interactivo('rechazar'));
    assert.equal(res.codigo, 200);
    assert.equal(solicitud().estado, 'pendiente');
    assert.equal(estadoC01(), 'STOP');
  } finally {
    if (anterior === undefined) delete process.env.WHATSAPP_OPERACIONES_DESTINATARIO;
    else process.env.WHATSAPP_OPERACIONES_DESTINATARIO = anterior;
  }
});

test('un toque tardío no revierte lo que ya se decidió en el tablero', async () => {
  solicitud().estado = 'aprobada';
  await llamar(interactivo('rechazar'));
  assert.equal(solicitud().estado, 'aprobada');
  assert.equal(estadoC01(), 'STOP');
});

test('si otro reporte vigente sostiene el paro, la máquina sigue detenida', async () => {
  db.planta_solicitudes.push({ planta_id: PLANTA, folio: 'OTRO', activo_id: 'C-01', causa_id: 'x', estado: 'aprobada', cerrada: false });
  await llamar(interactivo('rechazar'));
  assert.equal(solicitud().estado, 'rechazada');
  assert.equal(estadoC01(), 'STOP');
});

test('rechaza un webhook de Meta con firma falsificada sin cambiar el paro', async () => {
  const res = await llamar(interactivo('rechazar'), false);
  assert.equal(res.codigo, 403);
  assert.equal(solicitud().estado, 'pendiente');
  assert.equal(estadoC01(), 'STOP');
});

test('acepta la firma válida sobre los bytes originales del stream HTTP', async () => {
  const res = await llamar(interactivo('rechazar'), true, true);
  assert.equal(res.codigo, 200);
  assert.equal(solicitud().estado, 'rechazada');
});

async function llamarTwilio(firmaValida = true) {
  const anteriorToken = process.env.TWILIO_AUTH_TOKEN;
  const anteriorUrl = process.env.PUBLIC_APP_URL;
  process.env.TWILIO_AUTH_TOKEN = 'twilio-prueba';
  process.env.PUBLIC_APP_URL = 'https://downtimeos.test';
  const params = { MessageSid: 'SM123', MessageStatus: 'delivered' };
  const raw = Buffer.from(new URLSearchParams(params).toString());
  const canonical = `${process.env.PUBLIC_APP_URL}/api/whatsapp/alerta`
    + Object.keys(params).sort().map((clave) => `${clave}${params[clave]}`).join('');
  const firma = createHmac('sha1', process.env.TWILIO_AUTH_TOKEN).update(canonical).digest('base64');
  const req = {
    method: 'POST', body: raw, query: {},
    headers: {
      'x-twilio-signature': firmaValida ? firma : 'firma-falsa',
      'content-type': 'application/x-www-form-urlencoded',
    },
  };
  const res = {
    codigo: 0, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.codigo = c; return this; },
    send(t) { this.cuerpo = t; return this; },
  };
  try { await webhook(req, res); return res; }
  finally {
    if (anteriorToken === undefined) delete process.env.TWILIO_AUTH_TOKEN;
    else process.env.TWILIO_AUTH_TOKEN = anteriorToken;
    if (anteriorUrl === undefined) delete process.env.PUBLIC_APP_URL;
    else process.env.PUBLIC_APP_URL = anteriorUrl;
  }
}

test('el callback de Twilio conserva la validación de firma y actualiza entrega', async () => {
  const res = await llamarTwilio(true);
  assert.equal(res.codigo, 200);
  assert.equal(db.planta_mensajes[0].estado, 'delivered');
});

test('el callback de Twilio rechaza firma incorrecta', async () => {
  const res = await llamarTwilio(false);
  assert.equal(res.codigo, 403);
  assert.equal(db.planta_mensajes[0].estado, 'sent');
});
