import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function cargarDatos() {
  const almacenamiento = new Map();
  const ventana = {
    localStorage: {
      getItem: (clave) => almacenamiento.get(clave) ?? null,
      setItem: (clave, valor) => almacenamiento.set(clave, valor),
      removeItem: (clave) => almacenamiento.delete(clave),
    },
    console,
    Date,
    Promise,
  };
  ventana.window = ventana;
  vm.runInNewContext(fs.readFileSync('public/demo/js/datos.js', 'utf8'), {
    window: ventana, console, Date, Promise, Math, JSON, setTimeout, clearTimeout,
  });
  return ventana.DowntimeCO;
}

function estadosOperando(D) {
  return Object.fromEntries(D.ACTIVOS.map((a) => [a.id, {
    estado: 'RUN', desde: new Date().toISOString(), causa: null,
  }]));
}

test('capacidad por etapa: único 0%, dos 50% y tres 67%', () => {
  const D = cargarDatos();
  const estados = estadosOperando(D);

  estados['M-01'].estado = 'STOP';
  assert.equal(D.capacidadDisponibleDeLinea('L-01', estados), 0.5);

  estados['M-01'].estado = 'RUN';
  estados['H-01'].estado = 'STOP';
  assert.equal(D.capacidadDisponibleDeLinea('L-01', estados), 2 / 3);

  estados['H-01'].estado = 'RUN';
  estados['K-01'].estado = 'STOP';
  assert.equal(D.capacidadDisponibleDeLinea('L-02', estados), 0);
});

test('la tarifa aplica la misma fracción de capacidad que muestra Supervisión', () => {
  const D = cargarDatos();
  assert.equal(D.tarifaAplicable('M-01'), D.tarifaLinea('L-01') * 0.5);
  assert.equal(D.tarifaAplicable('H-01'), D.tarifaLinea('L-01') / 3);
  assert.equal(D.tarifaAplicable('K-01'), D.tarifaLinea('L-02'));
});
