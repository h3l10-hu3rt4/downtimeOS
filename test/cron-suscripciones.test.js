import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { cargarAvisosElegibles, GET, tipoAvisoVencimiento, ventanasAvisoVencimiento } from '../app/api/cron/suscripciones/route.js';
import { supabase } from '../lib/supabase.js';

const routeSource = await readFile(new URL('../app/api/cron/suscripciones/route.js', import.meta.url), 'utf8');
const leaseMigration = await readFile(new URL('../supabase/migrations/20261003000100_leases_avisos_suscripcion.sql', import.meta.url), 'utf8');
const leaseManualSql = await readFile(new URL('../supabase/migrations/20261003000100_leases_avisos_suscripcion.sql', import.meta.url), 'utf8');

const hora = 60 * 60 * 1000;

test('el cron falla cerrado sin secreto y no toca suscripciones', async () => {
  const anterior = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;
  try {
    const respuesta = await GET(new Request('http://localhost/api/cron/suscripciones'));
    assert.equal(respuesta.status, 503);
    assert.deepEqual(await respuesta.json(), { ok: false, error: 'Falta configurar CRON_SECRET.' });
  } finally {
    if (anterior === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = anterior;
  }
});

test('el cron rechaza secretos incorrectos antes de consultar la base', async () => {
  const anterior = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'secreto-local-de-prueba';
  try {
    const respuesta = await GET(new Request('http://localhost/api/cron/suscripciones', {
      headers: { authorization: 'Bearer incorrecto' },
    }));
    assert.equal(respuesta.status, 401);
    assert.deepEqual(await respuesta.json(), { ok: false, error: 'No autorizado.' });
  } finally {
    if (anterior === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = anterior;
  }
});

test('valida Resend antes de mutar ciclos de suscripción', async () => {
  const previo = {
    secreto: process.env.CRON_SECRET,
    apiKey: process.env.RESEND_API_KEY,
    remitente: process.env.RESEND_FROM_EMAIL,
  };
  process.env.CRON_SECRET = 'secreto-local-de-prueba';
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM_EMAIL;
  try {
    const respuesta = await GET(new Request('http://localhost/api/cron/suscripciones', {
      headers: { authorization: 'Bearer secreto-local-de-prueba' },
    }));
    assert.equal(respuesta.status, 503);
    assert.doesNotMatch(routeSource.slice(0, routeSource.indexOf("const ahora = new Date()")), /\.update\(/);
    assert.match(routeSource, /const apiKey = process\.env\.RESEND_API_KEY[\s\S]*?const ahora = new Date\(\)/);
  } finally {
    if (previo.secreto === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previo.secreto;
    if (previo.apiKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = previo.apiKey;
    if (previo.remitente === undefined) delete process.env.RESEND_FROM_EMAIL; else process.env.RESEND_FROM_EMAIL = previo.remitente;
  }
});

test('el cron inicia renovaciones programadas vencidas y expira periodos vencidos', async () => {
  const previous = {
    secreto: process.env.CRON_SECRET,
    apiKey: process.env.RESEND_API_KEY,
    remitente: process.env.RESEND_FROM_EMAIL,
    appUrl: process.env.APP_URL,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
    from: supabase.from,
  };
  const consultas = [];
  process.env.CRON_SECRET = 'secreto-local-de-prueba';
  process.env.RESEND_API_KEY = 're_test_solo_sin_avisos';
  process.env.RESEND_FROM_EMAIL = 'DowntimeOS QA <qa@example.test>';
  process.env.APP_URL = 'http://localhost:3000';
  process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
  supabase.from = (tabla) => {
    const consulta = { tabla, filtros: [], cambios: null };
    consultas.push(consulta);
    const builder = {
      update(cambios) { consulta.cambios = cambios; return builder; },
      in(campo, valores) { consulta.filtros.push(['in', campo, valores]); return builder; },
      not(campo, operador, valor) { consulta.filtros.push(['not', campo, operador, valor]); return builder; },
      lte(campo, valor) { consulta.filtros.push(['lte', campo, valor]); return builder; },
      eq(campo, valor) { consulta.filtros.push(['eq', campo, valor]); return builder; },
      gt(campo, valor) { consulta.filtros.push(['gt', campo, valor]); return builder; },
      gte(campo, valor) { consulta.filtros.push(['gte', campo, valor]); return builder; },
      order() { return builder; },
      limit() { return builder; },
      select() { return builder; },
      then(resolve, reject) {
        const filas = consulta.cambios?.estado === 'vencida'
          ? [{ id: 'periodo-vencido' }]
          : consulta.cambios?.periodo_programado === false
            ? [{ id: 'renovacion-que-debe-iniciar' }]
            : [];
        return Promise.resolve({ data: filas, error: null }).then(resolve, reject);
      },
    };
    return builder;
  };

  try {
    const respuesta = await GET(new Request('http://localhost/api/cron/suscripciones', {
      headers: { authorization: 'Bearer secreto-local-de-prueba' },
    }));
    const resultado = await respuesta.json();
    assert.equal(respuesta.status, 200);
    assert.equal(resultado.ok, true);
    assert.equal(resultado.vencidas, 1);
    assert.equal(resultado.periodos_iniciados, 1);
    assert.equal(consultas.length, 4, 'debe consultar ambos cambios de ciclo y después las dos ventanas de aviso');

    const expiracion = consultas.find((consulta) => consulta.cambios?.estado === 'vencida');
    assert.ok(expiracion, 'debe marcar vencidos solo los planes activos con fin alcanzado.');
    assert.ok(expiracion.filtros.some(([tipo, campo, valores]) => tipo === 'in' && campo === 'estado' && valores.includes('cancelacion_programada')));
    assert.ok(expiracion.filtros.some(([tipo, campo]) => tipo === 'not' && campo === 'termina_en'));
    assert.ok(expiracion.filtros.some(([tipo, campo]) => tipo === 'lte' && campo === 'termina_en'));

    const inicio = consultas.find((consulta) => consulta.cambios?.periodo_programado === false);
    assert.ok(inicio, 'debe retirar la marca de programación cuando llega inicia_en.');
    assert.ok(inicio.filtros.some(([tipo, campo, valor]) => tipo === 'eq' && campo === 'periodo_programado' && valor === true));
    assert.ok(inicio.filtros.some(([tipo, campo]) => tipo === 'not' && campo === 'inicia_en'));
    assert.ok(inicio.filtros.some(([tipo, campo]) => tipo === 'lte' && campo === 'inicia_en'));
    assert.ok(inicio.filtros.some(([tipo, campo, valores]) => tipo === 'in' && campo === 'estado' && valores.includes('activa')));
  } finally {
    supabase.from = previous.from;
    for (const [nombre, valor] of Object.entries({
      CRON_SECRET: previous.secreto,
      RESEND_API_KEY: previous.apiKey,
      RESEND_FROM_EMAIL: previous.remitente,
      APP_URL: previous.appUrl,
      NEXT_PUBLIC_SITE_URL: previous.siteUrl,
    })) {
      if (valor === undefined) delete process.env[nombre];
      else process.env[nombre] = valor;
    }
  }
});

test('los avisos de vencimiento se etiquetan en ventanas centradas en siete y un día', () => {
  assert.equal(tipoAvisoVencimiento(7 * 24 * hora), '7_dias');
  assert.equal(tipoAvisoVencimiento(6 * 24 * hora), null);
  assert.equal(tipoAvisoVencimiento(24 * hora), '1_dia');
  assert.equal(tipoAvisoVencimiento(36 * hora), null);
  assert.equal(tipoAvisoVencimiento(0), null);
  assert.equal(tipoAvisoVencimiento(-hora), null);
});

test('los correos usan el origen validado del ambiente, nunca un dominio de fallback arbitrario', () => {
  assert.match(routeSource, /crearUrlApp\('\/suscripcion'\)/);
  assert.doesNotMatch(routeSource, /https:\/\/downtimeos\.com/);
});

test('las reservas recuperan leases vencidos con adquisición atómica y fencing token', () => {
  for (const sql of [leaseMigration, leaseManualSql]) {
    assert.match(sql, /add column if not exists lease_until timestamptz/i);
    assert.match(sql, /add column if not exists lease_token uuid/i);
    assert.match(sql, /on conflict\s*\(suscripcion_id,tipo\) do update/i);
    assert.match(sql, /estado='error'[\s\S]*estado='procesando'[\s\S]*lease_until\s*<=\s*v_ahora/i);
    assert.match(sql, /lease_token=gen_random_uuid\(\)/i);
    assert.match(sql, /returning lease_token into v_token/i);
    assert.match(sql, /interval '2 minutes'/i);
    assert.match(sql, /grant execute on function public\.organizacion_reservar_aviso_suscripcion[\s\S]*to service_role/i);
  }
  assert.match(routeSource, /\.eq\('lease_token', tokenReserva\)/g);
  assert.match(routeSource, /suscripcion\/\$\{s\.id\}\/\$\{item\.tipo\}/);
  assert.match(routeSource, /'Idempotency-Key': llave/);
});

test('consulta ventanas elegibles directamente: 500 vencimientos fuera de ventana no esconden los elegibles', async () => {
  const ahora = new Date('2026-09-30T12:00:00.000Z');
  const ventanas = ventanasAvisoVencimiento(ahora);
  const consultas = [];
  let ventanaActual;

  const cliente = {
    from(tabla) {
      assert.equal(tabla, 'organizacion_suscripciones');
      const estado = { filtros: {}, orden: [], limite: null };
      const consulta = {
        select() { return consulta; },
        in(campo, valor) { estado.filtros[campo] = valor; return consulta; },
        gt(campo, valor) { estado.filtros[`gt_${campo}`] = valor; return consulta; },
        gte(campo, valor) { estado.filtros[`gte_${campo}`] = valor; return consulta; },
        lte(campo, valor) { estado.filtros[`lte_${campo}`] = valor; return consulta; },
        order(campo, opciones) { estado.orden.push([campo, opciones]); return consulta; },
        limit(valor) { estado.limite = valor; return consulta; },
        or(filtro) { estado.cursor = filtro; return consulta; },
        then(resolve, reject) {
          consultas.push(estado);
          const desde = estado.filtros.gte_termina_en;
          ventanaActual = ventanas.find((v) => v.desde === desde);
          const id = ventanaActual.tipo === '1_dia' ? 'elegible-1' : 'elegible-7';
          const data = [{ id, termina_en: ventanaActual.desde, organizacion_id: `org-${id}`, plan_codigo: 'basico', periodicidad: 'mensual' }];
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return consulta;
    },
  };

  // Modela el antiguo conjunto amplio: 500 filas no elegibles aparecen antes
  // en el orden temporal. La implementación debe filtrar en SQL, no truncarlo.
  const universoAnterior = Array.from({ length: 500 }, (_, i) => ({
    termina_en: new Date(ahora.getTime() + (2 + i / 1000) * 24 * hora).toISOString(),
  }));
  const fueraDeVentana = universoAnterior.filter((s) => !ventanas.some((v) => s.termina_en >= v.desde && s.termina_en <= v.hasta));
  assert.equal(fueraDeVentana.length, 500);

  const { pendientes, error, truncado } = await cargarAvisosElegibles(ahora.toISOString(), Date.now(), cliente);

  assert.equal(error, undefined);
  assert.equal(truncado, false);
  assert.deepEqual(pendientes.map(({ tipo }) => tipo), ['1_dia', '7_dias']);
  assert.equal(consultas.length, 2);
  for (const consulta of consultas) {
    assert.equal(consulta.limite, 200);
    assert.ok(consulta.filtros.gte_termina_en);
    assert.ok(consulta.filtros.lte_termina_en);
    assert.deepEqual(consulta.orden.map(([campo]) => campo), ['termina_en', 'id']);
  }
});
