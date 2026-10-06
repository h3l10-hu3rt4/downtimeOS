/**
 * DowntimeOS · Acceso a datos de PLANTA sobre Supabase.
 *
 * Es a las tablas `planta_*` lo que `repositorio.js` es a `leads`: el ÚNICO
 * módulo que habla con la base para la operación. Los handlers de `/api/planta`
 * no conocen Supabase.
 *
 * REGLA QUE NO SE NEGOCIA
 * El costo de un paro NUNCA llega del cliente. Se calcula aquí, con la tarifa
 * que la base considera aplicable en ese momento —la de la línea completa si el
 * activo es cuello de botella— y se congela junto al evento. Es la misma regla
 * que rige `POST /api/leads`: el navegador propone, el servidor dispone.
 */
import { supabase } from './supabase.js';
import { agregarImpactoActual } from './visibilidad-financiera.js';

const ZONA = 'America/Mexico_City';

/** PostgREST serializa `numeric` como cadena; el frontend espera números. */
function num(v) {
  return v === null || v === undefined ? null : Number(v);
}

function fallar(error, mensaje) {
  const e = new Error(`${mensaje}: ${error.message}`);
  e.status = 500;
  e.causaOriginal = error;
  throw e;
}

function errorPeticion(mensaje, status = 400) {
  const e = new Error(mensaje);
  e.status = status;
  return e;
}

/** Aplica aislamiento de organización: una consulta nunca cruza de planta. */
function dePlanta(consulta, plantaId) { return plantaId ? consulta.eq('planta_id', plantaId) : consulta; }

/* ==========================================================================
   REGLAS DE NEGOCIO — duplicadas a propósito del esquema SQL
   --------------------------------------------------------------------------
   Están en las dos capas porque cada una protege algo distinto: la de SQL
   impide que una fila mal formada entre por cualquier vía, y la de aquí
   permite responder al cliente con un mensaje útil en vez de un error de
   restricción. Si cambias una, cambia la otra.
   ========================================================================== */

/** T1 06:00–14:00 · T2 14:00–22:00 · T3 22:00–06:00, en hora de planta. */
export function turnoDe(fechaISO) {
  const h = horaLocal(fechaISO);
  if (h >= 6 && h < 14) return 'T1';
  if (h >= 14 && h < 22) return 'T2';
  return 'T3';
}

/**
 * Jornada productiva. El turno 3 cruza la medianoche, así que un paro de las
 * 02:00 del día 5 pertenece a la jornada del día 4.
 */
export function jornadaDe(fechaISO) {
  const partes = partesLocales(fechaISO);
  if (partes.hora < 6) {
    const d = new Date(Date.UTC(partes.anio, partes.mes - 1, partes.dia));
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }
  return `${partes.anio}-${String(partes.mes).padStart(2, '0')}-${String(partes.dia).padStart(2, '0')}`;
}

/** Descompone un instante en la hora de la planta, no en la del servidor. */
function partesLocales(fechaISO) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date(fechaISO)).map((x) => [x.type, x.value]));
  return {
    anio: Number(p.year), mes: Number(p.month), dia: Number(p.day),
    hora: Number(p.hour) % 24, minuto: Number(p.minute),
  };
}

function horaLocal(fechaISO) {
  return partesLocales(fechaISO).hora;
}

const ALFABETO_HASH = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function hash2(semilla) {
  let h = 0;
  const s = String(semilla);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 1156;
  return ALFABETO_HASH[Math.floor(h / 34)] + ALFABETO_HASH[h % 34];
}

/**
 * Folio estandarizado: `L01-SR-C01-20260904-1425-A1`.
 * La fecha en YYYYMMDD y la hora en HHMM hacen que el orden lexicográfico
 * coincida con el cronológico, así que ordenar como texto plano basta.
 */
export function folioDe(activo, fechaISO, semilla) {
  const p = partesLocales(fechaISO);
  const ymd = `${p.anio}${String(p.mes).padStart(2, '0')}${String(p.dia).padStart(2, '0')}`;
  const hm = `${String(p.hora).padStart(2, '0')}${String(p.minuto).padStart(2, '0')}`;
  return [
    activo.linea_id.replace('-', ''),
    activo.tipo,
    activo.id.replace('-', ''),
    ymd,
    hm,
    hash2(semilla ?? activo.id + ymd + hm),
  ].join('-');
}

