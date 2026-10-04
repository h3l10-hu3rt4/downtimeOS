import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const compose = await readFile(new URL('../docker-compose.yml', import.meta.url), 'utf8');
const composeProduccion = await readFile(new URL('../docker-compose.production.yml', import.meta.url), 'utf8');
const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
const dockerignore = await readFile(new URL('../.dockerignore', import.meta.url), 'utf8');
const smoke = await readFile(new URL('../scripts/smoke-next.mjs', import.meta.url), 'utf8');
const environment = await readFile(new URL('../lib/entorno.js', import.meta.url), 'utf8');
const dockerLocal = await readFile(new URL('../scripts/docker-local.ps1', import.meta.url), 'utf8');

test('Dockerfile y Compose consideran saludable la app solo si responde la comprobación de persistencia', () => {
  assert.match(dockerfile, /HEALTHCHECK[\s\S]*?\/api\/health/);
  assert.match(compose, /healthcheck:[\s\S]*?\/api\/health/);
  assert.match(composeProduccion, /healthcheck:[\s\S]*?\/api\/health/);
  assert.doesNotMatch(dockerfile, /\/api\/config/);
  assert.doesNotMatch(compose, /\/api\/config/);
  assert.doesNotMatch(composeProduccion, /\/api\/config/);
});

test('Compose local solo publica el servidor en loopback por defecto', () => {
  assert.match(compose, /ports:\s*\n\s*-\s*"127\.0\.0\.1:3000:3000"/);
});

test('Compose local no hereda secretos de .env.local y deja las integraciones externas desactivadas', () => {
  assert.doesNotMatch(compose, /env_file\s*:/);
  assert.match(compose, /WHATSAPP_ALERTAS_ACTIVAS:\s*\$\{DOWNTIMEOS_LOCAL_WHATSAPP_ALERTAS_ACTIVAS:-false\}/);
  assert.match(compose, /WHATSAPP_APROBACIONES_ACTIVAS:\s*\$\{DOWNTIMEOS_LOCAL_WHATSAPP_APROBACIONES_ACTIVAS:-false\}/);
  assert.match(compose, /WHATSAPP_META_USE_TEMPLATES:\s*\$\{DOWNTIMEOS_LOCAL_WHATSAPP_META_USE_TEMPLATES:-false\}/);
  assert.match(compose, /META_WHATSAPP_ACCESS_TOKEN:\s*\$\{DOWNTIMEOS_LOCAL_META_WHATSAPP_ACCESS_TOKEN:-\}/);
  assert.match(compose, /RESEND_API_KEY:\s*\$\{DOWNTIMEOS_LOCAL_RESEND_API_KEY:-\}/);
  assert.match(compose, /GEMINI_API_KEY:\s*\$\{DOWNTIMEOS_LOCAL_GEMINI_API_KEY:-\}/);
  assert.match(compose, /ANTHROPIC_API_KEY:\s*\$\{DOWNTIMEOS_LOCAL_ANTHROPIC_API_KEY:-\}/);
});

test('el contexto de build Docker excluye todas las variantes de dotenv', () => {
  assert.match(dockerignore, /^\.env\*$/m);
});

