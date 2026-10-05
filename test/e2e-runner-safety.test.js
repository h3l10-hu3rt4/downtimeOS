import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const runner = await readFile(new URL('../scripts/e2e-mvp-local.mjs', import.meta.url), 'utf8');
const launcher = await readFile(new URL('../scripts/e2e-mvp-local.ps1', import.meta.url), 'utf8');
const browserRunner = await readFile(new URL('../scripts/e2e-browser-roles.mjs', import.meta.url), 'utf8');
const publicUiRunner = await readFile(new URL('../scripts/e2e-public-ui-local.mjs', import.meta.url), 'utf8');
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('el E2E exige confirmación y bloquea usuarios o tenants que no sean el LEGACY vacío de migración', () => {
  assert.ok(launcher.includes('$SupabaseWorkdir = $repo'));
  assert.ok(launcher.includes("Join-Path $PSScriptRoot '..'"));
  assert.ok(!launcher.includes('downtimeos-supabase-check-17e0d9c049a54fb4b73727f6c11b5df4'));
  assert.ok(launcher.includes('[switch]$ConfirmDisposableDatabase'));
  assert.ok(!launcher.includes('$Stack'));
  assert.ok(launcher.includes("@('status', '--output', 'env', '--workdir', $SupabaseWorkdir)"));
  assert.ok(!launcher.includes('--output-format'));
  assert.ok(launcher.includes('[int]$ExpectedSupabasePort = 54321'));
  assert.ok(launcher.includes('$apiUri.Port -ne $ExpectedSupabasePort'));
  assert.ok(launcher.includes("Join-Path $SupabaseWorkdir 'supabase/migrations'"));
  assert.ok(launcher.includes('Compare-Object $migrationsEsperadas $migrationsDisponibles'));
  assert.ok(launcher.includes('no coincide exactamente con esta rama'));
  assert.ok(launcher.indexOf('Compare-Object $migrationsEsperadas $migrationsDisponibles') < launcher.indexOf("@('status', '--output', 'env', '--workdir', $SupabaseWorkdir)"));
  assert.ok(launcher.includes('if (-not $ConfirmDisposableDatabase)'));
  assert.ok(launcher.includes('Confirma que Supabase Local está vacío'));
  assert.ok(runner.includes("MVP_E2E_DATABASE_DISPOSABLE !== '1'"));
  assert.ok(runner.includes('if (existingAuth.users.length)'));
  assert.ok(runner.includes("existingOrganizations[0]?.nombre === 'Histórico DowntimeOS'"));
  assert.ok(runner.includes('TABLAS_CON_DATOS_TENANT_E2E'));
  assert.ok(runner.includes('BUCKETS_CON_ARCHIVOS_TENANT_E2E'));
  assert.ok(runner.includes('verificación de datos previos en ${table}'));
  assert.ok(runner.includes('verificación de archivos en Storage ${bucket}'));
  assert.ok(runner.includes('validarBaseE2E({'));
  assert.ok(runner.indexOf('if (existingAuth.users.length)') < runner.indexOf('const suffix = randomUUID()'));
  assert.ok(runner.indexOf('validarBaseE2E({') < runner.indexOf('const suffix = randomUUID()'));
  assert.ok(runner.indexOf('validarBaseE2E({') < runner.indexOf('async function createCompany'));
  assert.ok(runner.includes("confirmFromEmail(env.mailpit, email, supabaseOrigin, appOrigin, 'signup')"));
  assert.ok(runner.includes("confirmacion.redirect.pathname, '/activar'"));
  assert.ok(runner.includes('GET /api/cuenta tras confirmar registro ${label}'));
  assert.ok(runner.includes("assert.deepEqual(registrationData, { ok: true, siguiente: 'confirmar_o_iniciar_sesion' }"));
  assert.ok(runner.includes('async function localAuthUserId(authApi, adminHeaders, supabaseOrigin, email)'));
  assert.ok(runner.includes("new URL('admin/users?page=1&per_page=100', authApi)"));
  assert.ok(!runner.includes('registrationData.registro?.usuario?.id'));
  assert.ok(runner.includes('confirmación del registro del titular desde el correo real de Mailpit'));
  assert.ok(runner.includes('async function assertPostgrestMutationDenied'));
  assert.ok(runner.includes('JWT autenticado no puede ${method} planta_lineas directamente'));
  assert.ok(runner.includes('JWT anon no puede ${method} planta_lineas directamente'));
  assert.ok(launcher.includes("$env:SUPABASE_ANON_JWT_KEY = $settings.ANON_KEY"));
  assert.ok(launcher.includes("'GEMINI_API_KEY', 'ANTHROPIC_API_KEY'"));
  assert.ok(launcher.includes("'AI_OPERACIONES_PROVIDER', 'AI_FINANZAS_PROVIDER', 'AI_REPORTE_FALLBACK_PROVIDER'"));
  assert.ok(launcher.includes("'GEMINI_MODEL', 'ANTHROPIC_MODEL'"));
  assert.ok(launcher.includes("'META_WHATSAPP_ACCESS_TOKEN', 'META_WHATSAPP_PHONE_NUMBER_ID'"));
  assert.ok(launcher.includes("'META_WHATSAPP_TEMPLATE_REPORTE', 'META_WHATSAPP_TEMPLATE_REPORTE_LANGUAGE'"));
  assert.ok(launcher.includes("'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_WHATSAPP_FROM'"));
  assert.ok(launcher.includes("[Environment]::SetEnvironmentVariable($nombre, '', 'Process')"));
  assert.ok(launcher.includes("$env:WHATSAPP_ALERTAS_ACTIVAS = 'false'"));
  assert.ok(launcher.includes("$env:WHATSAPP_APROBACIONES_ACTIVAS = 'false'"));
  assert.ok(!runner.includes('pruebas directas de mutación INSERT/UPDATE/DELETE con JWT'));
});

