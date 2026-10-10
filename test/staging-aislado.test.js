import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const leer = async (ruta) => (await readFile(new URL(ruta, import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const compose = await leer('../docker-compose.staging.yml');
const caddy = await leer('../deploy/staging/Caddyfile');
const plantilla = await leer('../deploy/staging/env.example');
const guia = await leer('../docs/STAGING.md');

test('HIST-14: el staging solo publica HTTPS y el SMTP autenticado del buzón', () => {
  const publicados = [...compose.matchAll(/^\s+- "(\d+):(\d+)"$/gm)].map((m) => `${m[1]}:${m[2]}`);
  assert.deepEqual(publicados.sort(), ['443:443', '587:1025', '80:80']);
  assert.doesNotMatch(compose, /5432[1-4]|:5432\b|8025:/);
  const app = compose.slice(compose.indexOf('  downtimeos:'), compose.indexOf('  caddy:'));
  assert.doesNotMatch(app, /\n\s+ports:/);
  assert.match(app, /expose:\n\s+- "3000"/);
});

test('HIST-14: el buzón de pruebas exige contraseña y STARTTLS', () => {
  assert.match(compose, /MP_UI_AUTH: \$\{MAILPIT_UI_USER:\?[^}]+\}:\$\{MAILPIT_UI_PASSWORD:\?[^}]+\}/);
  assert.match(compose, /MP_SMTP_AUTH: \$\{MAILPIT_SMTP_USER:\?[^}]+\}:\$\{MAILPIT_SMTP_PASSWORD:\?[^}]+\}/);
  assert.match(compose, /MP_SMTP_REQUIRE_STARTTLS: "true"/);
  assert.doesNotMatch(compose, /ALLOW_INSECURE|ACCEPT_ANY/);
});

test('HIST-14: Caddy sirve la app y el buzón por dominio, sin indexación ni basic auth en la app', () => {
  assert.match(caddy, /\{\$STAGING_DOMAIN\} \{[\s\S]*?noindex[\s\S]*?reverse_proxy downtimeos:3000/);
  assert.match(caddy, /\{\$STAGING_MAIL_DOMAIN\} \{[\s\S]*?reverse_proxy mailpit:8025/);
  // La API usa Authorization: Bearer; un basic auth delante la rompería.
  assert.doesNotMatch(caddy, /basic_?auth/);
});

test('HIST-14: la plantilla no trae secretos y deja apagadas las integraciones externas', () => {
  for (const nombre of ['SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'DASHBOARD_ADMIN_PASSWORD', 'MAILPIT_UI_PASSWORD', 'MAILPIT_SMTP_PASSWORD', 'CRON_SECRET', 'META_WHATSAPP_ACCESS_TOKEN', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'RESEND_API_KEY']) {
    assert.match(plantilla, new RegExp(`^${nombre}=$`, 'm'), `${nombre} debe ir vacío`);
  }
  assert.match(plantilla, /^WHATSAPP_ALERTAS_ACTIVAS=false$/m);
  assert.match(plantilla, /^WHATSAPP_APROBACIONES_ACTIVAS=false$/m);
  assert.doesNotMatch(plantilla, /localhost|host\.docker\.internal|supabase\.co/);
});

test('la guía de staging identifica Azure como destino pendiente y mantiene los datos aislados', () => {
  assert.match(guia, /Azure Container Apps/);
  assert.match(guia, /Proyecto Supabase \*\*exclusivo de staging\*\*/);
  assert.match(guia, /Nunca reutilizar producción ni Supabase Local/);
  assert.match(guia, /no se deben\s+abrir puertos de Supabase de una PC/);
  assert.match(guia, /DEPLOY-AZURE\.md/);
});