test('el lanzador local restaura las variables previas de PowerShell al terminar', () => {
  assert.match(dockerLocal, /GetEnvironmentVariable\(\$nombre, 'Process'\)/);
  assert.match(dockerLocal, /SetEnvironmentVariable\(\$nombre, \$valorAnterior, 'Process'\)/);
  assert.match(dockerLocal, /\[switch\]\$WhatsAppDesdeEnvLocal/);
  assert.match(dockerLocal, /\[switch\]\$IADesdeEnvLocal/);
  assert.match(dockerLocal, /\[switch\]\$AdminDesdeEnvLocal/);
  assert.match(dockerLocal, /if \(\$WhatsAppDesdeEnvLocal -and -not \$isDefaultUp\)/);
  assert.match(dockerLocal, /if \(\$IADesdeEnvLocal -and -not \$isDefaultUp\)/);
  assert.match(dockerLocal, /if \(\$AdminDesdeEnvLocal -and -not \$isDefaultUp\)/);
  assert.match(dockerLocal, /DASHBOARD_ADMIN_EMAIL\|DASHBOARD_ADMIN_PASSWORD/);
  assert.match(dockerLocal, /DOWNTIMEOS_LOCAL_DASHBOARD_ADMIN_EMAIL', 'DOWNTIMEOS_LOCAL_DASHBOARD_ADMIN_PASSWORD/);
  assert.match(dockerLocal, /if \(\$isDefaultUp -and -not \$tieneAdminEmail\)/);
  assert.match(dockerLocal, /\$clavesWhatsAppPermitidas/);
  assert.match(dockerLocal, /\$clavesIALocal/);
  assert.match(dockerLocal, /AI_FINANZAS_PROVIDER/);
  assert.match(dockerLocal, /AI_OPERACIONES_PROVIDER/);
  assert.match(dockerLocal, /Falta \$llave para el proveedor configurado/);
  assert.match(dockerLocal, /DOWNTIMEOS_LOCAL_\$_/);
  assert.match(dockerLocal, /DOWNTIMEOS_LOCAL_\$_/);
  assert.match(dockerLocal, /META_WHATSAPP_WEBHOOK_SECRET/);
  assert.match(dockerLocal, /META_WHATSAPP_ACCESS_TOKEN/);
  assert.match(dockerLocal, /No iniciaré el contenedor/);
  assert.doesNotMatch(dockerLocal, /env_file\s*:/);
});

test('el lanzador local no selecciona automáticamente un Supabase histórico', () => {
  assert.match(dockerLocal, /\$repoRoot = \(Resolve-Path \(Join-Path \$PSScriptRoot '\.\.'\)\)\.Path/);
  assert.match(dockerLocal, /Get-SupabaseLocalStatus \$repoRoot/);
  assert.match(dockerLocal, /Get-SupabaseLocalStatus \$legacyWorkdir/);
  assert.match(dockerLocal, /Solo encontré el Supabase histórico/);
  assert.match(dockerLocal, /-SupabaseWorkdir/);
  assert.doesNotMatch(dockerLocal, /\$SupabaseWorkdir\s*=\s*\$legacyWorkdir/);
  assert.match(dockerLocal, /\$apiPort = \$uri\.Port/);
  assert.match(dockerLocal, /host\.docker\.internal:\$apiPort/);
  assert.match(dockerLocal, /localhost:\$apiPort/);
  assert.doesNotMatch(dockerLocal, /\$uri\.Port -ne 54321/);
  assert.match(dockerLocal, /La app se conectará a esta base local existente/);
  assert.match(dockerLocal, /\$isDefaultUp/);
  assert.match(dockerLocal, /\$isReadOnlyPs/);
  assert.match(dockerLocal, /ComposeArgs solo admite/);
  assert.match(dockerLocal, /no ejecutará stop, down, rm, prune/);
  assert.match(dockerLocal, /DOWNTIMEOS_LOCAL_DASHBOARD_ADMIN_EMAIL/);
  assert.match(dockerLocal, /DOWNTIMEOS_LOCAL_DASHBOARD_ADMIN_PASSWORD/);
  assert.match(dockerLocal, /La aprobación administrativa de pagos no estará disponible/);
  assert.match(dockerLocal, /\[string\]\$SupabaseWorkdir,/);
  assert.match(dockerLocal, /No encontré Supabase Local activo\. Inícialo desde el proyecto con: npx supabase start/);
  assert.doesNotMatch(dockerLocal, /&\s+npx\s+--yes\s+supabase\s+(start|stop|db\s+reset)/i);
  assert.match(dockerLocal, /& docker compose @composeArguments/);
});

test('el servidor temporal de smoke no carga .env.local ni hereda credenciales externas', () => {
  assert.doesNotMatch(smoke, /--env-file(?:-if-exists)?=\.env/);
  assert.match(smoke, /DOWNTIMEOS_DISABLE_DOTENV:\s*'1'/);
  assert.match(smoke, /WHATSAPP_ALERTAS_ACTIVAS:\s*'false'/);
  assert.match(smoke, /ruta === '\/api\/administracion\/suscripciones' \? \[401, 503\]/);
  assert.match(environment, /if \(!enVercel && !dotenvDeshabilitado\)/);
});
