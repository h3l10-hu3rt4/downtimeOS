/**
 * Genera `supabase/seed-planta.sql` a partir de `public/demo/js/datos.js`.
 *
 * La semilla NO se escribe a mano: se deriva del mismo módulo que alimenta la
 * demo, así que la base y el navegador no pueden contar historias distintas.
 * Si cambias los activos o los eventos en datos.js, vuelve a correr:
 *
 *     node scripts/generar-seed-planta.js
 */
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

// El paquete declara "type": "module", así que aquí no hay __dirname.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const raiz = path.join(__dirname, "..");
const almacen = {};
const g = {
  localStorage: {
    getItem: (k) => (k in almacen ? almacen[k] : null),
    setItem: (k, v) => { almacen[k] = v; },
    removeItem: (k) => { delete almacen[k]; },
  },
};
g.window = g;
vm.createContext(g);
vm.runInContext(fs.readFileSync(path.join(raiz, "public/demo/js/datos.js"), "utf8"), g);
const D = g.DowntimeCO;

const txt = (v) => (v === null || v === undefined ? "null" : "'" + String(v).replace(/'/g, "''") + "'");

/** Hash de dos caracteres estable, mismo alfabeto que datos.js. */
function hash2(semilla) {
  const ALF = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  let h = 0;
  const s = String(semilla);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 1156;
  return ALF[Math.floor(h / 34)] + ALF[h % 34];
}

const hoy = new Date();
const diasAtras = (f) => Math.round((hoy - new Date(f)) / 86400000);

const lineas = D.LINEAS.map((l, i) =>
  "  (" + txt(l.id) + ", " + txt(l.nombre) + ", " + txt(l.descripcion) + ", " + (i + 1) + ")"
).join(",\n");

const causas = D.CAUSAS.map((c, i) =>
  "  (" + txt(c.id) + ", " + txt(c.etiqueta) + ", " + (c.libre ? "true" : "false") + ", " + (i + 1) + ")"
).join(",\n");

const activos = D.ACTIVOS.map((a) =>
  "  (" + txt(a.id) + ", " + txt(a.linea) + ", " + txt(a.tipo) + ", " + txt(a.nombre) + ", " +
  txt(a.etapa) + ", " + a.tarifa + ", " + (a.cuelloBotella ? "true" : "false") + ")"
).join(",\n");

// Los eventos se siembran RELATIVOS a la fecha de ejecución del SQL: así la
// demo siempre se ve reciente sin regenerar el archivo.
const eventos = D.eventos().map((e) => {
  const f = new Date(e.inicio);
  const hh = String(f.getHours()).padStart(2, "0");
  const mm = String(f.getMinutes()).padStart(2, "0");
  const dias = diasAtras(e.inicio);
  return "  (" + txt(e.activo) + ", " + txt(e.causa) + ", " + dias + ", " + txt(hh + ":" + mm) +
    ", " + e.minutos + ", " + txt(hash2(e.activo + e.causa + e.minutos + dias)) +
    ", " + txt(e.nota || "") + ")";
}).join(",\n");

const estados = Object.entries(D.estados()).map(([id, e]) => {
  const min = Math.max(0, Math.round((Date.now() - new Date(e.desde).getTime()) / 60000));
  return "  (" + txt(id) + ", " + txt(e.estado) + ", " + min + ", " + txt(e.causa) + ")";
}).join(",\n");

const solicitudes = D.solicitudes().map((s) =>
  "  (" + txt(s.activo) + ", " + txt(s.causa) + ", " + s.minutosAbierta + ", " +
  txt(s.estado) + ", " + txt(s.reportadoPor) + ", " + txt(hash2(s.activo + "seed")) + ")"
).join(",\n");

const sql = [
"-- ===========================================================================",
"-- DowntimeOS · Semilla de PLANTA — GENERADO AUTOMÁTICAMENTE",
"-- ===========================================================================",
"-- No edites este archivo a mano. Se deriva de public/demo/js/datos.js con:",
"--",
"--     node scripts/generar-seed-planta.js",
"--",
"-- Los eventos se siembran RELATIVOS a la fecha en que ejecutes el SQL",
"-- (current_date - N), así que la demo siempre se ve reciente sin volver a",
"-- generar nada.",
"--",
"-- Ejecutar DESPUÉS de schema-planta.sql. Es idempotente.",
"--",
"-- Generado: " + hoy.toISOString(),
"-- Líneas: " + D.LINEAS.length + " · Activos: " + D.ACTIVOS.length +
  " · Causas: " + D.CAUSAS.length + " · Eventos: " + D.eventos().length,
"-- ===========================================================================",
"",
"begin;",
"",
"-- --------------------------------------------------------------- líneas ---",
"insert into public.planta_lineas (id, nombre, descripcion, orden) values",
lineas,
"on conflict (id) do update",
"  set nombre = excluded.nombre,",
"      descripcion = excluded.descripcion,",
"      orden = excluded.orden;",
"",
"-- --------------------------------------------------------------- causas ---",
"insert into public.planta_causas (id, etiqueta, requiere_texto, orden) values",
causas,
"on conflict (id) do update",
"  set etiqueta = excluded.etiqueta,",
"      requiere_texto = excluded.requiere_texto,",
"      orden = excluded.orden;",
"",
"-- -------------------------------------------------------------- activos ---",
"insert into public.planta_activos (id, linea_id, tipo, nombre, etapa, tarifa_hora, cuello_botella) values",
activos,
"on conflict (id) do update",
"  set linea_id = excluded.linea_id,",
"      tipo = excluded.tipo,",
"      nombre = excluded.nombre,",
"      etapa = excluded.etapa,",
"      tarifa_hora = excluded.tarifa_hora,",
"      cuello_botella = excluded.cuello_botella;",
"",
"-- ------------------------------------------------------ eventos de paro ---",
"-- El folio, la jornada, el turno, la tarifa aplicable y el costo se derivan",
"-- aquí mismo con las funciones del esquema: la semilla no puede discrepar del",
"-- resto de la base porque usa exactamente las mismas reglas.",
"with entradas (activo_id, causa_id, dias, hora, minutos, hash, nota) as (values",
eventos,
"), calculadas as (",
"  select",
"    e.activo_id,",
"    e.causa_id,",
"    e.minutos::numeric as minutos,",
"    e.nota,",
"    (((current_date - e.dias) + e.hora::time) at time zone public.planta_zona()) as inicio,",
"    e.hash",
"  from entradas e",
")",
"insert into public.planta_eventos (",
"  folio, activo_id, causa_id, minutos, inicio, jornada, turno,",
"  retroactivo, tarifa_aplicada, costo_mxn, origen, nota, registrado_por",
")",
"select",
"  replace(a.linea_id, '-', '') || '-' || a.tipo || '-' || replace(a.id, '-', '') || '-' ||",
"    to_char(c.inicio at time zone public.planta_zona(), 'YYYYMMDD') || '-' ||",
"    to_char(c.inicio at time zone public.planta_zona(), 'HH24MI') || '-' || c.hash,",
"  c.activo_id,",
"  c.causa_id,",
"  c.minutos,",
"  c.inicio,",
"  public.planta_jornada(c.inicio),",
"  public.planta_turno(c.inicio),",
"  false,",
"  public.planta_tarifa_aplicable(c.activo_id),",
"  round((c.minutos / 60.0) * public.planta_tarifa_aplicable(c.activo_id), 2),",
"  'historico',",
"  c.nota,",
"  'Semilla'",
"from calculadas c",
"join public.planta_activos a on a.id = c.activo_id",
"on conflict (folio) do nothing;",
"",
"-- ------------------------------------------------------- estado del piso ---",
"insert into public.planta_estados (activo_id, estado, desde, causa_id)",
"select",
"  e.activo_id,",
"  e.estado,",
"  now() - (e.desde_min || ' minutes')::interval,",
"  e.causa_id",
"from (values",
estados,
") as e (activo_id, estado, desde_min, causa_id)",
"on conflict (activo_id) do nothing;",
"",
"-- ------------------------------------------------ bandeja de solicitudes ---",
"insert into public.planta_solicitudes (",
"  folio, activo_id, causa_id, desde, reportado_por, estado, causa_validada_id, validada_en",
")",
"select",
"  replace(a.linea_id, '-', '') || '-' || a.tipo || '-' || replace(a.id, '-', '') || '-' ||",
"    to_char((now() - (s.desde_min || ' minutes')::interval) at time zone public.planta_zona(), 'YYYYMMDD') || '-' ||",
"    to_char((now() - (s.desde_min || ' minutes')::interval) at time zone public.planta_zona(), 'HH24MI') || '-' || s.hash,",
"  s.activo_id,",
"  s.causa_id,",
"  now() - (s.desde_min || ' minutes')::interval,",
"  s.reportado_por,",
"  s.estado,",
"  case when s.estado = 'pendiente' then null else s.causa_id end,",
"  case when s.estado = 'pendiente' then null else now() - (s.desde_min || ' minutes')::interval end",
"from (values",
solicitudes,
") as s (activo_id, causa_id, desde_min, estado, reportado_por, hash)",
"join public.planta_activos a on a.id = s.activo_id",
"on conflict (folio) do nothing;",
"",
"commit;",
"",
"-- ===========================================================================",
"-- COMPROBACIÓN — corre esto después para ver que quedó bien",
"-- ===========================================================================",
"-- select 'activos' as que, count(*) from public.planta_activos",
"-- union all select 'eventos', count(*) from public.planta_eventos",
"-- union all select 'solicitudes abiertas', count(*) from public.planta_solicitudes where not cerrada;",
"--",
"-- select * from public.planta_pareto;",
"-- select turno, sum(costo) from public.planta_por_turno_linea group by turno order by turno;",
"-- ===========================================================================",
""
].join("\n");

fs.writeFileSync(path.join(raiz, "supabase/seed-planta.sql"), sql, "utf8");
console.log("supabase/seed-planta.sql generado");
console.log("  líneas:", D.LINEAS.length, "· activos:", D.ACTIVOS.length,
  "· causas:", D.CAUSAS.length, "· eventos:", D.eventos().length,
  "· solicitudes:", D.solicitudes().length);
