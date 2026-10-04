import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ui = await readFile(new URL('../app/equipo/page.js', import.meta.url), 'utf8');
const api = await readFile(new URL('../api/planta/equipo.js', import.meta.url), 'utf8');

test('la interfaz reserva al titular la asignación de Finanzas y facturación', () => {
  assert.equal((ui.match(/permisos\.es_propietario \? <option value="finanzas">Finanzas<\/option> : null/g) || []).length, 2,
    'el rol Finanzas solo aparece para el titular, al invitar y al editar');
  assert.equal((ui.match(/permisos\.es_propietario \? <label><input[^\n]*name="administrar_facturacion"/g) || []).length, 1,
    'la casilla de facturación al editar solo aparece para el titular');
  assert.match(ui, /permisos\.es_propietario \? <label className="onboarding-check"><input name="administrar_facturacion"/,
    'la invitación solo ofrece conceder facturación al titular');
  assert.match(ui, /defaultValue=\{!permisos\.es_propietario && \['direccion', 'finanzas'\]\.includes\(i\.rol\) \? '' : i\.rol\}/,
    'un delegado debe elegir explícitamente un rol ordinario para cambiar Dirección o Finanzas');
  assert.match(ui, /!permisos\.es_propietario && i\.rol === 'direccion' \? <option value="" disabled>Dirección \(solo titular; selecciona otra función\)<\/option>/,
    'el delegado no debe poder seleccionar Dirección al editar permisos');
  assert.match(ui, /permisos\.es_propietario \? <option value="direccion">Dirección<\/option> : null/,
    'solo el titular ve Dirección como opción de cambio de rol');
  assert.match(ui, /puedeVerFacturacion \? <a href="\/suscripcion"/,
    'el enlace a suscripción se limita a titular o permiso explícito');
});

test('el selector de rol al editar permisos tiene un nombre accesible por usuario', () => {
  assert.match(ui, /<select name="rol" aria-label=\{`Función de \$\{i\.nombre\}`\}/,
    'el lector de pantalla debe anunciar qué función se está editando y de quién');
});

test('delegados conservan controles ordinarios y los cambios de rol omiten facturación sin revocarla', () => {
  assert.match(ui, /permisos\.es_propietario && i\.estado === 'aceptada'[\s\S]*?Delegar administración/,
    'la delegación sigue reservada al titular');
  assert.match(ui, /actuar\(i\.id, 'reenviar'\)/);
  assert.match(ui, /actuar\(i\.id, 'revocar'\)/,
    'el delegado conserva controles válidos de gestión de invitaciones y miembros');
  assert.match(api, /cuerpo\.administrar_facturacion === undefined[\s\S]*?invitacion\.puede_administrar_facturacion === true/,
    'si el delegado no recibe un control financiero, el servidor preserva el permiso ya asignado');
  assert.match(api, /cuerpo\.administrar_facturacion === true && invitacion\.puede_administrar_facturacion !== true/,
    'el servidor sigue bloqueando una nueva concesión de facturación a delegados');
});
