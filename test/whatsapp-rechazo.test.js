import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Simula el webhook real de Meta contra un Supabase en memoria: el toque de
 * «Rechazar» en WhatsApp debe deshacer el paro igual que el tablero web.
 */
process.env.SUPABASE_URL ??= 'https://x.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'k';
process.env.META_WHATSAPP_WEBHOOK_SECRET = 'secreto-prueba';
process.env.WHATSAPP_APROBACIONES_ACTIVAS = 'true';

const { supabase } = await import('../lib/supabase.js');
const { default: webhook } = await import('../api/whatsapp/alerta.js');

let db;
const FOLIO = 'L01-SR-C01-20260923-0840-R4';

beforeEach(() => {
  db = {
    planta_activos: [{ id: 'C-01', nombre: 'Sierra de corte', linea_id: 'L-01', tarifa_hora: 1000 }],
    planta_estados: [{ activo_id: 'C-01', estado: 'STOP', desde: '2026-09-23T14:40:00Z', causa_id: 'ruptura-herramental' }],
    planta_solicitudes: [{ folio: FOLIO, activo_id: 'C-01', causa_id: 'ruptura-herramental', causa_libre: null, estado: 'pendiente', cerrada: false }],
    planta_eventos: [],
    planta_mensajes: [],
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
supabase.rpc = async () => ({ data: 1000, error: null });

async function llamar(cuerpo) {
  const req = { method: 'POST', headers: { 'x-hub-signature-256': 'sha256=x' }, body: cuerpo, query: {} };
  const res = {
    codigo: 0, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.codigo = c; return this; },
    send(t) { this.cuerpo = t; return this; },
  };
  await webhook(req, res);
  return res;
}

const mensajeMeta = (mensaje) => ({
  object: 'whatsapp_business_account',
  entry: [{ changes: [{ value: { messages: [{ from: '5216180000000', ...mensaje }] } }] }],
});
const interactivo = (accion) => mensajeMeta({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: `dtos:${accion}:${FOLIO}`, title: 'x' } } });
const dePlantilla = (accion) => mensajeMeta({ type: 'button', button: { payload: `dtos:${accion}:${FOLIO}`, text: 'Rechazar' } });

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

test('un toque tardío no revierte lo que ya se decidió en el tablero', async () => {
  solicitud().estado = 'aprobada';
  await llamar(interactivo('rechazar'));
  assert.equal(solicitud().estado, 'aprobada');
  assert.equal(estadoC01(), 'STOP');
});

test('si otro reporte vigente sostiene el paro, la máquina sigue detenida', async () => {
  db.planta_solicitudes.push({ folio: 'OTRO', activo_id: 'C-01', causa_id: 'x', estado: 'aprobada', cerrada: false });
  await llamar(interactivo('rechazar'));
  assert.equal(solicitud().estado, 'rechazada');
  assert.equal(estadoC01(), 'STOP');
});