test('QA visual público corre sin sesiones ni escrituras y solo acepta orígenes locales', () => {
  assert.equal(packageJson.scripts['qa:ui:public'], 'node scripts/e2e-public-ui-local.mjs');
  assert.match(publicUiRunner, /verificarNavegacionConSesiones\(\{ appUrl, soloPublicas: true \}\)/);
  assert.doesNotMatch(publicUiRunner, /supabase|fetch\s*\(/i);
  assert.match(browserRunner, /\['127\.0\.0\.1', 'localhost', '::1'\]\.includes\(app\.hostname\)/);
  assert.match(browserRunner, /if \(!soloPublicas\) \{/);
  assert.match(browserRunner, /if \(soloPublicas\)[\s\S]*?return \{ screenshots, checks: pantallasPublicas\.length \+ 4 \};[\s\S]*?const sesionOnboarding/);
  assert.match(browserRunner, /regression-check@gmail\.com/);
  assert.match(browserRunner, /correo corporativo\.\*no son aceptados/i);
  assert.match(browserRunner, /Server-side validation runs before[\s\S]*?Supabase Auth signUp/);
  assert.match(browserRunner, /Gmail, no un error interno genérico/);
  assert.match(browserRunner, /el CTA primario debe usar el estilo global amarillo/);
  assert.match(browserRunner, /el tablero debe terminar de cargar datos reales de la planta antes de aprobarse/);
  assert.match(browserRunner, /origenDatos, 'Supabase · datos de planta'/);
  assert.match(browserRunner, /ready\.brand, 'DowntimeOS'/);
});

test('QA autenticado valida el layout móvil de todas las pantallas principales y roles', () => {
  assert.match(browserRunner, /const vistasMovilesAutenticadas = \[/);
  for (const route of [
    '/configurar-planta', '/plantas', '/estructura', '/direccion', '/operaciones',
    '/operador', '/equipo', '/suscripcion', '/administracion',
    '/administracion/suscripciones',
  ]) assert.ok(browserRunner.includes(`route: '${route}'`), `falta el recorrido móvil de ${route}`);
  for (const role of ['Finanzas', 'Suscripción Finanzas']) {
    assert.ok(browserRunner.includes(`name: '${role}'`), `falta el recorrido móvil de ${role}`);
  }
  assert.match(browserRunner, /width: 390, height: 844, deviceScaleFactor: 1, mobile: true/);
  assert.match(browserRunner, /layout\.documentWidth <= layout\.width \+ 1/);
  assert.match(browserRunner, /la pantalla autenticada debe caber en móvil sin desbordamiento horizontal/);
});
