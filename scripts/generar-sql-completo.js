/**
 * Genera `supabase/EJECUTAR-TODO.sql`: los tres archivos de Supabase
 * concatenados en el orden correcto, para copiar y pegar de una sola vez en el
 * SQL Editor.
 *
 * Existe porque pegar tres archivos en orden es un paso donde es fácil
 * equivocarse, y equivocarse aquí deja la base a medio migrar.
 *
 *     node scripts/generar-sql-completo.js
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.join(__dirname, "..");

const PARTES = [
  ["PASO 1 de 5 — Ordena lo viejo: factor de recuperacion 0.35 -> 0.20",
    "supabase/migraciones/2026-09-04-factor-mttr-20.sql"],
  ["PASO 2 de 5 — Crea el esquema de PLANTA (tablas planta_*)",
    "supabase/schema-planta.sql"],
  ["PASO 3 de 5 — Siembra la planta de demostracion",
    "supabase/seed-planta.sql"],
  ["PASO 4 de 5 — Integraciones: perfiles, analisis de IA, reportes PDF y mensajes de WhatsApp",
    "supabase/migraciones/2026-09-05-integraciones.sql"],
  ["PASO 5 de 5 — Capacidad por etapa (1/N) y reporte atomico de paro desde piso",
    "supabase/migraciones/2026-09-05-capacidad-y-reporte-atomico.sql"],
];

const cabecera = [
  "-- ###########################################################################",
  "-- DowntimeOS · EJECUTAR TODO EN SUPABASE",
  "-- ###########################################################################",
  "--",
  "--   COMO SE USA",
  "--   1. Selecciona TODO este archivo (Ctrl+A) y copialo (Ctrl+C).",
  "--   2. Pegalo en Supabase -> SQL Editor.",
  "--   3. Pulsa Run.",
  "--",
  "--   Son los tres archivos de supabase/ concatenados en el orden correcto.",
  "--   Todo es idempotente: si ya corriste alguna parte, volver a ejecutarlo no",
  "--   rompe nada ni duplica datos.",
  "--",
  "--   Al terminar, corre la comprobacion que esta al final del archivo.",
  "--",
  "--   GENERADO AUTOMATICAMENTE — no lo edites. Se rehace con:",
  "--       node scripts/generar-sql-completo.js",
  "-- ###########################################################################",
  "",
].join("\n");

const comprobacion = [
  "",
  "",
  "-- ###########################################################################",
  "-- COMPROBACION — corre esto despues y revisa los numeros",
  "-- ###########################################################################",
  "-- Esperado: 2 lineas · 12 activos · 7 causas · N eventos (crece con el uso) ·",
  "-- 0-2 solicitudes abiertas · 31+ leads · las 4 tablas de integraciones en 0",
  "-- (estan vacias hasta el primer analisis de IA / reporte / mensaje real).",
  "select 'lineas'              as que, count(*) as cuantos from public.planta_lineas",
  "union all select 'activos',            count(*) from public.planta_activos",
  "union all select 'causas',             count(*) from public.planta_causas",
  "union all select 'eventos',            count(*) from public.planta_eventos",
  "union all select 'solicitudes',        count(*) from public.planta_solicitudes",
  "union all select 'perfiles',           count(*) from public.planta_perfiles",
  "union all select 'analisis_ia',        count(*) from public.planta_analisis_ia",
  "union all select 'reportes',           count(*) from public.planta_reportes",
  "union all select 'mensajes_whatsapp',  count(*) from public.planta_mensajes",
  "union all select 'leads (viejo)',      count(*) from public.leads",
  "order by 1;",
  "",
  "-- K-01 debe quedar marcado como cuello de botella tras el paso 5:",
  "select id, etapa, cuello_botella from public.planta_activos where id = 'K-01';",
  "",
].join("\n");

const partes = PARTES.map(([titulo, ruta]) => [
  "",
  "",
  "-- ###########################################################################",
  "-- " + titulo,
  "-- ###########################################################################",
  "",
  fs.readFileSync(path.join(raiz, ruta), "utf8"),
].join("\n"));

fs.writeFileSync(
  path.join(raiz, "supabase/EJECUTAR-TODO.sql"),
  cabecera + partes.join("") + comprobacion,
  "utf8",
);

console.log("supabase/EJECUTAR-TODO.sql generado desde", PARTES.length, "archivos");