/* ==========================================================================
   LECTURA
   ========================================================================== */

/**
 * Todo el estado de la planta en una sola llamada.
 *
 * Se devuelve junto a propósito: los tres tableros necesitan el catálogo, la
 * bitácora, el estado vivo y la bandeja a la vez, y una función serverless que
 * responde una vez es más barata que cuatro que responden por separado.
 */
const FECHA_JORNADA = /^\d{4}-\d{2}-\d{2}$/;

export async function eventosDePlanta({ desde = null, hasta = null, limite = 500, plantaId = null, cursor = null, snapshot = null, porJornada = false } = {}) {
  const corte = snapshot || new Date().toISOString();
  let q = dePlanta(supabase.from('planta_bitacora').select('*'), plantaId)
    .lte('created_at', corte)
    .order('created_at', { ascending: true })
    .order('folio', { ascending: true })
    .limit(limite);
  // Los tableros hablan en jornadas (un paro de la madrugada del día 6 pertenece
  // a la jornada del día 5). Con `porJornada`, las fechas AAAA-MM-DD se comparan
  // contra la jornada del evento y no contra el día UTC de `inicio`.
  if (desde) q = porJornada && FECHA_JORNADA.test(desde) ? q.gte('jornada', desde) : q.gte('inicio', desde);
  if (hasta) q = porJornada && FECHA_JORNADA.test(hasta) ? q.lte('jornada', hasta) : q.lte('inicio', hasta);
  if (cursor) {
    q = q.or(`created_at.gt.${cursor.created_at},and(created_at.eq.${cursor.created_at},folio.gt.${cursor.folio})`);
  }
  const resultado = await q;
  if (resultado.error) fallar(resultado.error, 'No fue posible leer la bitácora');
  const filas = resultado.data || [];
  const ultima = filas.at(-1);
  return {
    eventos: filas.map((e) => ({
      ...e,
      minutos: num(e.minutos),
      tarifa_aplicada: num(e.tarifa_aplicada),
      costo_mxn: num(e.costo_mxn),
    })),
    snapshot: corte,
    siguiente_cursor: filas.length === limite && ultima
      ? { created_at: ultima.created_at, folio: ultima.folio, snapshot: corte }
      : null,
  };
}

export async function estadoPlanta({ desde = null, hasta = null, limite = 500, plantaId = null, porJornada = false } = {}) {
  const [lineas, causas, activos, estados, solicitudes] = await Promise.all([
    dePlanta(supabase.from('planta_lineas').select('*').eq('activa', true), plantaId).order('orden'),
    supabase.from('planta_causas').select('*').order('orden'),
    dePlanta(supabase.from('planta_activos').select('*').eq('activo', true), plantaId).order('id'),
    dePlanta(supabase.from('planta_estados').select('*'), plantaId),
    // Incluimos también las ya cerradas: Operaciones necesita conservar la
    // trazabilidad de una aprobación o rechazo después de que el activo
    // vuelva a operar. La bandeja del cliente sigue filtrando solo pendientes.
    dePlanta(supabase.from('planta_solicitudes').select('*'), plantaId).order('desde', { ascending: false }).limit(limite),
  ]);

  for (const r of [lineas, causas, activos, estados, solicitudes]) {
    if (r.error) fallar(r.error, 'No fue posible leer el estado de la planta');
  }

  const paginaEventos = await eventosDePlanta({ desde, hasta, limite, plantaId, porJornada });

  return {
    lineas: lineas.data,
    causas: causas.data.map((c) => ({ ...c, requiere_texto: !!c.requiere_texto })),
    activos: activos.data.map((a) => ({ ...a, tarifa_hora: num(a.tarifa_hora) })),
    estados: estados.data,
    solicitudes: solicitudes.data,
    eventos: paginaEventos.eventos,
    paginacion_eventos: {
      snapshot: paginaEventos.snapshot,
      siguiente_cursor: paginaEventos.siguiente_cursor,
    },
  };
}

