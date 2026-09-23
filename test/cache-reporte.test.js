import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearReporte } from '../lib/integraciones.js';

/**
 * `crearReporte` habla con Supabase real (IA + Storage + Postgres), así que
 * igual que el resto de las pruebas de integraciones.js que dependen de un
 * proveedor externo, se verifica la lógica por su código fuente en vez de
 * levantar un backend falso — mismo criterio que ya usan las pruebas de
 * `enviarSolicitudAprobacion` y `generarAnalisis` en whatsapp-plantillas.test.js.
 */
test('crearReporte reutiliza un reporte reciente antes de generar uno nuevo', () => {
  const fuente = crearReporte.toString();
  assert.match(fuente, /reporteCacheadoReciente\(desde, hasta\)/);
  assert.match(fuente, /if \(cacheado\) return cacheado/);
});

test('la ventana de caché del reporte es de 5 minutos', async () => {
  const fuente = await import('node:fs/promises')
    .then(({ readFile }) => readFile(new URL('../lib/integraciones.js', import.meta.url), 'utf8'));
  assert.match(fuente, /const CACHE_REPORTE_MS = 5 \* 60 \* 1000;/);
  // El filtro de frescura y el de periodo deben ir juntos: sin ellos, cualquier
  // reporte viejo del mismo (desde, hasta) se reutilizaría para siempre.
  assert.match(fuente, /gte\('created_at', new Date\(Date\.now\(\) - CACHE_REPORTE_MS\)\.toISOString\(\)\)/);
  assert.match(fuente, /consulta\.eq\('desde', desde\) : consulta\.is\('desde', null\)/);
  assert.match(fuente, /consulta\.eq\('hasta', hasta\) : consulta\.is\('hasta', null\)/);
});
