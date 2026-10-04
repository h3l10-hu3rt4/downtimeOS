import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { supabase } from '../lib/supabase.js';
import { eventosDePlanta } from '../lib/planta.js';

const PLANTA = '11111111-1111-4111-8111-111111111111';
const snapshot = '2026-10-04T18:00:00.000Z';

test('la bitácora pagina estable, conserva el tenant y respeta el corte temporal', async () => {
  const filas = [
    { planta_id: PLANTA, folio: 'L01-SR-C01-20261004-1000-A1', created_at: '2026-10-04T10:00:00.000Z', inicio: '2026-10-04T10:00:00.000Z', minutos: '10', costo_mxn: '100' },
    { planta_id: PLANTA, folio: 'L01-SR-C01-20261004-1001-A1', created_at: '2026-10-04T10:01:00.000Z', inicio: '2026-10-04T10:01:00.000Z', minutos: '11', costo_mxn: '110' },
    { planta_id: PLANTA, folio: 'L01-SR-C01-20261004-1002-A1', created_at: '2026-10-04T10:02:00.000Z', inicio: '2026-10-04T10:02:00.000Z', minutos: '12', costo_mxn: '120' },
    { planta_id: PLANTA, folio: 'L01-SR-C01-20261004-1003-A1', created_at: '2026-10-04T19:00:00.000Z', inicio: '2026-10-04T19:00:00.000Z', minutos: '99', costo_mxn: '999' },
    { planta_id: '22222222-2222-4222-8222-222222222222', folio: 'L01-SR-C01-20261004-1004-A1', created_at: '2026-10-04T10:03:00.000Z', inicio: '2026-10-04T10:03:00.000Z', minutos: '99', costo_mxn: '999' },
  ];
  const anterior = supabase.from;
  supabase.from = (tabla) => {
    assert.equal(tabla, 'planta_bitacora');
    const filtros = [];
    const orden = [];
    let tope = Infinity;
    const consulta = {
      select() { return consulta; },
      eq(campo, valor) { filtros.push((fila) => fila[campo] === valor); return consulta; },
      lte(campo, valor) { filtros.push((fila) => fila[campo] <= valor); return consulta; },
      gte(campo, valor) { filtros.push((fila) => fila[campo] >= valor); return consulta; },
      or(expresion) {
        const [, fecha, fechaIgual, folio] = expresion.match(/^created_at\.gt\.(.*),and\(created_at\.eq\.(.*),folio\.gt\.(.*)\)$/) || [];
        assert.ok(fecha && fechaIgual && folio, 'cursor PostgREST conserva las dos claves de orden');
        filtros.push((fila) => fila.created_at > fecha || (fila.created_at === fechaIgual && fila.folio > folio));
        return consulta;
      },
      order(campo, opciones) { orden.push([campo, opciones.ascending]); return consulta; },
      limit(valor) { tope = valor; return consulta; },
      then(resolve, reject) {
        try {
          let data = filas.filter((fila) => filtros.every((filtro) => filtro(fila)));
          data.sort((a, b) => {
            for (const [campo, ascendente] of orden) {
              const comparacion = String(a[campo]).localeCompare(String(b[campo]));
              if (comparacion) return ascendente ? comparacion : -comparacion;
            }
            return 0;
          });
          return Promise.resolve({ data: data.slice(0, tope), error: null }).then(resolve, reject);
        } catch (error) { return Promise.reject(error).then(resolve, reject); }
      },
    };
    return consulta;
  };

  try {
    const primera = await eventosDePlanta({ plantaId: PLANTA, limite: 2, snapshot });
    assert.deepEqual(primera.eventos.map((fila) => fila.folio), [
      'L01-SR-C01-20261004-1000-A1', 'L01-SR-C01-20261004-1001-A1',
    ]);
    assert.equal(primera.siguiente_cursor.snapshot, snapshot);
    const segunda = await eventosDePlanta({ plantaId: PLANTA, limite: 2, cursor: primera.siguiente_cursor, snapshot });
    assert.deepEqual(segunda.eventos.map((fila) => fila.folio), ['L01-SR-C01-20261004-1002-A1']);
    assert.equal(segunda.siguiente_cursor, null);
    assert.deepEqual(primera.eventos.map((fila) => fila.minutos), [10, 11]);
  } finally {
    supabase.from = anterior;
  }
});

test('API y navegador recorren cursores hasta completar el historial y validan páginas fallidas', async () => {
  const api = await readFile(new URL('../api/planta/index.js', import.meta.url), 'utf8');
  const ui = await readFile(new URL('../public/demo/js/datos.js', import.meta.url), 'utf8');
  const integraciones = await readFile(new URL('../lib/integraciones.js', import.meta.url), 'utf8');
  assert.match(api, /soloEventos === '1'[\s\S]*?eventosDePlanta/);
  assert.match(api, /Number\.isSafeInteger\(tamanoPagina\)[\s\S]*?tamanoPagina > 500/);
  assert.match(api, /siguiente_cursor: salida\.paginacion_eventos\.siguiente_cursor/);
  assert.match(api, /created_at[\s\S]*?snapshot[\s\S]*?folio/);
  assert.match(ui, /function completarEventos\(inicial\)/);
  assert.match(ui, /while|pedirPagina\(\)/);
  assert.match(ui, /La página de la bitácora llegó incompleta/);
  assert.match(integraciones, /estadoPlantaCompleto/);
});