/** Descarga todas las páginas de eventos para análisis y reportes de servidor. */
export async function estadoPlantaCompleto(opciones = {}) {
  const estado = await estadoPlanta({ ...opciones, limite: 500 });
  const eventos = estado.eventos.slice();
  let cursor = estado.paginacion_eventos.siguiente_cursor;
  while (cursor) {
    const pagina = await eventosDePlanta({
      ...opciones,
      limite: 500,
      cursor,
      snapshot: cursor.snapshot,
    });
    eventos.push(...pagina.eventos);
    cursor = pagina.siguiente_cursor;
  }
  return { ...estado, eventos, paginacion_eventos: { ...estado.paginacion_eventos, siguiente_cursor: null } };
}

/**
 * Delta pequeño para el sondeo de tableros: solo estados actuales y solicitudes
 * todavía abiertas. Nunca consulta ni devuelve eventos/historial.
 */
export async function estadoVivoPlanta({ plantaId = null } = {}) {
  const [estados, solicitudes] = await Promise.all([
    dePlanta(supabase.from('planta_estados').select('activo_id,estado,desde,causa_id,causa_libre'), plantaId),
    dePlanta(supabase.from('planta_solicitudes').select(
      'folio,activo_id,causa_id,causa_libre,desde,reportado_por,estado,causa_validada_id,validada_en,resuelta_por,cerrada',
    ).eq('cerrada', false).eq('estado', 'pendiente'), plantaId).order('desde', { ascending: false }),
  ]);
  for (const resultado of [estados, solicitudes]) {
    if (resultado.error) fallar(resultado.error, 'No fue posible leer el estado vivo de la planta');
  }
  return { estados: estados.data, solicitudes: solicitudes.data };
}

/** Enriquece únicamente el estado vivo para Operaciones; nunca devuelve tarifas. */
export async function impactoActualEstados(estados, { plantaId = null } = {}) {
  const activos = await dePlanta(
    supabase.from('planta_activos').select('id,linea_id,etapa,tarifa_hora').eq('activo', true), plantaId,
  );
  if (activos.error) fallar(activos.error, 'No fue posible calcular el impacto de los paros');
  return agregarImpactoActual({ activos: activos.data, estados });
}

/** Activo con su tarifa aplicable ya resuelta por la base. */
async function activoConTarifa(idActivo, plantaId = null) {
  const { data, error } = await dePlanta(
    supabase.from('planta_activos').select('*').eq('id', idActivo).eq('activo', true), plantaId,
  ).maybeSingle();
  if (error) fallar(error, 'No fue posible leer el activo');
  if (!data) throw errorPeticion(`El activo ${idActivo} no existe.`);

  const { data: tarifa, error: errTarifa } = await supabase
    .rpc('planta_tarifa_aplicable', { p_activo: idActivo, p_planta_id: plantaId });
  if (errTarifa) fallar(errTarifa, 'No fue posible calcular la tarifa aplicable');

  return { ...data, tarifa_hora: num(data.tarifa_hora), tarifa_aplicable: num(tarifa) };
}

/* ==========================================================================
   ESCRITURA
   ========================================================================== */

/**
 * Alta de un evento de paro. El cliente manda activo, causa, minutos e inicio;
 * el costo, la jornada, el turno y el folio se derivan aquí.
 */
export async function crearEvento(datos, { plantaId = null } = {}) {
  const activo = await activoConTarifa(datos.activo_id, plantaId);

  const minutos = Number(datos.minutos);
  if (!Number.isFinite(minutos) || minutos <= 0 || minutos > 4320) {
    throw errorPeticion('Los minutos de paro deben estar entre 1 y 4320 (72 horas).');
  }

  const inicio = new Date(datos.inicio ?? Date.now());
  if (Number.isNaN(inicio.getTime())) throw errorPeticion('La fecha de inicio no es válida.');
  const inicioISO = inicio.toISOString();

  const causa = await causaValida(datos.causa_id, datos.causa_libre);

  const fila = {
    ...(plantaId ? { planta_id: plantaId } : {}),
    folio: folioDe(activo, inicioISO, activo.id + Date.now()),
    activo_id: activo.id,
    causa_id: causa.id,
    causa_libre: causa.libre,
    minutos,
    inicio: inicioISO,
    jornada: jornadaDe(inicioISO),
    turno: turnoDe(inicioISO),
    retroactivo: !!datos.retroactivo,
    tarifa_aplicada: activo.tarifa_aplicable,
    costo_mxn: Math.round((minutos / 60) * activo.tarifa_aplicable * 100) / 100,
    origen: datos.origen ?? 'demo',
    nota: datos.nota ?? '',
    registrado_por: datos.registrado_por ?? '',
  };

  const { data, error } = await supabase.from('planta_eventos').insert(fila).select().single();
  if (error) fallar(error, 'No fue posible registrar el paro');
  return { ...data, minutos: num(data.minutos), costo_mxn: num(data.costo_mxn) };
}

