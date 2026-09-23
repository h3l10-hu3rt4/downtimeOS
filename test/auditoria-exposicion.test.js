import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estadoConfiguracion } from '../api/observabilidad/uso.js';

/** Aplica variables de entorno solo durante `fn` y restaura las anteriores. */
function conEntorno(vars, fn) {
  const previas = {};
  for (const [k, v] of Object.entries(vars)) {
    previas[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(previas)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

const BASE = {
  SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k',
  WHATSAPP_PROVIDER: 'meta', META_WHATSAPP_ACCESS_TOKEN: 't', META_WHATSAPP_PHONE_NUMBER_ID: '1',
  DASHBOARD_ADMIN_EMAIL: 'admin@x.tech', DASHBOARD_ADMIN_PASSWORD: 'p',
};
const hallazgo = (estado, titulo) => estado.hallazgos.find((h) => h.titulo === titulo);

test('el panel se reporta protegido cuando la administración está configurada', () => {
  const estado = conEntorno({ ...BASE, GEMINI_API_KEY: 'g' }, estadoConfiguracion);
  assert.equal(hallazgo(estado, 'Panel protegido en servidor')?.nivel, 'ok');
  assert.equal(estado.hallazgos.some((h) => /intencionalmente público/.test(h.titulo)), false);
});

test('sin credenciales de administración el hallazgo sube a alto', () => {
  const estado = conEntorno({ ...BASE, GEMINI_API_KEY: 'g', DASHBOARD_ADMIN_PASSWORD: undefined }, estadoConfiguracion);
  assert.equal(hallazgo(estado, 'Administración sin credenciales')?.nivel, 'alto');
});

test('la llave de IA exigida depende del proveedor configurado', () => {
  const soloClaude = { ...BASE, AI_FINANZAS_PROVIDER: 'anthropic', AI_OPERACIONES_PROVIDER: 'anthropic' };
  // Solo Claude: sin GEMINI_API_KEY no falta nada si existe la de Anthropic.
  let estado = conEntorno({ ...soloClaude, GEMINI_API_KEY: undefined, ANTHROPIC_API_KEY: 'a' }, estadoConfiguracion);
  assert.equal(estado.hallazgos[0].nivel, 'ok');
  // ...y sí falta si tampoco está la de Anthropic.
  estado = conEntorno({ ...soloClaude, GEMINI_API_KEY: 'g', ANTHROPIC_API_KEY: undefined }, estadoConfiguracion);
  assert.equal(estado.hallazgos[0].nivel, 'alto');
});

test('los prospectos se reportan protegidos con la administración configurada', () => {
  const estado = conEntorno({ ...BASE, GEMINI_API_KEY: 'g' }, estadoConfiguracion);
  assert.equal(hallazgo(estado, 'Prospectos protegidos')?.nivel, 'ok');
  assert.equal(estado.secretos_expuestos_en_respuesta, false);
});
