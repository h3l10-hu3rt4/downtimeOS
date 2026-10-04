import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  MAX_COMPROBANTE_BYTES,
  validarArchivoComprobante,
} from '../api/planta/suscripcion.js';

const sql = await readFile(new URL('../supabase/migrations/20261002000100_comprobantes.sql', import.meta.url), 'utf8');
const sqlExclusivo = await readFile(new URL('../supabase/migrations/20261004000500_comprobantes-intento-unico.sql', import.meta.url), 'utf8');
const customerApi = await readFile(new URL('../api/planta/suscripcion.js', import.meta.url), 'utf8');
const adminApi = await readFile(new URL('../api/administracion/suscripciones.js', import.meta.url), 'utf8');
const customerUi = await readFile(new URL('../app/suscripcion/page.js', import.meta.url), 'utf8');
const adminUi = await readFile(new URL('../app/administracion/suscripciones/panel.js', import.meta.url), 'utf8');

test('valida tamaño y MIME permitidos del comprobante', () => {
  assert.equal(MAX_COMPROBANTE_BYTES, 10 * 1024 * 1024);
  for (const tipo of ['application/pdf', 'image/jpeg', 'image/png']) {
    assert.doesNotThrow(() => validarArchivoComprobante(tipo, 1));
    assert.doesNotThrow(() => validarArchivoComprobante(tipo, MAX_COMPROBANTE_BYTES));
  }
  assert.throws(() => validarArchivoComprobante('image/svg+xml', 20), { status: 415 });
  assert.throws(() => validarArchivoComprobante('application/pdf', 0), { status: 413 });
  assert.throws(() => validarArchivoComprobante('application/pdf', MAX_COMPROBANTE_BYTES + 1), { status: 413 });
});

test('comprueba firma binaria y no confía solo en el MIME declarado', () => {
  const pdf = validarArchivoComprobante('application/pdf', 5);
  assert.equal(pdf.validarFirma(Buffer.from('%PDF-')), true);
  assert.equal(pdf.validarFirma(Buffer.from('hello')), false);
  const jpeg = validarArchivoComprobante('image/jpeg', 3);
  assert.equal(jpeg.validarFirma(Buffer.from([0xff, 0xd8, 0xff])), true);
  const png = validarArchivoComprobante('image/png', 8);
  assert.equal(png.validarFirma(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), true);
});

test('usa bucket privado y enlaza los intentos con tenant, suscripción, pago y actor', () => {
  assert.match(sql, /values \('comprobantes-suscripcion',[\s\S]*?false, 10485760/);
  assert.match(sql, /allowed_mime_types[\s\S]*?application\/pdf[\s\S]*?image\/jpeg[\s\S]*?image\/png/);
  assert.match(sql, /organizacion_id uuid not null references public\.organizaciones/);
  assert.match(sql, /suscripcion_id uuid not null references public\.organizacion_suscripciones/);
  assert.match(sql, /pago_id uuid not null references public\.organizacion_pagos/);
  assert.match(sql, /usuario_id uuid not null references auth\.users/);
  assert.match(sql, /storage_path text not null unique/);
  assert.match(sql, /revoke all on public\.organizacion_pago_comprobante_intentos from public, anon, authenticated/);
  assert.match(sql, /organizacion_pago_crear_comprobante_intento[\s\S]*?pago\.estado<>'pendiente'[\s\S]*?p_storage_path !~/);
  assert.match(sqlExclusivo, /create unique index if not exists organizacion_pago_comprobante_un_intento_pendiente_idx[\s\S]*?on public\.organizacion_pago_comprobante_intentos\(pago_id\)[\s\S]*?where estado='carga_pendiente'/);
});

test('subida solo crea intent; finalización valida bytes y marca recibido, nunca verificado', () => {
  assert.match(customerApi, /permisoEdicion\(sesion\)/);
  assert.match(customerApi, /createSignedUploadUrl\(storagePath, \{ upsert: false \}\)/);
  assert.match(customerApi, /download\(intento\.storage_path\)/);
  assert.match(customerApi, /contenido\.length !== Number\(intento\.size_bytes\)/);
  assert.match(customerApi, /firmaComprobanteValida\(intento\.content_type, contenido\)/);
  assert.match(customerApi, /try \{ validarArchivoComprobante\(intento\.content_type, contenido\.length\); \}[\s\S]*?catch \(error\) \{[\s\S]*?storage\.from\(BUCKET_COMPROBANTES\)\.remove\(\[intento\.storage_path\]\)[\s\S]*?\.delete\(\)\.eq\('id', intento\.id\)\.eq\('estado', 'carga_pendiente'\)[\s\S]*?return json\(res, error\.status \|\| 400/);
  assert.match(customerApi, /organizacion_pago_confirmar_comprobante/);
  assert.match(customerApi, /Date\.now\(\) - Date\.parse\(intento\.created_at\) > 20 \* 60 \* 1000[\s\S]*?storage\.from\(BUCKET_COMPROBANTES\)\.remove\(\[intento\.storage_path\]\)[\s\S]*?\.delete\(\)\.eq\('id', intento\.id\)/);
  assert.match(customerApi, /\.lt\('created_at', limiteIntento\)[\s\S]*?remove\(obsoletos\.map[\s\S]*?\.delete\(\)\.in\('id', obsoletos\.map[\s\S]*?const id = randomUUID\(\)/);
  assert.match(sql, /update public\.organizacion_pagos set estado='comprobante_recibido',comprobante_path=i\.storage_path/);
  assert.doesNotMatch(sql.match(/create or replace function public\.organizacion_pago_confirmar_comprobante[\s\S]*?revoke all on function public\.organizacion_pago_confirmar_comprobante/)[0], /estado='verificado'/);
});

test('el admin recibe enlaces firmados breves; la carga del cliente usa bytes directos', () => {
  assert.match(adminApi, /exigirSesionAdministrador\(req\)/);
  assert.match(adminApi, /createSignedUrl\(fila\.storage_path, 180\)/);
  assert.match(adminApi, /comprobante_pago_enlace_temporal/);
  assert.match(adminApi, /delete pago\.comprobante_path|comprobante_path: _pathInterno/);
  assert.match(customerUi, /uploadToSignedUrl\(intento\.path, intento\.token, archivo/);
  assert.match(customerUi, /finalizar_comprobante/);
  assert.match(adminUi, /rechazar_comprobante/);
  assert.match(adminUi, /Abrir enlace seguro temporal/);
});

test('si falla la recarga después de recibir el comprobante, no se comunica como fallo de subida', () => {
  assert.match(customerUi, /setEstado\(resultado\.mensaje \|\| 'Comprobante recibido para revisión\.'\);\s*try \{\s*await cargar\(token, plantaId\);\s*\} catch \{\s*setEstado\('El comprobante se recibió correctamente, pero no pudimos actualizar esta pantalla\.[\s\S]*?no vuelvas a subir el archivo\.'\);\s*\}/);
});

test('el revisor puede rechazar solo el comprobante, y activar admite comprobante u OC sin archivo', () => {
  assert.match(sql, /p_accion not in \('activar','piloto','rechazar','rechazar_comprobante'\)/);
  assert.match(sql, /estado in \('pendiente','comprobante_recibido'\)[\s\S]*?for update/);
  assert.match(sql, /when p_accion='rechazar_comprobante' then 'comprobante_pago_rechazado'/);
  assert.match(sql, /update public\.organizacion_pagos set estado='pendiente',comprobante_path=null,recibido_en=null/);
  assert.match(sql, /update public\.organizacion_pagos set estado='verificado'/);
  assert.match(adminApi, /'rechazar_comprobante'/);
});
