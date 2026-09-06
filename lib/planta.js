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

function errorPeticion(mensaje) {
  const e = new Error(mensaje);
  e.status = 400;
  return e;
}

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
export async function estadoPlanta({ desde = null, hasta = null, limite = 500 } = {}) {
  const [lineas, causas, activos, estados, solicitudes] = await Promise.all([
    supabase.from('planta_lineas').select('*').order('orden'),
    supabase.from('planta_causas').select('*').order('orden'),
    supabase.from('planta_activos').select('*').order('id'),
    supabase.from('planta_estados').select('*'),
    // Incluimos también las ya cerradas: Operaciones necesita conservar la
    // trazabilidad de una aprobación o rechazo después de que el activo
    // vuelva a operar. La bandeja del cliente sigue filtrando solo pendientes.
    supabase.from('planta_solicitudes').select('*').order('desde', { ascending: false }).limit(limite),
  ]);

  for (const r of [lineas, causas, activos, estados, solicitudes]) {
    if (r.error) fallar(r.error, 'No fue posible leer el estado de la planta');
  }

  let q = supabase.from('planta_bitacora').select('*').order('inicio', { ascending: false }).limit(limite);
  if (desde) q = q.gte('inicio', desde);
  if (hasta) q = q.lte('inicio', hasta);
  const eventos = await q;
  if (eventos.error) fallar(eventos.error, 'No fue posible leer la bitácora');

  return {
    lineas: lineas.data,
    causas: causas.data.map((c) => ({ ...c, requiere_texto: !!c.requiere_texto })),
    activos: activos.data.map((a) => ({ ...a, tarifa_hora: num(a.tarifa_hora) })),
    estados: estados.data,
    solicitudes: solicitudes.data,
    eventos: eventos.data.map((e) => ({
      ...e,
      minutos: num(e.minutos),
      tarifa_aplicada: num(e.tarifa_aplicada),
      costo_mxn: num(e.costo_mxn),
    })),
  };
}

