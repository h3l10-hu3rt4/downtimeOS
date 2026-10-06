import test from 'node:test';
import assert from 'node:assert/strict';
import { supabase } from '../lib/supabase.js';
import { eventosDePlanta } from '../lib/planta.js';

const PLANTA = '11111111-1111-4111-8111-111111111111';

// Un paro de la madrugada (04:07 hora de México) del 6 de octubre pertenece a la
// jornada del 5, pero su `inicio` UTC ya cae el día 6 (caso real de HIST-06).
const filas = [
  { planta_id: PLANTA, folio: 'A', created_at: '2026-10-04T10:00:00.000Z', inicio: '2026-10-04T10:00:00.000Z', jornada: '2026-10-04', minutos: '1', costo_mxn: '10' },
  { planta_id: PLANTA, folio: 'B', created_at: '2026-10-06T10:07:00.000Z', inicio: '2026-10-06T10:07:00.000Z', jornada: '2026-10-05', minutos: '2', costo_mxn: '66.67' },
  { planta_id: PLANTA, folio: 'C', created_at: '2026-10-06T20:00:00.000Z', inicio: '2026-10-06T20:00:00.000Z', jornada: '2026-10-06', minutos: '3', costo_mxn: '99' },
];

function simular() {
  const anterior = supabase.from;
  supabase.from = () => {
    const filtros = [];
    const consulta = {
      select() { return consulta; },
      eq(campo, valor) { filtros.push((f) => f[campo] === valor); return consulta; },
      lte(campo, valor) { filtros.push((f) => f[campo] <= valor); return consulta; },
      gte(campo, valor) { filtros.push((f) => f[campo] >= valor); return consulta; },
      order() { return consulta; },
      limit() { return consulta; },
      then(resolve, reject) {
        return Promise.resolve({ data: filas.filter((f) => filtros.every((fn) => fn(f))), error: null }).then(resolve, reject);
      },
    };
    return consulta;
  };
  return () => { supabase.from = anterior; };
}

const folios = (r) => r.eventos.map((e) => e.folio);

test('por jornada, "hasta" incluye los paros de esa jornada aunque su inicio UTC sea el día siguiente', async () => {
  const restaurar = simular();
  try {
    const r = await eventosDePlanta({ plantaId: PLANTA, desde: '2026-09-06', hasta: '2026-10-05', porJornada: true, snapshot: '2026-10-07T00:00:00.000Z' });
    assert.deepEqual(folios(r), ['A', 'B']);
  } finally { restaurar(); }
});

test('sin porJornada se conserva el filtro anterior por instante de inicio', async () => {
  const restaurar = simular();
  try {
    const r = await eventosDePlanta({ plantaId: PLANTA, desde: '2026-09-06', hasta: '2026-10-05', snapshot: '2026-10-07T00:00:00.000Z' });
    assert.deepEqual(folios(r), ['A']);
  } finally { restaurar(); }
});

test('porJornada con marcas de tiempo completas cae al filtro por inicio', async () => {
  const restaurar = simular();
  try {
    const r = await eventosDePlanta({ plantaId: PLANTA, hasta: '2026-10-06T12:00:00.000Z', porJornada: true, snapshot: '2026-10-07T00:00:00.000Z' });
    assert.deepEqual(folios(r), ['A', 'B']);
  } finally { restaurar(); }
});
