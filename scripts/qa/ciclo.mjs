// HIST-08 · Exportación, cancelación y vencimiento (empresa A con plan activo).
// ⚠ MODIFICA la base: solicita la cancelación y luego fuerza las fechas del plan al pasado (como hace el E2E). Deja la empresa A con plan vencido. Solo para base local desechable.
// Uso: node scripts/qa/ciclo.mjs   (nunca imprime tokens ni llaves)
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../../', import.meta.url));
const psql = (q) => execSync(`docker exec supabase_db_downtimeos psql -U postgres -tA -c "${q}"`, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
const plantaDe = (nombre) => psql(`select id from plantas where nombre='${nombre}' limit 1`);
const env = Object.fromEntries(readFileSync(`${repo}/.env.hist03.local`, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const st = Object.fromEntries(execSync('npx --yes supabase status --output env --workdir .', { cwd: repo, stdio: ['ignore', 'pipe', 'ignore'] }).toString().split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')]));
const key = st.PUBLISHABLE_KEY || st.ANON_KEY;
const P = process.env.PLANTA_A || plantaDe('Planta Norte');
const login = async (e, p) => (await (await fetch(`${st.API_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: key, 'content-type': 'application/json' }, body: JSON.stringify({ email: e, password: p }) })).json()).access_token;
const call = async (tok, method, path, body) => {
  const r = await fetch(`http://localhost:3000${path}`, { method, headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json', 'x-downtimeos-planta': P }, body: body ? JSON.stringify(body) : undefined });
  let j = {}; try { j = await r.json(); } catch {}
  return { s: r.status, j };
};
const sql = psql;
let fallos = 0;
const chk = (c, m, extra = '') => { console.log(`${c ? 'PASS' : 'FAIL'} · ${m}${extra ? ' · ' + extra : ''}`); if (!c) fallos += 1; };

const tit = await login(env.HIST03_TITULAR_EMAIL, env.HIST03_TITULAR_PASSWORD);
const ope = await login(env.HIST03_OPERADOR_EMAIL, env.HIST03_OPERADOR_PASSWORD);
const opr = await login(env.HIST03_OPERACIONES_EMAIL, env.HIST03_OPERACIONES_PASSWORD);
const fin = await login(env.HIST03_FINANZAS_EMAIL, env.HIST03_FINANZAS_PASSWORD);

console.log('\n== 1. Exportación con plan ACTIVO');
let r = await call(tit, 'GET', '/api/planta/exportacion');
chk(r.s === 200 && r.j.filas?.length === 3, 'titular (Dirección+Finanzas) exporta la bitácora', `status ${r.s}, ${r.j.filas?.length} filas`);
chk(r.j.filas?.every((f) => 'costo_mxn' in f), 'la exportación incluye costo_mxn para Dirección/Finanzas');
r = await call(fin, 'GET', '/api/planta/exportacion'); chk(r.s === 200, 'Finanzas exporta', `status ${r.s}`);
r = await call(ope, 'GET', '/api/planta/exportacion'); chk(r.s === 403, 'Operador NO exporta', `status ${r.s}`);
r = await call(opr, 'GET', '/api/planta/exportacion'); chk(r.s === 403, 'Operaciones NO exporta', `status ${r.s}`);
chk(Number(sql(`select count(*) from planta_auditoria where planta_id='${P}' and accion='bitacora_exportada'`)) >= 2, 'cada exportación queda en la auditoría', `${sql(`select count(*) from planta_auditoria where planta_id='${P}' and accion='bitacora_exportada'`)} registros`);

console.log('\n== 2. Cancelación (plan activo hasta 2027-10-06)');
r = await call(tit, 'GET', '/api/planta/suscripcion');
const subId = r.j.suscripciones?.find((s) => s.estado === 'activa')?.id;
chk(!!subId, 'se encontró la suscripción activa');
const termina = sql(`select termina_en from organizacion_suscripciones where id='${subId}'`);
r = await call(tit, 'POST', '/api/planta/suscripcion', { accion: 'cancelar', id: subId });
chk(r.s === 200, 'titular solicita cancelación', `status ${r.s} · ${r.j.mensaje || r.j.error || ''}`.slice(0, 140));
const est = sql(`select estado||' | termina '||termina_en from organizacion_suscripciones where id='${subId}'`);
chk(/^cancelacion_programada/.test(est), 'estado = cancelacion_programada', est);
chk(sql(`select termina_en from organizacion_suscripciones where id='${subId}'`) === termina, 'la fecha de fin NO cambió (no se corta el acceso)');
r = await call(ope, 'POST', '/api/planta/solicitudes', { activo_id: 'M-01', causa_id: 'espera-material', reportado_por: 'HIST08 Operador' });
chk(r.s === 201, 'con cancelación programada el Operador SÍ puede reportar un paro', `status ${r.s}`);
r = await call(tit, 'GET', '/api/planta'); chk(r.s === 200, 'el titular sigue leyendo la planta', `status ${r.s}`);
r = await call(tit, 'POST', '/api/planta/estructura', { tipo: 'activo', activo: { id: 'M-07', linea_id: 'L-01', tipo: 'MA', nombre: 'Equipo cancelación', etapa: 'Prensado', etapa_orden: 2, tarifa_hora: 100 } });
chk(r.s === 201, 'con cancelación programada todavía se pueden dar de alta equipos', `status ${r.s}`);
await call(tit, 'PATCH', '/api/planta/estructura', { accion: 'archivar_activo', id: 'M-07' });

console.log('\n== 3. Vencimiento (se fuerzan las fechas del plan al pasado, como hace el E2E)');
sql(`update organizacion_suscripciones set inicia_en='2019-01-01', termina_en='2020-01-01', renueva_en=null where id='${subId}'`);
r = await call(tit, 'GET', '/api/planta/suscripcion');
const estV = sql(`select estado from organizacion_suscripciones where id='${subId}'`);
chk(estV === 'vencida', 'al consultar, la suscripción se materializa como vencida', `estado=${estV}`);
r = await call(ope, 'POST', '/api/planta/solicitudes', { activo_id: 'M-02', causa_id: 'espera-material', reportado_por: 'HIST08 Operador' });
chk(r.s === 402, 'plan vencido BLOQUEA un paro nuevo', `status ${r.s} · ${String(r.j.error || '').slice(0, 80)}`);
r = await call(ope, 'PATCH', '/api/planta/reportes', { accion: 'cerrar', activo_id: 'M-01' });
chk(r.s === 200 && r.j.estado?.estado === 'RUN', 'plan vencido PERMITE cerrar el paro que ya estaba abierto', `status ${r.s}, estado ${r.j.estado?.estado}, folio ${r.j.evento?.folio ? 'sí' : 'no'}`);
r = await call(tit, 'POST', '/api/planta/estructura', { tipo: 'activo', activo: { id: 'M-08', linea_id: 'L-01', tipo: 'MA', nombre: 'Equipo vencido', etapa: 'Prensado', etapa_orden: 2, tarifa_hora: 100 } });
chk(r.s === 402, 'plan vencido bloquea altas de estructura', `status ${r.s}`);
r = await call(tit, 'GET', '/api/planta/exportacion');
chk(r.s === 200 && (r.j.filas?.length || 0) >= 4, 'plan vencido: la EXPORTACIÓN sigue disponible (portabilidad) e incluye el evento de cierre', `status ${r.s}, ${r.j.filas?.length} filas`);
r = await call(tit, 'GET', '/api/planta'); chk(r.s === 200, 'plan vencido: Dirección puede leer su historial', `status ${r.s}`);
r = await call(tit, 'POST', '/api/planta/suscripcion', { accion: 'solicitar', plan_codigo: 'starter', periodicidad: 'anual', orden_compra: 'OC-RENOVACION-HIST08' });
chk([200, 201].includes(r.s), 'con plan vencido se puede solicitar un plan nuevo', `status ${r.s} · ${String(r.j.error || '').slice(0, 90)}`);
console.log(`\nRESUMEN: ${fallos === 0 ? 'todo PASS' : fallos + ' FALLO(S)'}`);
