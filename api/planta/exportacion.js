import { ruta, json } from '../../lib/http.js';
import { exigirRolProducto, sesionDesdeEncabezado } from '../../lib/cuenta.js';
import { exigirExportacion } from '../../lib/planes.js';
import { supabase } from '../../lib/supabase.js';

const TAMANO_PAGINA = 500;

function cursorValido(valor) {
  if (!valor) return null;
  let cursor;
  try { cursor = JSON.parse(valor); } catch {
    throw Object.assign(new Error('El cursor de exportación no es válido.'), { status: 400 });
  }
  if (!cursor || typeof cursor.created_at !== 'string' || Number.isNaN(Date.parse(cursor.created_at)) ||
      typeof cursor.folio !== 'string' || !cursor.folio || cursor.folio.length > 200) {
    throw Object.assign(new Error('El cursor de exportación no es válido.'), { status: 400 });
  }
  return { created_at: new Date(cursor.created_at).toISOString(), folio: cursor.folio };
}

function fechaValida(valor) {
  if (!valor) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    throw Object.assign(new Error('La fecha de exportación no es válida.'), { status: 400 });
  }
  const fecha = new Date(`${valor}T00:00:00Z`);
  if (Number.isNaN(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== valor) {
    throw Object.assign(new Error('La fecha de exportación no es válida.'), { status: 400 });
  }
  return valor;
}

function offsetMexico(fecha) {
  // Zona de planta configurada actualmente: America/Mexico_City. Se calcula
  // el offset para cada fecha, en vez de fijar -06:00 durante todo el año.
  const instante = new Date(`${fecha}T12:00:00Z`);
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Mexico_City', timeZoneName: 'longOffset', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(instante);
  const nombre = partes.find((parte) => parte.type === 'timeZoneName')?.value || 'GMT-06:00';
  const coincidencia = nombre.match(/GMT([+-]\d{2}:\d{2})/);
  return coincidencia?.[1] || '+00:00';
}

function siguienteFecha(fecha) {
  const valor = new Date(`${fecha}T00:00:00Z`);
  valor.setUTCDate(valor.getUTCDate() + 1);
  return valor.toISOString().slice(0, 10);
}

export default ruta(['GET'], async (req, res) => {
  const sesion = await sesionDesdeEncabezado(req.headers?.authorization, req.headers?.['x-downtimeos-planta']);
  exigirRolProducto(sesion, ['direccion', 'finanzas']);
  await exigirExportacion(sesion);
  // `offset` se conserva como compatibilidad de primera página para clientes
  // anteriores. La exportación larga nueva usa cursor keyset y no desplazamiento.
  const offset = Number.parseInt(req.query?.offset || '0', 10);
  const cursor = cursorValido(req.query?.cursor);
  const limite = Number.parseInt(req.query?.limite || String(TAMANO_PAGINA), 10);
  if (!Number.isSafeInteger(offset) || offset < 0 || (!cursor && offset > TAMANO_PAGINA) || !Number.isSafeInteger(limite) || limite < 1 || limite > TAMANO_PAGINA) {
    throw Object.assign(new Error('El bloque de exportación no es válido.'), { status: 400 });
  }
  const desde = fechaValida(req.query?.desde);
  const hasta = fechaValida(req.query?.hasta);
  if (desde && hasta && desde > hasta) throw Object.assign(new Error('La fecha inicial debe ser anterior a la final.'), { status: 400 });

  const snapshot = req.query?.snapshot || new Date().toISOString();
  if (Number.isNaN(Date.parse(snapshot))) throw Object.assign(new Error('El corte de exportación no es válido.'), { status: 400 });
  const hastaSnapshot = new Date(snapshot).toISOString();

  let consulta = supabase.from('planta_bitacora')
    .select('folio,activo_id,linea_id,activo_nombre,causa_mostrada,minutos,inicio,jornada,turno,retroactivo,costo_mxn,created_at')
    .eq('planta_id', sesion.perfil.planta_id)
    .lte('created_at', hastaSnapshot)
    .order('created_at', { ascending: true })
    .order('folio', { ascending: true });
  if (cursor) {
    // PostgREST no expresa directamente la comparación lexicográfica de dos
    // columnas; esta disyunción equivale a (created_at, folio) > cursor.
    consulta = consulta.or(`created_at.gt.${cursor.created_at},and(created_at.eq.${cursor.created_at},folio.gt.${cursor.folio})`);
  } else {
    consulta = consulta.range(offset, offset + limite - 1);
  }
  if (cursor) consulta = consulta.limit(limite);
  if (desde) consulta = consulta.gte('inicio', `${desde}T00:00:00${offsetMexico(desde)}`);
  if (hasta) {
    const diaPosterior = siguienteFecha(hasta);
    consulta = consulta.lt('inicio', `${diaPosterior}T00:00:00${offsetMexico(diaPosterior)}`);
  }
  const { data, error } = await consulta;
  if (error) throw Object.assign(new Error('No pudimos exportar la bitácora de esta planta.'), { status: 503 });

  const auditoria = await supabase.from('planta_auditoria').insert({
    organizacion_id: sesion.perfil.organizacion_id,
    planta_id: sesion.perfil.planta_id,
    actor_id: sesion.user.id,
    accion: 'bitacora_exportada',
    entidad: 'planta_eventos',
    entidad_id: sesion.perfil.planta_id,
    detalles: { offset: cursor ? null : offset, cursor: cursor || null, filas: data?.length || 0, desde, hasta, snapshot: hastaSnapshot },
  });
  if (auditoria.error) throw Object.assign(new Error('No pudimos registrar la auditoría de exportación; inténtalo de nuevo.'), { status: 503 });

  const filas = (data || []).map((evento) => {
    const { costo_mxn: costo, ...operativo } = evento;
    return sesion.perfil.rol === 'direccion' || sesion.perfil.rol === 'finanzas' || sesion.perfil.es_admin_cuenta
      ? { ...operativo, costo_mxn: costo }
      : operativo;
  });
  const ultimaFila = filas.at(-1);
  const siguienteCursor = filas.length === limite && ultimaFila
    ? JSON.stringify({ created_at: ultimaFila.created_at, folio: ultimaFila.folio })
    : null;
  return json(res, 200, {
    ok: true,
    filas,
    offset,
    siguiente_offset: filas.length === limite ? offset + filas.length : null,
    siguiente_cursor: siguienteCursor,
    snapshot: hastaSnapshot,
  });
});
