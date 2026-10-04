import { ruta, json, leerCuerpo } from '../../lib/http.js';
import { exigirPlanActivo } from '../../lib/planes.js';
import { exigirRolProducto, sesionDesdeEncabezado } from '../../lib/cuenta.js';
import { supabase } from '../../lib/supabase.js';

export function mapearErrorEstructura(error) {
  if (error?.code === '23514' && /plan alcanzó su límite de equipos activos/i.test(error.message || '')) {
    return {
      status: 409,
      cuerpo: {
        ok: false,
        codigo: 'PLAN_ASSET_LIMIT',
        error: 'Llegaste al límite de equipos activos incluido en tu plan. Revisa tus opciones de suscripción para agregar más.',
      },
    };
  }
  if (error?.code === 'P0002') {
    return { status: 404, cuerpo: { ok: false, error: error.message || 'No encontramos el equipo activo en esta planta.' } };
  }
  if (error?.code === '42501') {
    return { status: 403, cuerpo: { ok: false, error: error.message || 'No tienes permiso para editar equipos de esta planta.' } };
  }
  if (['23505', '23514', '55P03'].includes(error?.code)) {
    return { status: 409, cuerpo: { ok: false, error: error.message || 'El equipo cambió o tiene una operación pendiente. Actualiza la lista e inténtalo de nuevo.' } };
  }
  if (['22023', '23503'].includes(error?.code)) {
    return { status: 400, cuerpo: { ok: false, error: error.message || 'Revisa los datos del equipo y la línea seleccionada.' } };
  }
  return {
    status: 503,
    cuerpo: { ok: false, error: error?.message || 'No pudimos actualizar la estructura de la planta.' },
  };
}

export default ruta(['GET', 'POST', 'PATCH'], async (req, res) => {
  const sesion = await sesionDesdeEncabezado(req.headers?.authorization, req.headers?.['x-downtimeos-planta']);
  exigirRolProducto(sesion, ['direccion', 'admin']);

  if (req.method === 'GET') {
    const [lineas, activos] = await Promise.all([
      supabase.from('planta_lineas').select('id,nombre,orden,activa,archivado_en').eq('planta_id', sesion.perfil.planta_id).order('orden'),
      supabase.from('planta_activos').select('id,linea_id,tipo,nombre,etapa,etapa_orden,tarifa_hora,cuello_botella,activo,archivado_en').eq('planta_id', sesion.perfil.planta_id).order('id'),
    ]);
    if (lineas.error || activos.error) throw Object.assign(new Error('No pudimos cargar la estructura de la planta.'), { status: 500 });
    return json(res, 200, { ok: true, lineas: lineas.data || [], activos: activos.data || [] });
  }

  const cuerpo = leerCuerpo(req);
  let accion;
  if (req.method === 'POST') {
    const { plan } = await exigirPlanActivo(sesion);
    accion = cuerpo.tipo === 'linea' ? 'crear_linea' : cuerpo.tipo === 'activo' ? 'crear_activo' : '';
    if (!accion) return json(res, 400, { ok: false, error: 'Tipo de elemento no válido.' });
    if (accion === 'crear_activo') {
      const { count, error: conteoError } = await supabase.from('planta_activos').select('id', { count: 'exact', head: true })
        .eq('planta_id', sesion.perfil.planta_id).eq('activo', true).is('archivado_en', null);
      if (conteoError) throw Object.assign(new Error('No pudimos validar el límite de equipos.'), { status: 503 });
      if (plan.max_activos != null && count >= plan.max_activos) return json(res, 409, { ok: false, codigo: 'PLAN_ASSET_LIMIT', error: `El plan permite hasta ${plan.max_activos} equipos activos. Amplía tu plan para agregar más.` });
    }
  } else {
    accion = ['archivar_linea', 'archivar_activo', 'actualizar_activo'].includes(cuerpo.accion) ? cuerpo.accion : '';
    if (!accion || (accion === 'actualizar_activo' ? !cuerpo.activo?.id : !cuerpo.id)) {
      return json(res, 400, { ok: false, error: 'Indica el equipo que quieres editar o archivar.' });
    }
  }

  const { data, error } = accion === 'actualizar_activo'
    ? await supabase.rpc('planta_editar_activo', {
      p_planta_id: sesion.perfil.planta_id,
      p_usuario_id: sesion.user.id,
      p_activo: cuerpo.activo,
    })
    : await supabase.rpc('planta_actualizar_estructura', {
      p_planta_id: sesion.perfil.planta_id,
      p_usuario_id: sesion.user.id,
      p_accion: accion,
      p_linea: cuerpo.tipo === 'linea' ? cuerpo.linea : null,
      p_activo: cuerpo.tipo === 'activo' ? cuerpo.activo : null,
      p_id: cuerpo.id || null,
    });
  if (error) {
    const mapeado = mapearErrorEstructura(error);
    return json(res, mapeado.status, mapeado.cuerpo);
  }

  const { error: auditError } = await supabase.from('planta_auditoria').insert({
    organizacion_id: sesion.perfil.organizacion_id, planta_id: sesion.perfil.planta_id,
    actor_id: sesion.user.id, accion: `estructura_${accion}`, entidad: cuerpo.tipo || (accion.endsWith('linea') ? 'linea' : 'activo'),
    entidad_id: data.linea_id || data.activo_id || cuerpo.id, detalles: data,
  });
  if (auditError) console.error('[downtimeos] fallo auditoría de estructura:', auditError.message);
  return json(res, req.method === 'POST' ? 201 : 200, { ok: true, resultado: data });
});
