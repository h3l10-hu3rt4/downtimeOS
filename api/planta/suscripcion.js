import { ruta, json, leerCuerpo } from '../../lib/http.js';
import { sesionDesdeEncabezado } from '../../lib/cuenta.js';
import { supabase } from '../../lib/supabase.js';
import { marcarSuscripcionesVencidas } from '../../lib/planes.js';
import { puedeLeerFacturacion, puedeEditarFacturacion } from '../../lib/permisos-facturacion.js';
import { randomUUID } from 'node:crypto';

const BUCKET_COMPROBANTES = 'comprobantes-suscripcion';
const LIMITE_SUSCRIPCIONES_HISTORIAL = 50;
const LIMITE_PAGOS_CONSULTA = 100;
export const MAX_COMPROBANTE_BYTES = 10 * 1024 * 1024;
const TIPOS_COMPROBANTE = new Map([
  ['application/pdf', { extension: 'pdf', firma: (b) => b.subarray(0, 5).toString('ascii') === '%PDF-' }],
  ['image/jpeg', { extension: 'jpg', firma: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff }],
  ['image/png', { extension: 'png', firma: (b) => b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) }],
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validarCantidadPlantasEnterprise(valor) {
  const parsed = typeof valor === 'number' ? valor
    : typeof valor === 'string' && valor.trim() !== '' ? Number(valor) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 3 || parsed > 100) return null;
  return parsed;
}

export function validarArchivoComprobante(tipo, bytes) {
  const regla = TIPOS_COMPROBANTE.get(String(tipo || '').toLowerCase());
  const tamano = Number(bytes);
  if (!regla) throw Object.assign(new Error('Adjunta un PDF, JPG o PNG.'), { status: 415 });
  if (!Number.isSafeInteger(tamano) || tamano < 1 || tamano > MAX_COMPROBANTE_BYTES) {
    throw Object.assign(new Error('El comprobante debe pesar entre 1 byte y 10 MB.'), { status: 413 });
  }
  return { extension: regla.extension, validarFirma: regla.firma };
}

function firmaComprobanteValida(tipo, contenido) {
  const regla = TIPOS_COMPROBANTE.get(String(tipo || '').toLowerCase());
  return Boolean(regla && Buffer.isBuffer(contenido) && regla.firma(contenido));
}

function permisoLectura(sesion) { return puedeLeerFacturacion(sesion.perfil); }
function permisoEdicion(sesion) { return puedeEditarFacturacion(sesion.perfil); }
function denegar(mensaje) { return Object.assign(new Error(mensaje), { status: 403 }); }
function validarReferencia(valor) {
  return String(valor || '').trim().slice(0, 100);
}

