import { ruta, json, leerCuerpo } from '../../lib/http.js';
import { exigirSesionAdministrador } from '../../lib/administracion.js';
import { supabase } from '../../lib/supabase.js';
import { urlParaNavegador } from '../../lib/url-local.js';

export default ruta(['GET', 'PATCH', 'POST'], async (req, res) => {
  exigirSesionAdministrador(req);
  if (req.method === 'GET') {
    const limite = 100;
    const offsetTexto = String(req.query?.offset ?? '0');
    if (!/^\d+$/.test(offsetTexto) || !Number.isSafeInteger(Number(offsetTexto)) || Number(offsetTexto) > 1_000_000) {
      return json(res, 400, { ok: false, error: 'La página solicitada no es válida.' });
    }
    const offset = Number(offsetTexto);
    const { data, error, count } = await supabase.from('organizacion_suscripciones')
      .select('id,organizacion_id,plan_codigo,estado,periodicidad,inicia_en,termina_en,inicio_programado_en,plantas_incluidas,orden_compra,creada_en,periodo_programado,organizaciones(nombre),organizacion_pagos(id,estado,importe,moneda,referencia,created_at,comprobante_path)', { count: 'exact' })
      .order('creada_en', { ascending: false }).order('id', { ascending: false })
      .range(offset, offset + limite - 1);
    if (error || !Number.isSafeInteger(count)) throw Object.assign(new Error('No pudimos cargar las solicitudes de suscripción.'), { status: 500 });
    const suscripciones = data || [];
    const pagoIds = suscripciones.flatMap((sub) => (sub.organizacion_pagos || []).map((pago) => pago.id));
    let comprobantes = [];
    if (pagoIds.length) {
      const { data: filas, error: errorComprobantes } = await supabase.from('organizacion_pago_comprobante_intentos')
        .select('id,pago_id,storage_path,content_type,size_bytes,estado,uploaded_at,reviewed_at')
        .in('pago_id', pagoIds).in('estado', ['recibido', 'verificado', 'rechazado', 'anulado']).order('created_at', { ascending: false });
      if (errorComprobantes) throw Object.assign(new Error('No pudimos cargar los comprobantes.'), { status: 500 });
      comprobantes = filas || [];
    }
    const porPago = new Map();
    for (const fila of comprobantes) if (!porPago.has(fila.pago_id)) porPago.set(fila.pago_id, fila);
    const admin = process.env.DASHBOARD_ADMIN_EMAIL || 'administrador';
    const conAdjuntos = [];
    for (const sub of suscripciones) {
      const pagos = [];
      // PostgREST no garantiza el orden de las relaciones anidadas. La UI toma
      // el primer pago para mostrar su estado y comprobante, así que ordenamos
      // aquí de forma explícita para priorizar siempre el más reciente.
      const pagosOrdenados = [...(sub.organizacion_pagos || [])].sort((a, b) => {
        const diferencia = Date.parse(b.created_at || '') - Date.parse(a.created_at || '');
        return Number.isNaN(diferencia) || diferencia === 0
          ? String(b.id).localeCompare(String(a.id))
          : diferencia;
      });
      for (const pago of pagosOrdenados) {
        const fila = porPago.get(pago.id);
        let comprobante = null;
        if (fila) {
          const prefijo = `${sub.organizacion_id}/${sub.id}/${pago.id}/`;
          const nombre = fila.storage_path.startsWith(prefijo) ? fila.storage_path.slice(prefijo.length) : '';
          if (!/^[0-9a-f-]{36}\.(pdf|jpg|png)$/i.test(nombre)) throw Object.assign(new Error('La referencia del comprobante no es válida.'), { status: 500 });
          const { data: firmado, error: errorFirma } = await supabase.storage.from('comprobantes-suscripcion').createSignedUrl(fila.storage_path, 180);
          if (errorFirma || !firmado?.signedUrl) throw Object.assign(new Error('No pudimos preparar el acceso temporal al comprobante.'), { status: 503 });
          comprobante = { estado: fila.estado, tipo: fila.content_type, bytes: fila.size_bytes, recibido_en: fila.uploaded_at, revisado_en: fila.reviewed_at, url: urlParaNavegador(firmado.signedUrl) };
          const { error: errorAuditoria } = await supabase.from('planta_auditoria').insert({
            organizacion_id: sub.organizacion_id, actor_externo: admin, accion: 'comprobante_pago_enlace_temporal',
            entidad: 'pago', entidad_id: pago.id, detalles: { comprobante_id: fila.id, duracion_segundos: 180 },
          });
          if (errorAuditoria) throw Object.assign(new Error('No pudimos registrar el acceso al comprobante.'), { status: 500 });
        }
        const { comprobante_path: _pathInterno, ...pagoVisible } = pago;
        pagos.push({ ...pagoVisible, comprobante });
      }
      conAdjuntos.push({ ...sub, organizacion_pagos: pagos });
    }
    return json(res, 200, {
      ok: true,
      suscripciones: conAdjuntos,
      total: count,
      offset,
      hay_mas: offset + conAdjuntos.length < count,
    });
  }

  const cuerpo = leerCuerpo(req);
  if (req.method === 'POST' && cuerpo.accion === 'piloto_por_correo') {
    const correo = String(cuerpo.correo || '').trim().toLowerCase();
    if (correo.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
      return json(res, 400, { ok: false, error: 'Escribe un correo válido.' });
    }

    // El correo solo identifica al titular: jamás se concede acceso a quien lo
    // escriba. El RPC vuelve a validar la propiedad y activa el piloto atómico.
    let propietario = null;
    for (let page = 1; ; page += 1) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw Object.assign(new Error('No pudimos validar el correo de la cuenta.'), { status: 503 });
      const usuarios = Array.isArray(data?.users) ? data.users : [];
      propietario = usuarios.find((usuario) => String(usuario.email || '').trim().toLowerCase() === correo) || null;
      if (propietario || usuarios.length < 1000) break;
    }
    if (!propietario) return json(res, 404, { ok: false, error: 'No encontramos una cuenta registrada con ese correo.' });

    const { data: perfiles, error: errorPerfil } = await supabase.from('planta_perfiles')
      .select('organizacion_id,user_id,planta_id,nombre')
      .eq('user_id', propietario.id).eq('es_admin_cuenta', true).eq('activo', true);
    if (errorPerfil) throw Object.assign(new Error('No pudimos validar que el correo sea titular de una cuenta.'), { status: 503 });
    if (!perfiles?.length) return json(res, 404, { ok: false, error: 'Ese correo no corresponde al administrador fundador de una empresa.' });
    let organizacion = null;
    for (const perfil of perfiles) {
      if (!perfil.organizacion_id) continue;
      const { data, error } = await supabase.from('organizaciones')
        .select('id,nombre,propietario_id').eq('id', perfil.organizacion_id).maybeSingle();
      if (error) throw Object.assign(new Error('No pudimos validar la empresa de esa cuenta.'), { status: 503 });
      if (data?.propietario_id === propietario.id) { organizacion = data; break; }
    }
    if (!organizacion) return json(res, 403, { ok: false, error: 'El correo no coincide con el titular fundador de una empresa.' });

    const { data, error } = await supabase.rpc('organizacion_admin_activar_piloto_titular', {
      p_organizacion_id: organizacion.id,
      p_propietario_id: propietario.id,
      p_admin: process.env.DASHBOARD_ADMIN_EMAIL || 'administrador',
    });
    if (error) {
      const status = error.code === 'P0002' ? 404 : ['23505', '23514', '22023'].includes(error.code) ? 409 : 400;
      return json(res, status, { ok: false, error: error.message });
    }
    return json(res, 200, {
      ok: true,
      mensaje: `Piloto de 14 días activado para ${correo}.`,
      resultado: { ...data, correo, organizacion: organizacion.nombre },
    });
  }

  if (!cuerpo.id || !['activar', 'piloto', 'rechazar', 'rechazar_comprobante'].includes(cuerpo.accion)) return json(res, 400, { ok: false, error: 'Solicitud de activación no válida.' });
  const { data, error } = await supabase.rpc('organizacion_admin_resolver_solicitud', {
    p_suscripcion_id: cuerpo.id, p_accion: cuerpo.accion,
    p_admin: process.env.DASHBOARD_ADMIN_EMAIL || 'administrador',
  });
  if (error) {
    const status = error.code === 'P0002' ? 404 : ['23505', '23514'].includes(error.code) ? 409 : 400;
    return json(res, status, { ok: false, error: error.message });
  }
  const renovacionProgramada = Boolean(data?.renovacion_programada);
  const mensaje = cuerpo.accion === 'rechazar' ? 'Solicitud rechazada.'
    : cuerpo.accion === 'rechazar_comprobante' ? 'Comprobante rechazado. El pago sigue pendiente y la empresa puede adjuntar otro.'
    : cuerpo.accion === 'piloto' ? 'Piloto de 14 días activado.'
      : renovacionProgramada ? 'Pago verificado. La renovación quedó programada para después del periodo vigente.'
        : 'Pago verificado y plan activado.';
  return json(res, 200, { ok: true, mensaje, resultado: data });
});