/** Activo con su tarifa aplicable ya resuelta por la base. */
async function activoConTarifa(idActivo) {
  const { data, error } = await supabase
    .from('planta_activos').select('*').eq('id', idActivo).maybeSingle();
  if (error) fallar(error, 'No fue posible leer el activo');
  if (!data) throw errorPeticion(`El activo ${idActivo} no existe.`);

  const { data: tarifa, error: errTarifa } = await supabase
    .rpc('planta_tarifa_aplicable', { p_activo: idActivo });
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
export async function crearEvento(datos) {
  const activo = await activoConTarifa(datos.activo_id);

  const minutos = Number(datos.minutos);
  if (!Number.isFinite(minutos) || minutos <= 0 || minutos > 4320) {
    throw errorPeticion('Los minutos de paro deben estar entre 1 y 4320 (72 horas).');
  }

  const inicio = new Date(datos.inicio ?? Date.now());
  if (Number.isNaN(inicio.getTime())) throw errorPeticion('La fecha de inicio no es válida.');
  const inicioISO = inicio.toISOString();

  const causa = await causaValida(datos.causa_id, datos.causa_libre);

  const fila = {
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
export async function editarEvento(folio, cambios) {
  const { data: actual, error: errLectura } = await supabase
    .from('planta_eventos').select('*').eq('folio', folio).maybeSingle();
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

  const { data, error } = await supabase
    .from('planta_eventos').update(parche).eq('folio', folio).select().single();
  if (error) fallar(error, 'No fue posible corregir el evento');
  return { ...data, minutos: num(data.minutos), costo_mxn: num(data.costo_mxn) };
}

/**
 * Borrado con rastro. El evento sale de la operación pero queda registrado en
 * `planta_cancelaciones`: una cancelación sin huella es indistinguible de un
 * dato que nunca existió.
 */
export async function eliminarEvento(folio, { motivo = '', por = '' } = {}) {
  const { data: evento, error: errLectura } = await supabase
    .from('planta_eventos').select('*').eq('folio', folio).maybeSingle();
  if (errLectura) fallar(errLectura, 'No fue posible leer el evento');
  if (!evento) throw errorPeticion(`El evento ${folio} no existe.`);

  const { error: errLog } = await supabase.from('planta_cancelaciones').insert({
    folio_evento: evento.folio,
    activo_id: evento.activo_id,
    causa_id: evento.causa_id,
    minutos: evento.minutos,
    inicio: evento.inicio,
    motivo: motivo || 'Sin motivo declarado',
    cancelado_por: por,
  });
  if (errLog) fallar(errLog, 'No fue posible registrar la cancelación');

  const { error } = await supabase.from('planta_eventos').delete().eq('folio', folio);
  if (error) fallar(error, 'No fue posible eliminar el evento');
  return { folio, cancelado: true };
}

/**
 * Cambio de estado de un activo. Solo RUN o STOP: "Setup" no es un estado, es
 * la captura de un paro que ya terminó y produce un evento, no un cambio aquí.
 *
 * `desde` explícito permite deshacer el cierre de un paro restaurando su marca
 * ORIGINAL. Reiniciarla haría aparecer el paro más corto de lo que fue.
 */
export async function cambiarEstado(idActivo, estado, { causa_id = null, causa_libre = null, desde = null } = {}) {
  const activo = await activoConTarifa(idActivo);
  const normalizado = estado === 'STOP' ? 'STOP' : 'RUN';

  let causa = { id: null, libre: null };
  if (normalizado === 'STOP') {
    if (!causa_id) throw errorPeticion('Un paro necesita una causa.');
    causa = await causaValida(causa_id, causa_libre);
  }

  const fila = {
    activo_id: activo.id,
    estado: normalizado,
    desde: desde ? new Date(desde).toISOString() : new Date().toISOString(),
    causa_id: causa.id,
    causa_libre: causa.libre,
    actualizado_en: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('planta_estados').upsert(fila, { onConflict: 'activo_id' }).select().single();
  if (error) fallar(error, 'No fue posible cambiar el estado del activo');
  return data;
}

/* ------------------------------------------------------------ solicitudes */

/**
 * Reporte de piso atómico. La base crea el STOP y la solicitud en una única
 * transacción: ningún tablero puede observar solo una mitad del reporte.
 */
export async function reportarParo(datos) {
  const { data, error } = await supabase.rpc('planta_reportar_paro', {
    p_activo_id: datos.activo_id,
    p_causa_id: datos.causa_id,
    p_causa_libre: datos.causa_libre ?? null,
    p_desde: datos.desde ?? null,
    p_reportado_por: datos.reportado_por ?? '',
  });
  if (error) fallar(error, 'No fue posible registrar el paro de piso');
  return data;
}

export async function crearSolicitud(datos) {
  const activo = await activoConTarifa(datos.activo_id);
  const causa = await causaValida(datos.causa_id, datos.causa_libre);
  const desde = datos.desde ? new Date(datos.desde).toISOString() : new Date().toISOString();

  const fila = {
    folio: folioDe(activo, desde, activo.id + 'sol' + Date.now()),
    activo_id: activo.id,
    causa_id: causa.id,
    causa_libre: causa.libre,
    desde,
    reportado_por: datos.reportado_por ?? '',
    estado: 'pendiente',
  };

  const { data, error } = await supabase.from('planta_solicitudes').insert(fila).select().single();
  if (error) fallar(error, 'No fue posible crear la solicitud');
  return data;
}

/**
 * Mantenimiento resuelve una solicitud pendiente.
 *
 * ⚠️ NO toca `desde` en ningún caso: el cronómetro y la pérdida del paro corren
 * desde que el operador lo reportó, no desde que se valida. Validar solo
 * oficializa la causa raíz.
 */
export async function resolverSolicitud(folio, resolucion, { causa_id = null, causa_libre = null, por = '' } = {}) {
  if (!['aprobada', 'rechazada'].includes(resolucion)) {
    throw errorPeticion('La resolución debe ser "aprobada" o "rechazada".');
  }
  const { data: actual, error: errLectura } = await supabase
    .from('planta_solicitudes').select('*').eq('folio', folio).maybeSingle();
  if (errLectura) fallar(errLectura, 'No fue posible leer la solicitud');
  if (!actual) throw errorPeticion(`La solicitud ${folio} no existe.`);

  const causa = causa_id ? await causaValida(causa_id, causa_libre) : { id: actual.causa_id, libre: actual.causa_libre };

  const { data, error } = await supabase.from('planta_solicitudes').update({
    estado: resolucion,
    causa_validada_id: causa.id,
    causa_libre: causa.libre,
    validada_en: new Date().toISOString(),
    resuelta_por: por,
  }).eq('folio', folio).select().single();
  if (error) fallar(error, 'No fue posible resolver la solicitud');
  return data;
}

/** Reclasifica la causa sin resolver todavía. Tampoco toca `desde`. */
export async function reclasificarSolicitud(folio, causa_id, causa_libre = null) {
  const causa = await causaValida(causa_id, causa_libre);
  const { data, error } = await supabase.from('planta_solicitudes')
    .update({ causa_id: causa.id, causa_libre: causa.libre })
    .eq('folio', folio).select().single();
  if (error) fallar(error, 'No fue posible reclasificar la solicitud');
  if (!data) throw errorPeticion(`La solicitud ${folio} no existe.`);
  return data;
}

/** Cierra las solicitudes abiertas de un activo, al volver a producción. */
export async function cerrarSolicitudesDe(idActivo) {
  const { data, error } = await supabase.from('planta_solicitudes')
    .update({ cerrada: true }).eq('activo_id', idActivo).eq('cerrada', false).select();
  if (error) fallar(error, 'No fue posible cerrar las solicitudes');
  return { cerradas: data?.length ?? 0 };
}

export async function eliminarSolicitud(folio) {
  const { error } = await supabase.from('planta_solicitudes').delete().eq('folio', folio);
  if (error) fallar(error, 'No fue posible eliminar la solicitud');
  return { folio, eliminada: true };
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