/** Corrección de un evento ya capturado. Recalcula el costo si cambian minutos. */
export async function editarEvento(folio, cambios, { plantaId = null } = {}) {
  const { data: actual, error: errLectura } = await dePlanta(
    supabase.from('planta_eventos').select('*').eq('folio', folio), plantaId,
  ).maybeSingle();
  if (errLectura) fallar(errLectura, 'No fue posible leer el evento');
  if (!actual) throw errorPeticion(`El evento ${folio} no existe.`);

  const parche = {};

  if (cambios.causa_id !== undefined) {
    const causa = await causaValida(cambios.causa_id, cambios.causa_libre);
    parche.causa_id = causa.id;
    parche.causa_libre = causa.libre;
  }

  if (cambios.minutos !== undefined) {
    const minutos = Number(cambios.minutos);
    if (!Number.isFinite(minutos) || minutos <= 0 || minutos > 4320) {
      throw errorPeticion('Los minutos de paro deben estar entre 1 y 4320.');
    }
    parche.minutos = minutos;
    // La tarifa congelada NO se toca: corregir una duración mal capturada no
    // debe reprecionar el evento con las tarifas de hoy.
    parche.costo_mxn = Math.round((minutos / 60) * Number(actual.tarifa_aplicada) * 100) / 100;
  }

  if (cambios.nota !== undefined) parche.nota = String(cambios.nota).slice(0, 500);
  if (Object.keys(parche).length === 0) throw errorPeticion('No hay nada que cambiar.');

  const { data, error } = await dePlanta(
    supabase.from('planta_eventos').update(parche).eq('folio', folio), plantaId,
  ).select().single();
  if (error) fallar(error, 'No fue posible corregir el evento');
  return { ...data, minutos: num(data.minutos), costo_mxn: num(data.costo_mxn) };
}

/**
 * Borrado con rastro. El evento sale de la operación pero queda registrado en
 * `planta_cancelaciones`: una cancelación sin huella es indistinguible de un
 * dato que nunca existió.
 */
export async function eliminarEvento(folio, { motivo = '', por = '', plantaId = null } = {}) {
  if (!plantaId) throw errorPeticion('Se requiere la planta de la sesión para cancelar un evento.', 401);
  const { data, error } = await supabase.rpc('planta_cancelar_evento', {
    p_planta_id: plantaId,
    p_folio: folio,
    p_motivo: motivo || 'Sin motivo declarado',
    p_cancelado_por: por,
  });
  if (error) {
    if (error.code === 'P0002') throw errorPeticion(`El evento ${folio} no existe en esta planta.`, 404);
    fallar(error, 'No fue posible cancelar el evento');
  }
  return data;
}

/* ------------------------------------------------------------ solicitudes */

/**
 * Reporte de piso atómico. La base crea el STOP y la solicitud en una única
 * transacción: ningún tablero puede observar solo una mitad del reporte.
 */
export async function reportarParo(datos, { plantaId = null } = {}) {
  if (!plantaId) throw errorPeticion('Se requiere la planta de la sesión para reportar un paro.', 401);
  const { data, error } = await supabase.rpc('planta_reportar_paro', {
    p_planta_id: plantaId,
    p_activo_id: datos.activo_id,
    p_causa_id: datos.causa_id,
    p_causa_libre: datos.causa_libre ?? null,
    p_desde: datos.desde ?? null,
    p_reportado_por: datos.reportado_por ?? '',
    p_reportado_por_user_id: datos.reportado_por_user_id,
  });
  if (error) {
    if (error.code === '22023') throw Object.assign(new Error(error.message), { status: 400 });
    if (error.code === '23505') throw Object.assign(new Error(error.message), { status: 409 });
    fallar(error, 'No fue posible registrar el paro de piso');
  }
  return data;
}

