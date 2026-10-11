import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const config = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
const launcher = readFileSync(new URL('../scripts/supabase-local.ps1', import.meta.url), 'utf8');
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

test('Supabase Auth local usa Mailpit y Resend se reserva para producción', () => {
  assert.match(config, /\[local_smtp\][\s\S]*?enabled\s*=\s*true/);
  assert.doesNotMatch(config, /\[auth\.email\.smtp\]/);
  assert.doesNotMatch(config, /env\(MAIL_|smtp\.resend\.com/);
  assert.doesNotMatch(launcher, /MAIL_|RESEND_API_KEY|smtp\.resend\.com/);
  assert.match(launcher, /\$salida = & npx --yes supabase start/);
  assert.match(launcher, /Se ocultó su salida para evitar imprimir llaves locales/);
  assert.doesNotMatch(launcher, /Write-Output \$salida/);
  assert.match(readme, /Resend se\s+configura solo para producción/);
});
