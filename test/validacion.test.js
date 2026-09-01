/**
 * Pruebas de las reglas de validación (RF-03).
 *   npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validarLead, ErrorValidacion, normalizarTelefono, limpiarTexto,
  normalizarOrigen, estatusDeOrigen, dominioDe,
} from '../lib/validacion.js';

const base = {
  nombre: 'Rodrigo Alanís',
  empresa: 'Maquinados CNC Treviño',
  email: 'rodrigo@cnctrevino.com.mx',
  telefono: '8711234567',
};

function errorDe(payload, origen = 'CALCULADORA') {
  try {
    validarLead(payload, origen);
    return null;
  } catch (e) {
    assert.ok(e instanceof ErrorValidacion);
    assert.equal(e.status, 400);
    return e.errores;
  }
}

test('acepta un lead corporativo completo', () => {
  const r = validarLead(base, 'CALCULADORA');
  assert.equal(r.email, 'rodrigo@cnctrevino.com.mx');
  assert.equal(r.telefono, '8711234567');
  assert.equal(r.puesto, 'No especificado');
  assert.equal(r.utm.utm_campaign, 'margen-oculto-2026');
});

test('rechaza dominios públicos (regla B2B)', () => {
  for (const dominio of ['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com.mx', 'proton.me']) {
    const errores = errorDe({ ...base, email: `alguien@${dominio}` });
    assert.match(errores.email, /corporativo/);
  }
});

test('acepta dominios corporativos parecidos a los bloqueados', () => {
  // `mail.com` está bloqueado pero `mail.com.mx` no debe confundirse con él.
  assert.doesNotThrow(() => validarLead({ ...base, email: 'a@mail.com.mx' }, 'CALCULADORA'));
  assert.doesNotThrow(() => validarLead({ ...base, email: 'a@notgmail.com' }, 'CALCULADORA'));
});

test('reporta todos los campos malos de una vez', () => {
  const errores = errorDe({ nombre: 'Jo', empresa: '', email: 'pepe@gmail.com', telefono: '12345' });
  assert.deepEqual(Object.keys(errores).sort(), ['email', 'empresa', 'nombre', 'telefono']);
});

test('normaliza teléfonos con lada +52, espacios y guiones', () => {
  assert.equal(normalizarTelefono('+52 844 123 4567'), '8441234567');
  assert.equal(normalizarTelefono('(871) 200-3400'), '8712003400');
  assert.equal(normalizarTelefono('521 555 123 4567'), '5551234567');
  assert.equal(normalizarTelefono('8711234567'), '8711234567');
  assert.equal(normalizarTelefono(''), '');
});

test('exige ciudad solo en el formulario de auditoría', () => {
  assert.ok(errorDe({ ...base }, 'AUDITORIA').ciudad);
  assert.equal(errorDe({ ...base, ciudad: 'Torreón' }, 'AUDITORIA'), null);
  assert.equal(errorDe({ ...base }, 'CALCULADORA'), null);
});

test('sanea espacios, mayúsculas del correo y trunca notas largas', () => {
  const r = validarLead({
    ...base, nombre: '  Ana   Sofía  ', email: '  ANA@ACME.MX ', notas: 'x'.repeat(600),
  }, 'CALCULADORA');
  assert.equal(r.nombre, 'Ana Sofía');
  assert.equal(r.email, 'ana@acme.mx');
  assert.equal(r.notas.length, 500);
});

test('interpreta cifras con comas y signo de peso', () => {
  const r = validarLead({ ...base, tarifa_hora: '$1,500', maquinas: ' 8 ' }, 'CALCULADORA');
  assert.equal(r.tarifa_hora, 1500);
  assert.equal(r.maquinas, 8);
});

test('rechaza cuerpos que no son objeto JSON', () => {
  for (const basura of ['texto', [1, 2], null, 42]) {
    assert.throws(() => validarLead(basura, 'CALCULADORA'), ErrorValidacion);
  }
});

test('el estatus se deriva del origen y nunca del cliente', () => {
  assert.equal(estatusDeOrigen(normalizarOrigen('AUDITORIA')), 'AUDITORIA_SOLICITADA');
  assert.equal(estatusDeOrigen(normalizarOrigen('CALCULADORA')), 'NUEVO');
  // Cualquier valor inventado cae al camino seguro.
  assert.equal(normalizarOrigen('ADMIN'), 'CALCULADORA');
  assert.equal(normalizarOrigen(undefined), 'CALCULADORA');
});

test('helpers de texto', () => {
  assert.equal(limpiarTexto(null), '');
  assert.equal(limpiarTexto('  a   b  '), 'a b');
  assert.equal(dominioDe('a@ACME.mx'), 'acme.mx');
});
