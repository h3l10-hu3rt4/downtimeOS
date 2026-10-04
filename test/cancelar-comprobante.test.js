import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const leer = (ruta) => readFile(new URL(`../${ruta}`, import.meta.url), 'utf8');

test('cancelar pago anula el comprobante en la misma transacción y mantiene disponible el historial', async () => {
  const [sql, cliente, admin, ui] = await Promise.all([
    leer('supabase/migrations/20261003001000_anular_comprobante_al_cancelar.sql'),
    leer('api/planta/suscripcion.js'),
    leer('api/administracion/suscripciones.js'),
    leer('app/suscripcion/page.js'),
  ]);
  assert.equal((sql.match(/estado='anulado',reviewed_at=now\(\),reviewed_by='Sistema'/g) || []).length, 2,
    'anula comprobantes tanto de solicitudes nuevas como de renovaciones futuras');
  assert.match(sql, /estado in \('carga_pendiente','recibido','verificado','rechazado','anulado'\)/);
  assert.match(cliente, /\['recibido', 'verificado', 'rechazado', 'anulado'\]/);
  assert.match(admin, /\['recibido', 'verificado', 'rechazado', 'anulado'\]/);
  assert.match(ui, /anulado: 'anulado al cancelar el pago'/);
});
