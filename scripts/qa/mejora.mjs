// HIST-15 · Mejora inmediata de Starter a Pro (empresa B, "Planta Sur").
// ⚠ MODIFICA la base: si B no tiene plan le activa Starter, luego solicita Pro y el admin lo activa. Deja la empresa B con Pro activo y el Starter "reemplazada". Solo para base local desechable.
// No reporta paros ni toca WhatsApp. La IA solo se consulta para comprobar el candado del plan: correr con las llaves de IA vacías (docker-local.ps1 sin -IADesdeEnvLocal).
// Uso: node scripts/qa/mejora.mjs   (nunca imprime tokens ni llaves)
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../../', import.meta.url));
const psql = (q) => execSync(`docker exec supabase_db_downtimeos psql -U postgres -tA -c "${q}"`, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
const env = Object.fromEntries(readFileSync(`${repo}/.env.hist03.local`, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const st = Object.fromEntries(execSync('npx --yes supabase status --output env --workdir .', { cwd: repo, stdio: ['ignore', 'pipe', 'ignore'] }).toString().split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')]));
const key = st.PUBLISHABLE_KEY || st.ANON_KEY;
const APP = 'http://localhost:3000';
const P = process.env.PLANTA_B || psql("select id from plantas where nombre='Planta Sur' limit 1");
const ORG = psql(`select organizacion_id from plantas where id='${P}'`);
const login = async (e, p) => (await (await fetch(`${st.API_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: key, 'content-type': 'application/json' }, body: JSON.stringify({ email: e, password: p }) })).json()).access_token;
const call = async (tok, method, path, body) => {
  const r = await fetch(`${APP}${path}`, { method, headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json', 'x-downtimeos-planta': P }, body: body ? JSON.stringify(body) : undefined });
  let j = {}; try { j = await r.json(); } catch {}
  return { s: r.status, j };
};
let fallos = 0;
const chk = (c, m, extra = '') => { console.log(`${c ? 'PASS' : 'FAIL'} · ${m}${extra ? ' · ' + extra : ''}`); if (!c) fallos += 1; };
const corto = (r) => `status ${r.s} · ${String(r.j.mensaje || r.j.error || '').slice(0, 110)}`;

const tit = await login(env.HIST05_TITULAR_B_EMAIL, env.HIST05_TITULAR_B_PASSWORD);
const adminLogin = await fetch(`${APP}/api/health?admin_sesion=1`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ correo: env.HIST03_ADMIN_EMAIL, clave: env.HIST03_ADMIN_PASSWORD }) });
const cookie = (adminLogin.headers.get('set-cookie') || '').split(';')[0];
if (!tit || !cookie.startsWith('downtimeos_admin=')) { console.log('FAIL · no se pudo iniciar sesión (titular B o admin de prueba). Revisa .env.hist03.local y que la app se levantó con el admin de prueba.'); process.exit(1); }
const admin = async (id, accion) => {
  const r = await fetch(`${APP}/api/administracion/suscripciones`, { method: 'PATCH', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ id, accion }) });
  let j = {}; try { j = await r.json(); } catch {}
  return { s: r.status, j };
};
const vigente = (lista) => (lista || []).find((s) => ['activa', 'cancelacion_programada'].includes(s.estado) && Date.parse(s.inicia_en) <= Date.now() && Date.parse(s.termina_en) > Date.now());
const iaBloqueada = (r) => r.s === 403 && /no está incluida en el plan/i.test(String(r.j.error || ''));

console.log('\n== 0. Punto de partida: empresa B con Starter vigente');
let r = await call(tit, 'GET', '/api/planta/suscripcion');
let actual = vigente(r.j.suscripciones);
if (!actual) {
  r = await call(tit, 'POST', '/api/planta/suscripcion', { accion: 'solicitar', plan: 'starter', periodicidad: 'semestral', orden_compra: 'OC-HIST15-STARTER' });
  chk(r.s === 201, 'B solicita Starter por el flujo normal', corto(r));
  r = await admin(r.j.suscripcion?.id, 'activar');
  chk(r.s === 200, 'el admin verifica el pago y activa Starter', corto(r));
  r = await call(tit, 'GET', '/api/planta/suscripcion');
  actual = vigente(r.j.suscripciones);
}
if (actual?.plan_codigo !== 'starter') { console.log(`FAIL · la empresa B debe tener Starter vigente y tiene "${actual?.plan_codigo || 'nada'}". Esta prueba solo corre una vez por base.`); process.exit(1); }
chk(true, 'B tiene Starter vigente', `termina ${actual.termina_en.slice(0, 10)}`);
const terminaStarter = actual.termina_en;
r = await call(tit, 'POST', '/api/ia/resumen', { enfoque: 'finanzas' });
chk(iaBloqueada(r), 'con Starter la IA está bloqueada por el plan', corto(r));

console.log('\n== 1. Solicitudes que NO son una mejora');
r = await call(tit, 'POST', '/api/planta/suscripcion', { accion: 'mejorar', suscripcion_actual_id: actual.id, plan: 'starter', periodicidad: 'anual' });
chk(r.s === 400, 'mejorar al mismo plan se rechaza (solo plan superior)', corto(r));
r = await call(tit, 'POST', '/api/planta/suscripcion', { accion: 'mejorar', suscripcion_actual_id: '00000000-0000-4000-8000-000000000000', plan: 'pro', periodicidad: 'anual' });
chk(r.s === 404, 'mejorar una suscripción ajena o inexistente se rechaza', corto(r));
r = await call(tit, 'POST', '/api/planta/suscripcion', { accion: 'solicitar', plan: 'pro', periodicidad: 'anual' });
chk(r.s === 400, 'una solicitud inicial con plan vigente sigue rechazada (el cambio es por mejora)', corto(r));

console.log('\n== 2. El titular solicita Pro (flujo normal de pago, sin prorrateo)');
const precioProAnual = Number(psql("select precio_anual_usd from planes where codigo='pro'"));
r = await call(tit, 'POST', '/api/planta/suscripcion', { accion: 'mejorar', suscripcion_actual_id: actual.id, plan: 'pro', periodicidad: 'anual', orden_compra: 'OC-HIST15-PRO', importe: 1 });
chk(r.s === 201, 'B solicita la mejora a Pro', corto(r));
const mejoraId = r.j.suscripcion?.id;
chk(Number(r.j.importe_usd) === precioProAnual, 'el servidor cobra el periodo completo de Pro, sin prorrateo ni importe del cliente', `importe ${r.j.importe_usd} USD (lista ${precioProAnual})`);
chk(psql(`select mejora_de_suscripcion_id from organizacion_suscripciones where id='${mejoraId}'`) === actual.id, 'la solicitud queda ligada al Starter que reemplazará');
chk(psql(`select estado||'|'||importe from organizacion_pagos where suscripcion_id='${mejoraId}'`) === `pendiente|${precioProAnual.toFixed(2)}`, 'el pago queda pendiente por el importe completo');
chk(psql(`select estado from organizacion_suscripciones where id='${actual.id}'`) === 'activa', 'mientras se valida el pago, Starter sigue activo');
r = await call(tit, 'POST', '/api/ia/resumen', { enfoque: 'finanzas' });
chk(iaBloqueada(r), 'solicitar no da Pro: la IA sigue bloqueada hasta validar el pago', corto(r));
r = await call(tit, 'POST', '/api/planta/suscripcion', { accion: 'mejorar', suscripcion_actual_id: actual.id, plan: 'pro', periodicidad: 'anual' });
chk(r.s === 409, 'una segunda mejora con otra pendiente se rechaza', corto(r));
r = await call(tit, 'POST', '/api/planta/suscripcion', { accion: 'renovar', suscripcion_actual_id: actual.id, plan: 'starter', periodicidad: 'anual' });
chk(r.s === 409, 'no se puede renovar mientras hay una mejora pendiente', corto(r));

console.log('\n== 3. El admin valida el pago: Pro reemplaza a Starter de inmediato');
r = await admin(mejoraId, 'piloto');
chk(r.s === 400, 'una mejora no se puede convertir en piloto', corto(r));
const antes = Date.now();
r = await admin(mejoraId, 'activar');
chk(r.s === 200 && r.j.resultado?.mejora_inmediata === true, 'el admin verifica el pago y la mejora se aplica', corto(r));
const [estStarter, finStarter] = psql(`select estado||'|'||extract(epoch from termina_en)*1000 from organizacion_suscripciones where id='${actual.id}'`).split('|');
chk(estStarter === 'reemplazada', 'Starter queda como "reemplazada" (no cancelada ni vencida)', `estado=${estStarter}`);
chk(Math.abs(Number(finStarter) - antes) < 60_000, 'el acceso de Starter termina en el momento del reemplazo', `antes terminaba ${terminaStarter.slice(0, 10)}`);
const [estPro, iniPro, meses, pagoPro] = psql(`select s.estado||'|'||extract(epoch from s.inicia_en)*1000||'|'||(extract(year from age(s.termina_en,s.inicia_en))*12+extract(month from age(s.termina_en,s.inicia_en)))||'|'||(select estado from organizacion_pagos where suscripcion_id=s.id) from organizacion_suscripciones s where s.id='${mejoraId}'`).split('|');
chk(estPro === 'activa' && Math.abs(Number(iniPro) - antes) < 60_000, 'Pro queda activo desde ahora, sin esperar al vencimiento de Starter', `estado=${estPro}`);
chk(Number(meses) === 12, 'Pro corre su periodo completo de 12 meses desde hoy', `${meses} meses`);
chk(pagoPro === 'verificado', 'el pago de Pro queda verificado', `pago=${pagoPro}`);
chk(Number(psql(`select count(*) from organizacion_suscripciones where organizacion_id='${ORG}' and estado in ('activa','piloto','cancelacion_programada')`)) === 1, 'la empresa queda con un solo plan vigente');

console.log('\n== 4. El titular obtiene las funciones de Pro de inmediato');
r = await call(tit, 'GET', '/api/planta/suscripcion');
chk(vigente(r.j.suscripciones)?.plan_codigo === 'pro', 'la cuenta muestra Pro como plan vigente');
chk(r.j.suscripciones?.find((s) => s.id === actual.id)?.estado === 'reemplazada', 'el historial conserva el Starter reemplazado');
r = await call(tit, 'POST', '/api/ia/resumen', { enfoque: 'finanzas' });
chk(!iaBloqueada(r) && r.s !== 402, 'el candado del plan ya deja pasar la IA (con llaves vacías falla después, sin gastar créditos)', corto(r));
r = await call(tit, 'GET', '/api/planta'); chk(r.s === 200, 'el titular sigue leyendo su planta', `status ${r.s}`);
r = await call(tit, 'GET', '/api/planta/exportacion'); chk(r.s === 200, 'la exportación sigue disponible', `status ${r.s}`);

console.log('\n== 5. Auditoría');
chk(psql(`select count(*) from planta_auditoria where organizacion_id='${ORG}' and accion='mejora_plan_solicitada' and entidad_id='${mejoraId}' and detalles->>'prorrateo'='false'`) === '1', 'queda la solicitud de mejora (prorrateo=false)');
chk(psql(`select detalles->'reemplazadas'->0->>'id' from planta_auditoria where organizacion_id='${ORG}' and accion='mejora_pago_verificado_plan_reemplazado' and entidad_id='${mejoraId}'`) === actual.id, 'queda la verificación del pago con el plan reemplazado y su fin original');
console.log(`\nRESUMEN: ${fallos === 0 ? 'todo PASS' : fallos + ' FALLO(S)'}`);
process.exit(fallos === 0 ? 0 : 1);
