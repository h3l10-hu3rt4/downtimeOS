// HIST-14 · Comprobación del staging desde cualquier PC (solo lectura, no crea datos).
// Uso: node scripts/staging-check.mjs https://staging.ejemplo.com [https://correo-staging.ejemplo.com]
// Verifica HTTPS, páginas públicas, que la API rechace anónimos, que el buzón pida
// contraseña y que los puertos internos (app, Supabase Local, Postgres, Mailpit) NO respondan.
import net from 'node:net';

const [appArg, mailArg] = process.argv.slice(2);
if (!appArg) { console.log('Uso: node scripts/staging-check.mjs https://staging.ejemplo.com [https://correo-staging.ejemplo.com]'); process.exit(2); }
const app = new URL(appArg);
const mail = mailArg ? new URL(mailArg) : null;
let fallos = 0;
const chk = (c, m, extra = '') => { console.log(`${c ? 'PASS' : 'FAIL'} · ${m}${extra ? ' · ' + extra : ''}`); if (!c) fallos += 1; };
const pedir = async (url, init) => { try { return await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15_000), ...init }); } catch (error) { return { status: 0, headers: new Headers(), error: error.cause?.code || error.message, json: async () => ({}) }; } };
const puertoAbierto = (host, port) => new Promise((resolve) => {
  const socket = net.connect({ host, port, timeout: 4000 });
  socket.once('connect', () => { socket.destroy(); resolve(true); });
  for (const evento of ['timeout', 'error']) socket.once(evento, () => { socket.destroy(); resolve(false); });
});

console.log(`\n== 1. Aplicación (${app.origin})`);
chk(app.protocol === 'https:', 'el staging se sirve por HTTPS');
let r = await pedir(new URL('/api/health', app));
chk(r.status === 200, 'GET /api/health responde 200', `status ${r.status}${r.error ? ' · ' + r.error : ''}`);
chk(/noindex/i.test(r.headers.get('x-robots-tag') || ''), 'el staging pide no ser indexado (X-Robots-Tag)');
for (const ruta of ['/', '/acceso', '/registro', '/recuperar', '/suscripcion']) {
  r = await pedir(new URL(ruta, app));
  chk(r.status === 200, `GET ${ruta} responde 200`, `status ${r.status}`);
}
r = await pedir(new URL('/api/planta', app));
chk(r.status === 401, 'GET /api/planta sin sesión responde 401', `status ${r.status}`);
r = await pedir(new URL('/api/administracion/suscripciones', app));
chk(r.status === 401, 'el panel de administración rechaza anónimos', `status ${r.status}`);
r = await pedir(new URL('/api/config', app));
const config = await r.json().catch(() => ({}));
const supabaseUrl = String(config.supabase_url || '');
chk(/^https:\/\//.test(supabaseUrl) && !/localhost|127\.0\.0\.1|host\.docker\.internal/.test(supabaseUrl), 'la app apunta a un proyecto de Supabase propio por HTTPS (no al Supabase Local)');
r = await pedir(`http://${app.host}/`);
chk([301, 302, 307, 308].includes(r.status) && String(r.headers.get('location') || '').startsWith('https://'), 'HTTP redirige a HTTPS', `status ${r.status}`);

console.log('\n== 2. Puertos que NO deben estar expuestos');
for (const [puerto, nombre] of [[3000, 'app sin proxy'], [5432, 'Postgres'], [54321, 'API de Supabase Local'], [54322, 'Postgres de Supabase Local'], [54323, 'Studio'], [54324, 'Mailpit local'], [8025, 'interfaz de Mailpit sin proxy'], [1025, 'SMTP sin TLS']]) {
  chk(!(await puertoAbierto(app.hostname, puerto)), `puerto ${puerto} cerrado (${nombre})`);
}

if (mail) {
  console.log(`\n== 3. Buzón de pruebas (${mail.origin})`);
  r = await pedir(new URL('/api/v1/messages', mail));
  chk(r.status === 401, 'el buzón pide usuario y contraseña', `status ${r.status}${r.error ? ' · ' + r.error : ''}`);
  chk(await puertoAbierto(mail.hostname, 587), 'el SMTP del buzón (587) responde para Supabase Auth');
}
console.log(`\nRESUMEN: ${fallos === 0 ? 'todo PASS' : fallos + ' FALLO(S)'}`);
process.exit(fallos === 0 ? 0 : 1);