/** Retira solo el reporte pendiente del operador autenticado y libera el activo atómicamente. */
export async function retirarReporteOperador(folio, userId, { plantaId = null } = {}) {
  if (!plantaId || !userId) throw errorPeticion('Se requiere la sesión autenticada para retirar el reporte.', 401);
  const { data, error } = await supabase.rpc('planta_retirar_reporte_operador', {
    p_planta_id: plantaId,
    p_folio: folio,
    p_user_id: userId,
  });
  if (error) {
    if (error.code === '22023') throw Object.assign(new Error(error.message), { status: 400 });
    if (error.code === '42501') throw Object.assign(new Error(error.message), { status: 403 });
    if (error.code === 'P0002') throw Object.assign(new Error(error.message), { status: 404 });
    if (error.code === '23505') throw Object.assign(new Error(error.message), { status: 409 });
    fallar(error, 'No fue posible retirar el reporte');
  }
  return data;
}

/** Registra atómicamente estado STOP y solicitud aprobada de Mantenimiento. */
export async function reportarParoMantenimiento(datos, { plantaId = null } = {}) {
  if (!plantaId) throw errorPeticion('Se requiere la planta de la sesión para registrar el paro.', 401);
  const { data, error } = await supabase.rpc('planta_reportar_paro_mantenimiento', {
    p_planta_id: plantaId,
    p_activo_id: datos.activo_id,
    p_causa_id: datos.causa_id,
    p_causa_libre: datos.causa_libre ?? null,
    p_reportado_por: datos.reportado_por ?? '',
  });
  if (error) {
    if (error.code === 'P0002') throw Object.assign(new Error(error.message), { status: 409 });
    if (error.code === '22023') throw Object.assign(new Error(error.message), { status: 400 });
    if (error.code === '23505') throw Object.assign(new Error(error.message), { status: 409 });
    fallar(error, 'No fue posible registrar el paro de Mantenimiento');
  }
  return data;
}

/**
 * Cierra atómicamente un paro abierto: genera su evento, cambia el activo a
 * RUN y cierra las solicitudes relacionadas dentro de una sola transacción.
 */
export async function cerrarParoReportado(datos, { plantaId = null, organizacionId = null, usuarioId = null } = {}) {
  if (!plantaId || !organizacionId || !usuarioId) throw errorPeticion('Se requiere la sesión completa para cerrar un paro.', 401);
  const origen = datos.origen === 'mantenimiento' ? 'mantenimiento' : 'piso';
  const { data, error } = await supabase.rpc('planta_cerrar_paro_auditado', {
    p_organizacion_id: organizacionId,
    p_planta_id: plantaId,
    p_usuario_id: usuarioId,
    p_activo_id: datos.activo_id,
    p_registrado_por: datos.registrado_por ?? '',
    p_origen: origen,
  });
  if (error) {
    if (error.code === '42501') throw Object.assign(new Error(error.message), { status: 403 });
    if (['P0002', '22023'].includes(error.code)) {
      throw Object.assign(new Error(error.message), { status: error.code === 'P0002' ? 409 : 400 });
    }
    fallar(error, 'No fue posible cerrar y guardar el paro');
  }
  return data;
}

/**
 * Mantenimiento resuelve una solicitud pendiente.
 *
 * ⚠️ NO toca `desde` en ningún caso: el cronómetro y la pérdida del paro corren
 * desde que el operador lo reportó, no desde que se valida. Validar solo
 * oficializa la causa raíz.
 */
export async function resolverSolicitud(folio, resolucion, { causa_id = null, causa_libre = null, por = '', plantaId = null } = {}) {
  if (resolucion !== 'aprobada') {
    throw errorPeticion('Solo se puede aprobar por esta acción. Para rechazar un falso positivo, usa descartar.');
  }
  const { data: actual, error: errLectura } = await dePlanta(
    supabase.from('planta_solicitudes').select('*').eq('folio', folio), plantaId,
  ).maybeSingle();
  if (errLectura) fallar(errLectura, 'No fue posible leer la solicitud');
  if (!actual) throw errorPeticion(`La solicitud ${folio} no existe.`);

  const causa = causa_id ? await causaValida(causa_id, causa_libre) : { id: actual.causa_id, libre: actual.causa_libre };

  const { data, error } = await dePlanta(supabase.from('planta_solicitudes').update({
    estado: resolucion,
    causa_validada_id: causa.id,
    causa_libre: causa.libre,
    validada_en: new Date().toISOString(),
    resuelta_por: por,
  }).eq('folio', folio).eq('estado', 'pendiente').eq('cerrada', false), plantaId).select().maybeSingle();
  if (error) fallar(error, 'No fue posible resolver la solicitud');
  if (!data) throw errorPeticion('La solicitud ya fue resuelta o cerrada. Actualiza la bandeja antes de volver a intentarlo.', 409);
  return data;
}

