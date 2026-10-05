import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const config = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
const launcher = readFileSync(new URL('../scripts/supabase-local.ps1', import.meta.url), 'utf8');
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

test('Supabase Auth siempre enruta el correo local a Mailpit; Resend queda pendiente', () => {
  assert.match(config, /\[auth\.email\.smtp\]/);
  for (const variable of ['MAIL_HOST', 'MAIL_PORT', 'MAIL_USERNAME', 'MAIL_PASSWORD', 'MAIL_FROM_ADDRESS', 'MAIL_FROM_NAME']) {
    assert.ok(config.includes(`env(${variable})`), `${variable} debe venir del entorno`);
  }
  assert.match(launcher, /MAIL_HOST\s*=\s*'inbucket'/);
  assert.match(launcher, /MAIL_PORT\s*=\s*'2500'/);
  assert.match(launcher, /Ignore \.env\.local and inherited SMTP/);
  assert.doesNotMatch(launcher, /smtp\.resend\.com|RESEND_API_KEY/);
  assert.match(readme, /Resend y la\s+entrega a Gmail\/Outlook quedan pendientes/);
});
