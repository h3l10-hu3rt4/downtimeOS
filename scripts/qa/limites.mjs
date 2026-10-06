// HIST-05 · Límites del plan (5 equipos, 1 planta, sin plan → 402).
// Requiere: empresa A con plan Starter ACTIVO y empresa B sin plan. Crea y archiva los equipos M-05/M-06/M-07 en A: deja filas archivadas. Solo para base local desechable.
// Uso: node scripts/qa/limites.mjs   (nunca imprime tokens ni llaves)
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../../', import.meta.url));
const psql = (q) => execSync(`docker exec supabase_db_downtimeos psql -U postgres -tA -c "${q}"`, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
const plantaDe = (nombre) => psql(`select id from plantas where nombre='${nombre}' limit 1`);
const envFile = Object.fromEntries(readFileSync(`${repo}/.env.hist03.local`, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const st = Object.fromEntries(execSync('npx --yes supabase status --output env --workdir .', { cwd: repo, stdio: ['ignore', 'pipe', 'ignore'] }).toString().split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')]));
const key = st.PUBLISHABLE_KEY || st.ANON_KEY;
async function login(email, password) {
  const j = await (await fetch(`${st.API_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: key, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) })).json();
  return j.access_token;
}
const call = async (tok, plant, method, path, body) => {
  const r = await fetch(`http://localhost:3000${path}`, { method, headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json', 'x-downtimeos-planta': plant }, body: body ? JSON.stringify(body) : undefined });
  let j = {}; try { j = await r.json(); } catch {}
  return { status: r.status, j };
};
const activo = (n) => ({ tipo: 'activo', activo: { id: `M-0${n}`, linea_id: 'L-01', tipo: 'MA', nombre: `Equipo límite ${n}`, etapa: 'Prensado', etapa_orden: 2, tarifa_hora: 100 } });
const show = (t, r) => console.log(`${t} → ${r.status}${r.j.codigo ? ' ' + r.j.codigo : ''}${r.j.error ? ' · ' + String(r.j.error).slice(0, 110) : ''}`);

const tokA = await login(envFile.HIST03_TITULAR_EMAIL, envFile.HIST03_TITULAR_PASSWORD);
const plantaA = process.env.PLANTA_A || plantaDe('Planta Norte');
console.log('== Empresa A · Starter activo (límite 5 equipos, 1 planta) · parte con 4 equipos');
show('Alta del equipo 5 (M-05)', await call(tokA, plantaA, 'POST', '/api/planta/estructura', activo(5)));
show('Alta del equipo 6 (M-06)  [debe rechazarse]', await call(tokA, plantaA, 'POST', '/api/planta/estructura', activo(6)));
show('Segunda planta (Starter)  [debe rechazarse]', await call(tokA, plantaA, 'POST', '/api/planta/plantas', { nombre: 'Planta Extra HIST05' }));
// Restaurar: archivar M-05 para dejar 4 equipos activos.
show('Archivar M-05 (restaurar 4 equipos)', await call(tokA, plantaA, 'PATCH', '/api/planta/estructura', { accion: 'archivar_activo', id: 'M-05' }));
show('Reintento alta M-06 con 4 activos (debe pasar el límite)', await call(tokA, plantaA, 'POST', '/api/planta/estructura', activo(6)));
show('Archivar M-06 (limpieza)', await call(tokA, plantaA, 'PATCH', '/api/planta/estructura', { accion: 'archivar_activo', id: 'M-06' }));

const tokB = await login(envFile.HIST05_TITULAR_B_EMAIL, envFile.HIST05_TITULAR_B_PASSWORD);
const plantaB = process.env.PLANTA_B || plantaDe('Planta Sur');
console.log('\n== Empresa B · sin plan activo');
show('Alta de equipo sin plan  [debe ser 402]', await call(tokB, plantaB, 'POST', '/api/planta/estructura', activo(2)));
show('Segunda planta sin plan  [debe ser 402]', await call(tokB, plantaB, 'POST', '/api/planta/plantas', { nombre: 'Planta Extra B' }));
show('Invitar usuario sin plan', await call(tokB, plantaB, 'POST', '/api/planta/equipo', { nombre: 'Prueba', email: 'hist05-sinplan@example.test', rol: 'operador' }));