/**
 * Descartar = deshacer el reporte. Queda como rechazada para la trazabilidad y
 * la máquina vuelve a RUN SIN registrar evento ni costo, salvo que otro
 * reporte vigente (pendiente o aprobado) sostenga el paro de esa máquina.
 * Es la única regla de rechazo: la usan el tablero web y WhatsApp.
 */
export async function descartarSolicitud(folio, { por = '', plantaId = null } = {}) {
  if (!plantaId) throw errorPeticion('Se requiere la planta de la sesión para descartar el reporte.', 401);
  const { data, error } = await supabase.rpc('planta_descartar_solicitud', {
    p_planta_id: plantaId,
    p_folio: folio,
    p_resuelta_por: por,
  });
  if (error) {
    if (error.code === 'P0002') throw Object.assign(new Error(error.message), { status: 404 });
    if (error.code === '23514') throw Object.assign(new Error(error.message), { status: 409 });
    fallar(error, 'No fue posible descartar el reporte');
  }
  return data;
}

/**
 * Resolución que llega por un canal asíncrono (WhatsApp). Solo actúa sobre
 * pendientes: un toque tardío o repetido no revierte lo que ya se decidió en
 * el tablero.
 */
export async function resolverPendiente(folio, resolucion, { por = '', plantaId = null } = {}) {
  const { data: actual, error } = await dePlanta(
    supabase.from('planta_solicitudes').select('estado').eq('folio', folio), plantaId,
  ).maybeSingle();
  if (error) fallar(error, 'No fue posible leer la solicitud');
  if (!actual) throw errorPeticion(`La solicitud ${folio} no existe.`);
  if (actual.estado !== 'pendiente') return { ignorada: true, estado: actual.estado };
  if (resolucion === 'rechazada') return descartarSolicitud(folio, { por, plantaId });
  return { solicitud: await resolverSolicitud(folio, 'aprobada', { por, plantaId }) };
}

/** Reclasifica la causa sin resolver todavía. Tampoco toca `desde`. */
export async function reclasificarSolicitud(folio, causa_id, causa_libre = null, { plantaId = null } = {}) {
  if (!plantaId) throw errorPeticion('Se requiere la planta de la sesión para reclasificar la solicitud.', 401);
  const { data, error } = await supabase.rpc('planta_reclasificar_solicitud', {
    p_planta_id: plantaId,
    p_folio: folio,
    p_causa_id: causa_id,
    p_causa_libre: causa_libre ?? null,
  });
  if (error) {
    if (error.code === 'P0002') throw Object.assign(new Error(error.message), { status: 404 });
    if (error.code === '23514') throw Object.assign(new Error(error.message), { status: 409 });
    if (error.code === '22023') throw Object.assign(new Error(error.message), { status: 400 });
    fallar(error, 'No fue posible reclasificar la solicitud');
  }
  return data;
}

/* -------------------------------------------------------------- auxiliares */

/**
 * Valida la causa contra el catálogo y exige el texto libre cuando toca.
 * Se hace aquí y no solo en el cliente porque «Otros» sin motivo convierte el
 * catálogo cerrado en un cajón de sastre, y eso arruina el Pareto para siempre.
 */
async function causaValida(idCausa, textoLibre) {
  const { data, error } = await supabase
    .from('planta_causas').select('*').eq('id', idCausa).maybeSingle();
  if (error) fallar(error, 'No fue posible leer la causa');
  if (!data) throw errorPeticion(`La causa ${idCausa} no existe en el catálogo.`);

  const libre = textoLibre ? String(textoLibre).trim().slice(0, 120) : null;
  if (data.requiere_texto && (!libre || libre.length < 3)) {
    throw errorPeticion('La causa «Otros» necesita que se describa el motivo específico.');
  }
  return { id: data.id, libre: data.requiere_texto ? libre : null };
}
