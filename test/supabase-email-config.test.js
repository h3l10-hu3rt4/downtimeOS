import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const config = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
const launcher = readFileSync(new URL('../scripts/supabase-local.ps1', import.meta.url), 'utf8');
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

test('Supabase Auth SMTP uses env vars and retains Mailpit defaults locally', () => {
  assert.match(config, /\[auth\.email\.smtp\]/);
  for (const variable of ['MAIL_HOST', 'MAIL_PORT', 'MAIL_USERNAME', 'MAIL_PASSWORD', 'MAIL_FROM_ADDRESS', 'MAIL_FROM_NAME']) {
    assert.ok(config.includes(`env(${variable})`), `${variable} debe venir del entorno`);
    assert.ok(launcher.includes(variable), `${variable} debe leerse en el lanzador local`);
  }
  assert.match(launcher, /MAIL_HOST\s*=\s*'inbucket'/);
  assert.match(launcher, /MAIL_PORT\s*=\s*'2500'/);
  assert.match(launcher, /smtp\.resend\.com/);
  assert.match(launcher, /MAIL_PORT.*465.*587/);
  assert.match(launcher, /requiredResendVariables/);
  assert.match(launcher, /No iniciaré el envío/);
  assert.match(readme, /dominio verificado/);
  assert.match(readme, /RESEND_API_KEY.*no configura este flujo/);
});
