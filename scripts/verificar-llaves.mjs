// HIST-11 · Verificador de rotación de llaves. Nunca imprime valores: solo el nombre, el resultado y el código HTTP.
// Solo hace consultas de lectura a cada proveedor (no envía mensajes de WhatsApp ni gasta créditos de IA).
//
//   node scripts/verificar-llaves.mjs                         → ¿las llaves de .env.local funcionan?
//   node scripts/verificar-llaves.mjs --anteriores ARCHIVO    → además: ¿cada llave cambió y la anterior ya fue rechazada?
//   node scripts/verificar-llaves.mjs --actuales OTRO.env     → usa otro archivo en vez de .env.local
//
// Flujo: antes de rotar, copiar .env.local a .env.local.antes-de-rotar (ignorado por git); rotar; correr con --anteriores.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const opcion = (nombre) => { const i = args.indexOf(nombre); return i >= 0 ? args[i + 1] : null; };
const leerEnv = (ruta) => Object.fromEntries(readFileSync(ruta, 'utf8').split(/\r?\n/)
  .filter((l) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(l))
  .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim().replace(/^(["'])(.*)\1$/, '$2')]));
const rutaActuales = opcion('--actuales') || `${repo}.env.local`;
const rutaAnteriores = opcion('--anteriores');
const actual = leerEnv(rutaActuales);
const anterior = rutaAnteriores ? leerEnv(rutaAnteriores) : null;

let fallos = 0;
const linea = (estado, texto) => { console.log(`${estado.padEnd(5)}· ${texto}`); if (estado === 'FAIL') fallos += 1; };
const huella = (valor) => createHash('sha256').update(String(valor)).digest('hex');
const pedir = async (url, headers) => {
  try { return (await fetch(url, { headers, signal: AbortSignal.timeout(15_000) })).status; }
  catch (error) { return `sin respuesta (${error.cause?.code || error.name})`; }
};

// Cada prueba recibe un entorno y devuelve el código HTTP de una consulta de solo lectura, o null si falta la llave.
const supabaseServidor = (env) => env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
const supabasePublica = (env) => env.SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY;
const PROVEEDORES = [
  { nombre: 'Supabase · llave de servidor (service role / secret)', variables: ['SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY'],
    probar: (env, base) => supabaseServidor(env) && base.SUPABASE_URL
      ? pedir(`${base.SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1`, { apikey: supabaseServidor(env), authorization: `Bearer ${supabaseServidor(env)}` }) : null },
  { nombre: 'Supabase · llave pública (anon / publishable)', variables: ['SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY'], publica: true,
    probar: (env, base) => supabasePublica(env) && base.SUPABASE_URL
      ? pedir(`${base.SUPABASE_URL}/auth/v1/settings`, { apikey: supabasePublica(env) }) : null },
  { nombre: 'Anthropic', variables: ['ANTHROPIC_API_KEY'],
    probar: (env) => env.ANTHROPIC_API_KEY ? pedir('https://api.anthropic.com/v1/models?limit=1', { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }) : null },
  { nombre: 'Gemini', variables: ['GEMINI_API_KEY'],
    probar: (env) => env.GEMINI_API_KEY ? pedir('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', { 'x-goog-api-key': env.GEMINI_API_KEY }) : null },
  { nombre: 'Twilio · auth token', variables: ['TWILIO_AUTH_TOKEN'],
    probar: (env, base) => env.TWILIO_AUTH_TOKEN && (env.TWILIO_ACCOUNT_SID || base.TWILIO_ACCOUNT_SID)
      ? pedir(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID || base.TWILIO_ACCOUNT_SID}.json`,
        { authorization: `Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID || base.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64')}` }) : null },
  { nombre: 'Meta WhatsApp · token de acceso', variables: ['META_WHATSAPP_ACCESS_TOKEN'],
    probar: (env, base) => env.META_WHATSAPP_ACCESS_TOKEN && base.META_WHATSAPP_PHONE_NUMBER_ID
      ? pedir(`https://graph.facebook.com/${base.META_WHATSAPP_GRAPH_VERSION || 'v23.0'}/${base.META_WHATSAPP_PHONE_NUMBER_ID}?fields=id`, { authorization: `Bearer ${env.META_WHATSAPP_ACCESS_TOKEN}` }) : null },
  { nombre: 'Resend', variables: ['RESEND_API_KEY'],
    probar: (env) => env.RESEND_API_KEY ? pedir('https://api.resend.com/domains', { authorization: `Bearer ${env.RESEND_API_KEY}` }) : null },
];
// Secretos que no se pueden consultar a un proveedor: solo se comprueba que cambiaron y, si aplica, su longitud.
const LOCALES = [
  { variable: 'DASHBOARD_ADMIN_PASSWORD', minimo: 16 },
  { variable: 'CRON_SECRET', minimo: 32 },
  { variable: 'META_WHATSAPP_VERIFY_TOKEN', minimo: 16 },
  { variable: 'META_WHATSAPP_APP_SECRET' },
  { variable: 'META_WHATSAPP_WEBHOOK_SECRET' },
];

console.log(`\n== 1. Llaves actuales (${rutaActuales.replace(repo, '')})`);
for (const proveedor of PROVEEDORES) {
  const status = await proveedor.probar(actual, actual);
  if (status === null) linea('—', `${proveedor.nombre}: no configurada`);
  else linea(status === 200 ? 'PASS' : 'FAIL', `${proveedor.nombre}: ${status === 200 ? 'el proveedor la acepta' : 'el proveedor NO la acepta'} (${status})`);
}
for (const { variable, minimo } of LOCALES) {
  if (!actual[variable]) { linea('—', `${variable}: no configurada`); continue; }
  if (!minimo) linea('—', `${variable}: configurada (sin consulta posible; se revisa solo que cambie)`);
  else linea(actual[variable].length >= minimo ? 'PASS' : 'FAIL', `${variable}: ${actual[variable].length >= minimo ? 'longitud suficiente' : `muy corta, usar al menos ${minimo} caracteres`}`);
}

if (anterior) {
  console.log(`\n== 2. Rotación frente a ${rutaAnteriores}`);
  for (const proveedor of PROVEEDORES) {
    const usada = proveedor.variables.find((v) => anterior[v]);
    if (!usada) { linea('—', `${proveedor.nombre}: no existía antes`); continue; }
    const nueva = proveedor.variables.map((v) => actual[v]).find(Boolean);
    const cambio = !nueva || huella(nueva) !== huella(anterior[usada]);
    linea(cambio ? 'PASS' : 'FAIL', `${proveedor.nombre}: ${cambio ? 'el valor cambió' : 'SIGUE IGUAL, no se rotó'}`);
    if (!cambio) continue;
    // La URL, el SID y el identificador del número no son secretos: se toman del archivo actual.
    const status = await proveedor.probar(anterior, { ...anterior, ...actual });
    if (proveedor.publica) linea('—', `${proveedor.nombre}: la anterior responde ${status} (es pública; basta con que haya cambiado)`);
    else linea(status === 200 ? 'FAIL' : 'PASS', `${proveedor.nombre}: la anterior ${status === 200 ? 'TODAVÍA FUNCIONA, falta revocarla' : 'ya fue rechazada'} (${status})`);
  }
  for (const { variable } of LOCALES) {
    if (!anterior[variable]) { linea('—', `${variable}: no existía antes`); continue; }
    const cambio = !actual[variable] || huella(actual[variable]) !== huella(anterior[variable]);
    linea(cambio ? 'PASS' : 'FAIL', `${variable}: ${cambio ? 'el valor cambió' : 'SIGUE IGUAL, no se rotó'}`);
  }
}
console.log(`\nRESUMEN: ${fallos === 0 ? 'todo PASS' : fallos + ' FALLO(S)'}`);
process.exit(fallos === 0 ? 0 : 1);
