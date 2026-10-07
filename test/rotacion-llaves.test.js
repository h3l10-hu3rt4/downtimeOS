import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const leer = async (ruta) => (await readFile(new URL(ruta, import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const verificador = await leer('../scripts/verificar-llaves.mjs');
const gitignore = await leer('../.gitignore');
const dockerignore = await leer('../.dockerignore');

test('HIST-11: ningún archivo .env con valores puede subirse al repo ni a la imagen', () => {
  assert.match(gitignore, /^\.env\*$/m);
  assert.match(dockerignore, /^\.env\*$/m);
});

test('HIST-11: el verificador de llaves nunca imprime valores y solo consulta', () => {
  // Toda la salida pasa por linea(); sus textos solo interpolan nombres, estados y códigos HTTP.
  const salidas = [...verificador.matchAll(/console\.log\(([^\n]*)\)/g)].map((m) => m[1]);
  assert.ok(salidas.length > 0);
  for (const salida of salidas) assert.doesNotMatch(salida, /actual\[|anterior\[|env\.|\bvalor\b/);
  for (const texto of [...verificador.matchAll(/linea\([^\n]*\)/g)].map((m) => m[0])) {
    assert.doesNotMatch(texto, /\$\{(actual|anterior)\[[^\]]+\]\}|\$\{env\.[A-Z_]+\}/, texto);
  }
  assert.doesNotMatch(verificador, /method:\s*'(POST|PUT|PATCH|DELETE)'/);
  assert.doesNotMatch(verificador, /\/messages\b/);
});

test('HIST-11: el verificador comprueba que la llave anterior quedó revocada', () => {
  assert.match(verificador, /TODAVÍA FUNCIONA, falta revocarla/);
  assert.match(verificador, /SIGUE IGUAL, no se rotó/);
  assert.match(verificador, /createHash\('sha256'\)/);
});
