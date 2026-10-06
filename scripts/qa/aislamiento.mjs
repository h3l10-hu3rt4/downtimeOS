// HIST-05 · Aislamiento entre empresas (QA manual en Supabase Local).
// Requiere: dos empresas de prueba (A = hist03 titular en 'Planta Norte', B = hist05 titular en 'Planta Sur'), la app en :3000 y `.env.hist03.local` con sus credenciales.
// Solo LEE y hace intentos de escritura que deben ser rechazados. Seguro de repetir.
// Uso: node scripts/qa/aislamiento.mjs   (nunca imprime tokens ni llaves)
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../../', import.meta.url));
const psql = (q) => execSync(`docker exec supabase_db_downtimeos psql -U postgres -tA -c "${q}"`, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
const plantaDe = (nombre) => psql(`select id from plantas where nombre='${nombre}' limit 1`);

const envFile = Object.fromEntries(readFileSync(`${repo}/.env.hist03.local`, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const st = Object.fromEntries(execSync('npx --yes supabase status --output env --workdir .', { cwd: repo, stdio: ['ignore', 'pipe', 'ignore'] }).toString().split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')]));
const API = st.API_URL, APP = 'http://localhost:3000';
const ANON = st.PUBLISHABLE_KEY || st.ANON_KEY;

async function login(email, password) {
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const j = await r.json();
  if (!j.access_token) throw new Error(`login falló ${email}: ${r.status}`);
  return j.access_token;
}
const rest = (token, path, init = {}) => fetch(`${API}/rest/v1/${path}`, { ...init, headers: { apikey: ANON, ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json', prefer: 'return=representation', ...(init.headers || {}) } });
const app = (token, path, plant, init = {}) => fetch(`${APP}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(plant ? { 'x-downtimeos-planta': plant } : {}), ...(init.headers || {}) } });

const plantas = { A: process.env.PLANTA_A || plantaDe('Planta Norte'), B: process.env.PLANTA_B || plantaDe('Planta Sur') };
const sujetos = {
  A: { email: envFile.HIST03_TITULAR_EMAIL, pass: envFile.HIST03_TITULAR_PASSWORD, propia: plantas.A, ajena: plantas.B, nombresPropios: ['Cortadora', 'Ensamble final'], nombresAjenos: ['Fresadora', 'Línea Sur', 'SUR-B'] },
  B: { email: envFile.HIST05_TITULAR_B_EMAIL, pass: envFile.HIST05_TITULAR_B_PASSWORD, propia: plantas.B, ajena: plantas.A, nombresPropios: ['Fresadora', 'Línea Sur'], nombresAjenos: ['Cortadora', 'Ensamble final'] },
};
const tablas = ['planta_activos', 'planta_analisis_ia', 'planta_auditoria', 'planta_bitacora', 'planta_cancelaciones', 'planta_estados', 'planta_eventos', 'planta_invitaciones', 'planta_lineas', 'planta_membresias', 'planta_mensajes', 'planta_perfiles', 'planta_reportes', 'planta_solicitudes'];
let fallos = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'} · ${m}`); if (!c) fallos += 1; };

for (const [k, s] of Object.entries(sujetos)) {
  const tok = await login(s.email, s.pass);
  console.log(`\n=== Titular ${k} (${s.email}) ===`);
  // 1. API con su propia planta: ve lo suyo y nada de lo ajeno.
  const rp = await app(tok, '/api/planta', s.propia); const tp = await rp.text();
  ok(rp.status === 200, `API /api/planta con planta propia → ${rp.status}`);
  ok(s.nombresPropios.every((n) => tp.includes(n)), 'API devuelve sus propios nombres');
  ok(!s.nombresAjenos.some((n) => tp.includes(n)), 'API no devuelve ningún nombre de la otra empresa');
  // 2. API con la planta AJENA en el encabezado.
  for (const p of ['/api/planta', '/api/planta/estado-vivo', '/api/planta/equipo', '/api/planta/suscripcion', '/api/planta/estructura']) {
    const r = await app(tok, p, s.ajena); const t = await r.text();
    ok(r.status >= 400 && !s.nombresAjenos.some((n) => t.includes(n)), `GET ${p} con planta ajena → ${r.status}, sin datos ajenos`);
  }
  const rm = await app(tok, '/api/planta/estructura', s.ajena, { method: 'POST', body: JSON.stringify({ tipo: 'linea', linea: { id: 'L-99', nombre: 'Intruso' } }) });
  ok(rm.status >= 400, `POST /api/planta/estructura en planta ajena → ${rm.status}`);
  // 3. PostgREST directo: todas las filas visibles son de su planta.
  for (const t of tablas) {
    const r = await rest(tok, `${t}?select=planta_id`);
    const rows = r.ok ? await r.json() : [];
    const ajenas = rows.filter((x) => x.planta_id !== s.propia).length;
    ok(r.status === 200 || r.status === 401 || r.status === 403, `${t}: status ${r.status}, ${rows.length} filas visibles, ${ajenas} ajenas`) ;
    if (ajenas) ok(false, `${t} expone filas de otra planta`);
  }
  for (const t of ['plantas', 'organizaciones']) {
    const r = await rest(tok, `${t}?select=id`); const rows = r.ok ? await r.json() : [];
    ok(rows.length <= 1, `${t}: ${rows.length} fila(s) visibles (máx. 1)`);
  }
  // 4. Escrituras directas contra la planta ajena.
  const u = await rest(tok, `planta_activos?planta_id=eq.${s.ajena}`, { method: 'PATCH', body: JSON.stringify({ tarifa_hora: 1 }) });
  const ut = u.ok ? await u.json() : [];
  ok(!u.ok || ut.length === 0, `PATCH planta_activos ajena → ${u.status}, ${ut.length} filas afectadas`);
  const d = await rest(tok, `planta_activos?planta_id=eq.${s.ajena}`, { method: 'DELETE' });
  const dt = d.ok ? await d.json() : [];
  ok(!d.ok || dt.length === 0, `DELETE planta_activos ajena → ${d.status}, ${dt.length} filas afectadas`);
  const i = await rest(tok, 'planta_lineas', { method: 'POST', body: JSON.stringify({ planta_id: s.ajena, id: 'L-98', nombre: 'Intruso' }) });
  ok(!i.ok, `INSERT planta_lineas en planta ajena → ${i.status}`);
}
// 5. Anónimo.
console.log('\n=== Anónimo (sin sesión) ===');
for (const t of ['planta_activos', 'planta_eventos', 'planta_membresias', 'plantas']) {
  const r = await rest(null, `${t}?select=*`); const rows = r.ok ? await r.json() : [];
  ok(rows.length === 0, `${t}: ${rows.length} filas, status ${r.status}`);
}
const ra = await fetch(`${APP}/api/planta`); ok(ra.status === 401 || ra.status === 403, `/api/planta sin token → ${ra.status}`);
console.log(`\nRESUMEN: ${fallos === 0 ? 'todo PASS' : fallos + ' FALLO(S)'}`);
process.exit(fallos ? 1 : 0);