export default ruta(['GET', 'POST', 'PATCH'], async (req, res) => {
  const sesion = await sesionDesdeEncabezado(req.headers?.authorization, req.headers?.['x-downtimeos-planta']);
  if (!permisoLectura(sesion)) throw denegar('No tienes permiso para consultar la facturación de esta cuenta.');
  const organizacionId = sesion.perfil.organizacion_id;

  if (req.method === 'GET') {
    const offsetTexto = String(req.query?.offset ?? '0');
    if (!/^\d+$/.test(offsetTexto) || !Number.isSafeInteger(Number(offsetTexto)) || Number(offsetTexto) > 1_000_000) {
      return json(res, 400, { ok: false, error: 'La página del historial no es válida.' });
    }
    const offset = Number(offsetTexto);
    await marcarSuscripcionesVencidas(organizacionId);
    const [planes, subscripciones, suscripcionesPrioritarias, facturacion, plantasActivas] = await Promise.all([
      supabase.from('planes').select('codigo,nombre,precio_mensual_usd,precio_semestral_usd,precio_anual_usd,max_activos,max_plantas,funciones').eq('activo', true).order('precio_semestral_usd'),
      supabase.from('organizacion_suscripciones').select('id,plan_codigo,estado,periodicidad,inicia_en,termina_en,renueva_en,periodo_programado,inicio_programado_en,plantas_incluidas,orden_compra,creada_en', { count: 'exact' }).eq('organizacion_id', organizacionId).order('creada_en', { ascending: false }).order('id', { ascending: false }).range(offset, offset + LIMITE_SUSCRIPCIONES_HISTORIAL - 1),
      supabase.from('organizacion_suscripciones').select('id,plan_codigo,estado,periodicidad,inicia_en,termina_en,renueva_en,periodo_programado,inicio_programado_en,plantas_incluidas,orden_compra,creada_en').eq('organizacion_id', organizacionId).in('estado', ['activa', 'piloto', 'cancelacion_programada', 'solicitada', 'pendiente_pago']).order('creada_en', { ascending: false }).order('id', { ascending: false }).limit(20),
      supabase.from('organizacion_facturacion').select('razon_social,rfc,correo,domicilio_fiscal,referencia_cxp,updated_at').eq('organizacion_id', organizacionId).maybeSingle(),
      supabase.from('plantas').select('id', { count: 'exact', head: true }).eq('organizacion_id', organizacionId).eq('activa', true),
    ]);
    for (const result of [planes, subscripciones, suscripcionesPrioritarias, facturacion, plantasActivas]) if (result.error) throw Object.assign(new Error('No pudimos cargar la información de facturación.'), { status: 500 });
    if (!Number.isSafeInteger(subscripciones.count)) throw Object.assign(new Error('No pudimos consultar el total del historial de suscripciones.'), { status: 500 });
    const paginaSuscripciones = subscripciones.data || [];
    const porId = new Map();
    for (const suscripcion of [...(suscripcionesPrioritarias.data || []), ...paginaSuscripciones]) porId.set(suscripcion.id, suscripcion);
    const filasSuscripciones = [...porId.values()].sort((a, b) => String(b.creada_en || '').localeCompare(String(a.creada_en || '')) || String(b.id).localeCompare(String(a.id)));
    let pagos = [];
    const ids = filasSuscripciones.map((s) => s.id);
    if (ids.length) {
      for (let desde = 0; ; desde += LIMITE_PAGOS_CONSULTA) {
        const resultadoPagos = await supabase.from('organizacion_pagos').select('id,suscripcion_id,estado,importe,moneda,referencia,recibido_en,verificado_en,created_at,comprobante_path').in('suscripcion_id', ids).order('created_at', { ascending: false }).range(desde, desde + LIMITE_PAGOS_CONSULTA - 1);
        if (resultadoPagos.error) throw Object.assign(new Error('No pudimos cargar el historial de pagos.'), { status: 500 });
        const lote = resultadoPagos.data || [];
        pagos.push(...lote);
        if (lote.length < LIMITE_PAGOS_CONSULTA) break;
      }
      const pagoIds = pagos.map((pago) => pago.id);
      if (pagoIds.length) {
        const { data: comprobantes, error: errorComprobantes } = await supabase.from('organizacion_pago_comprobante_intentos')
          .select('id,pago_id,estado,content_type,size_bytes,uploaded_at,reviewed_at').in('pago_id', pagoIds)
          .in('estado', ['recibido', 'verificado', 'rechazado', 'anulado']).order('created_at', { ascending: false });
        if (errorComprobantes) throw Object.assign(new Error('No pudimos cargar el estado de los comprobantes.'), { status: 500 });
        const porPago = new Map();
        for (const comprobante of comprobantes || []) if (!porPago.has(comprobante.pago_id)) porPago.set(comprobante.pago_id, comprobante);
        pagos = pagos.map((pago) => {
          const comprobante = porPago.get(pago.id);
          const { comprobante_path: _pathInterno, ...pagoVisible } = pago;
          return { ...pagoVisible, comprobante: comprobante ? {
            estado: comprobante.estado, tipo: comprobante.content_type,
            bytes: comprobante.size_bytes, recibido_en: comprobante.uploaded_at,
            revisado_en: comprobante.reviewed_at,
          } : null };
        });
      }
    }
    return json(res, 200, {
      ok: true, planes: planes.data || [], suscripciones: filasSuscripciones,
      total_suscripciones: subscripciones.count, offset_suscripciones: offset,
      siguiente_offset_suscripciones: offset + paginaSuscripciones.length,
      hay_mas_suscripciones: offset + paginaSuscripciones.length < subscripciones.count,
      plantas_activas: plantasActivas.count || 0, facturacion: facturacion.data || null,
      pagos, puede_editar: permisoEdicion(sesion),
    });
  }

  if (!permisoEdicion(sesion)) throw denegar('Pide al titular de la cuenta que te otorgue el permiso de facturación.');
  const cuerpo = leerCuerpo(req);
  if (req.method === 'POST' && cuerpo.accion === 'iniciar_comprobante') {
    if (!UUID.test(String(cuerpo.pago_id || ''))) return json(res, 400, { ok: false, error: 'Pago no válido.' });
    let archivo;
    try { archivo = validarArchivoComprobante(cuerpo.tipo, cuerpo.bytes); }
    catch (error) { return json(res, error.status || 400, { ok: false, error: error.message }); }
    const { data: pago, error: errorPago } = await supabase.from('organizacion_pagos')
      .select('id,suscripcion_id,estado,comprobante_path').eq('id', cuerpo.pago_id).maybeSingle();
    if (errorPago) throw Object.assign(new Error('No pudimos validar el pago.'), { status: 500 });
    if (!pago) return json(res, 404, { ok: false, error: 'No encontramos ese pago.' });
    if (pago.estado !== 'pendiente' || pago.comprobante_path) return json(res, 409, { ok: false, error: 'Este pago ya no acepta comprobantes.' });
    const { data: suscripcion, error: errorSuscripcion } = await supabase.from('organizacion_suscripciones')
      .select('id,organizacion_id').eq('id', pago.suscripcion_id).maybeSingle();
    if (errorSuscripcion || !suscripcion || suscripcion.organizacion_id !== organizacionId) return json(res, 404, { ok: false, error: 'No encontramos ese pago.' });
    const id = randomUUID();
    const storagePath = `${organizacionId}/${suscripcion.id}/${pago.id}/${id}.${archivo.extension}`;
    const { data: intento, error: errorIntento } = await supabase.rpc('organizacion_pago_crear_comprobante_intento', {
      p_organizacion_id: organizacionId, p_usuario_id: sesion.user.id, p_pago_id: pago.id,
      p_intento_id: id, p_storage_path: storagePath, p_content_type: String(cuerpo.tipo).toLowerCase(), p_size_bytes: Number(cuerpo.bytes),
    });
    if (errorIntento || !intento) {
      if (errorIntento?.code === '42501') return json(res, 403, { ok: false, error: errorIntento.message });
      if (['23505', '23514'].includes(errorIntento?.code)) return json(res, 409, { ok: false, error: errorIntento.message });
      throw Object.assign(new Error('No pudimos preparar la carga del comprobante.'), { status: 500 });
    }
    const { data: carga, error: errorCarga } = await supabase.storage.from(BUCKET_COMPROBANTES).createSignedUploadUrl(storagePath, { upsert: false });
    if (errorCarga || !carga?.token) {
      await supabase.from('organizacion_pago_comprobante_intentos').delete().eq('id', id).eq('estado', 'carga_pendiente');
      throw Object.assign(new Error('No pudimos habilitar la carga segura del comprobante.'), { status: 503 });
    }
    return json(res, 201, { ok: true, intento_id: id, path: carga.path, token: carga.token, bucket: BUCKET_COMPROBANTES, content_type: String(cuerpo.tipo).toLowerCase() });
  }

  if (req.method === 'POST' && cuerpo.accion === 'finalizar_comprobante') {
    if (!UUID.test(String(cuerpo.intento_id || ''))) return json(res, 400, { ok: false, error: 'Carga no válida.' });
    const { data: intento, error: errorIntento } = await supabase.from('organizacion_pago_comprobante_intentos')
      .select('id,pago_id,suscripcion_id,organizacion_id,usuario_id,storage_path,content_type,size_bytes,estado,created_at')
      .eq('id', cuerpo.intento_id).eq('organizacion_id', organizacionId).eq('usuario_id', sesion.user.id).maybeSingle();
    if (errorIntento) throw Object.assign(new Error('No pudimos validar la carga.'), { status: 500 });
    if (!intento || intento.estado !== 'carga_pendiente' || Date.now() - Date.parse(intento.created_at) > 20 * 60 * 1000) {
      return json(res, 409, { ok: false, error: 'La carga venció o ya fue procesada. Inicia una nueva carga.' });
    }
    const { data: archivoSubido, error: errorDescarga } = await supabase.storage.from(BUCKET_COMPROBANTES).download(intento.storage_path);
    if (errorDescarga || !archivoSubido) return json(res, 409, { ok: false, error: 'No encontramos el archivo cargado. Vuelve a intentar.' });
    const contenido = Buffer.from(await archivoSubido.arrayBuffer());
    try { validarArchivoComprobante(intento.content_type, contenido.length); }
    catch (error) { return json(res, error.status || 400, { ok: false, error: error.message }); }
    if (contenido.length !== Number(intento.size_bytes) || !firmaComprobanteValida(intento.content_type, contenido)) {
      await supabase.storage.from(BUCKET_COMPROBANTES).remove([intento.storage_path]);
      return json(res, 415, { ok: false, error: 'El archivo no coincide con el formato declarado. Selecciona un PDF, JPG o PNG válido.' });
    }
    const { data: guardado, error: errorGuardar } = await supabase.rpc('organizacion_pago_confirmar_comprobante', {
      p_organizacion_id: organizacionId, p_usuario_id: sesion.user.id, p_intento_id: intento.id,
    });
    if (errorGuardar) {
      if (errorGuardar.code === '42501') return json(res, 403, { ok: false, error: errorGuardar.message });
      if (['23505', '23514', 'P0002'].includes(errorGuardar.code)) return json(res, 409, { ok: false, error: errorGuardar.message });
      throw Object.assign(new Error('No pudimos registrar el comprobante.'), { status: 500 });
    }
    return json(res, 200, { ok: true, comprobante: guardado, mensaje: 'Comprobante recibido. El equipo de DowntimeOS lo revisará; subirlo no activa el plan.' });
  }
  if (req.method === 'POST' && ['solicitar', 'renovar'].includes(cuerpo.accion)) {
    const renovar = cuerpo.accion === 'renovar';
    const codigo = String(cuerpo.plan || '').toLowerCase();
    const periodo = String(cuerpo.periodicidad || '');
    if (!['starter', 'pro', 'enterprise'].includes(codigo) || !['semestral', 'anual'].includes(periodo)) {
      return json(res, 400, { ok: false, error: 'Selecciona un plan y una periodicidad válidos.' });
    }
    let cantidadPlantas = 1;
    if (codigo === 'enterprise') {
      cantidadPlantas = validarCantidadPlantasEnterprise(cuerpo.plantas);
      if (cantidadPlantas === null) {
        return json(res, 400, { ok: false, error: 'Enterprise requiere indicar entre 3 y 100 plantas.' });
      }
    }
    const referencia = validarReferencia(cuerpo.orden_compra);
    const { data: subscripcion, error } = await supabase.rpc(
      renovar ? 'organizacion_renovar_plan' : 'organizacion_solicitar_plan',
      renovar ? {
        p_organizacion_id: organizacionId, p_usuario_id: sesion.user.id,
        p_suscripcion_actual_id: cuerpo.suscripcion_actual_id,
        p_plan_codigo: codigo, p_periodicidad: periodo,
        p_plantas: cantidadPlantas, p_orden_compra: referencia,
      } : {
        p_organizacion_id: organizacionId, p_usuario_id: sesion.user.id, p_plan_codigo: codigo,
        p_periodicidad: periodo, p_plantas: cantidadPlantas, p_orden_compra: referencia,
      },
    );
    if (error) {
      if (error.code === '23505') return json(res, 409, { ok: false, error: error.message || 'El estado de la suscripción cambió. Actualiza la página e inténtalo de nuevo.' });
      if (error.code === '22023') return json(res, 400, { ok: false, error: error.message });
      if (error.code === '23514') return json(res, 409, { ok: false, error: error.message });
      if (error.code === '42501') return json(res, 403, { ok: false, error: error.message });
      if (error.code === 'P0002') return json(res, 404, { ok: false, error: error.message });
      throw Object.assign(new Error('No pudimos registrar la solicitud de plan.'), { status: 500 });
    }
    return json(res, 201, { ok: true, suscripcion: subscripcion, importe_usd: subscripcion.importe_usd, mensaje: renovar
      ? 'Solicitud de renovación recibida. El pago queda pendiente de validación; no habrá cargos automáticos y el nuevo periodo empezará al terminar el vigente.'
      : 'Solicitud recibida. El equipo de DowntimeOS confirmará el pago y activará el plan.' });
  }

  if (req.method === 'POST' && cuerpo.accion === 'cancelar') {
    const { data, error } = await supabase.rpc('organizacion_cancelar_suscripcion', {
      p_organizacion_id: organizacionId,
      p_suscripcion_id: cuerpo.id,
      p_planta_id: sesion.perfil.planta_id,
      p_actor_id: sesion.user.id,
    });
    if (error) {
      if (error.code === 'P0002') return json(res, 404, { ok: false, error: 'No encontramos la suscripción de tu empresa.' });
      if (error.code === '23505' || error.code === '22023') return json(res, 409, { ok: false, error: error.message });
      throw Object.assign(new Error('No pudimos registrar la solicitud de cancelación.'), { status: 500 });
    }
    const programada = data?.estado === 'cancelacion_programada';
    return json(res, 200, { ok: true, estado: data?.estado, mensaje: data?.reembolso_manual
      ? 'La renovación se canceló antes de iniciar. El pago ya verificado no se reembolsa automáticamente; contacta a DowntimeOS para gestionar la devolución.'
      : programada ? 'La cancelación quedó programada al final del periodo contratado.' : 'La suscripción y cualquier pago pendiente fueron cancelados.' });
  }

  if (req.method === 'PATCH' && cuerpo.accion === 'facturacion') {
    const entrada = {
      organizacion_id: organizacionId,
      razon_social: String(cuerpo.razon_social || '').trim().slice(0, 180),
      rfc: String(cuerpo.rfc || '').trim().toUpperCase().slice(0, 13),
      correo: String(cuerpo.correo || '').trim().slice(0, 254),
      domicilio_fiscal: String(cuerpo.domicilio_fiscal || '').trim().slice(0, 500),
      referencia_cxp: String(cuerpo.referencia_cxp || '').trim().slice(0, 120),
      updated_by: sesion.user.id, updated_at: new Date().toISOString(),
    };
    if (entrada.rfc && !/^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$/.test(entrada.rfc)) return json(res, 400, { ok: false, error: 'El RFC no tiene el formato esperado.' });
    const { error } = await supabase.from('organizacion_facturacion').upsert(entrada, { onConflict: 'organizacion_id' });
    if (error) throw Object.assign(new Error('No pudimos guardar los datos fiscales.'), { status: 500 });
    await supabase.from('planta_auditoria').insert({ organizacion_id: organizacionId, planta_id: sesion.perfil.planta_id, actor_id: sesion.user.id, accion: 'datos_facturacion_actualizados', entidad: 'facturacion', entidad_id: organizacionId, detalles: { rfc: entrada.rfc } });
    return json(res, 200, { ok: true, mensaje: 'Datos de facturación guardados.' });
  }
  return json(res, 400, { ok: false, error: 'Acción de facturación no válida.' });
});
