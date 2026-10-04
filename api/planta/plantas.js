import { ruta, json, leerCuerpo } from '../../lib/http.js';
import { sesionDesdeEncabezado } from '../../lib/cuenta.js';
import { exigirPlanActivo } from '../../lib/planes.js';
import { supabase } from '../../lib/supabase.js';

async function disponibilidadMultiplanta(sesion) {
  try {
    const { suscripcion } = await exigirPlanActivo(sesion, 'multiplanta');
    const { count, error } = await supabase.from('plantas').select('id', { count: 'exact', head: true })
      .eq('organizacion_id', sesion.perfil.organizacion_id).eq('activa', true);
    if (error || !Number.isSafeInteger(count)) throw Object.assign(new Error('No pudimos comprobar los sitios incluidos en tu plan.'), { status: 503 });
    const disponible = count < Number(suscripcion.plantas_incluidas);
    return {
      puede_agregar_planta: disponible,
      motivo_agregar_planta: disponible ? '' : 'Tu plan no tiene sitios disponibles. Contacta al titular de la cuenta para ampliar los sitios incluidos.',
    };
  } catch (error) {
    if (error.codigo === 'PLAN_REQUIRED') {
      return { puede_agregar_planta: false, motivo_agregar_planta: 'Agregar plantas requiere un plan activo con la función Multiplanta.' };
    }
    if (error.codigo === 'PLAN_FEATURE_REQUIRED') {
      return { puede_agregar_planta: false, motivo_agregar_planta: 'Agregar plantas está disponible en Enterprise y sujeto a los sitios incluidos en tu cotización.' };
    }
    if (error.codigo === 'PLAN_SITE_LIMIT') {
      return { puede_agregar_planta: false, motivo_agregar_planta: 'Tu plan no tiene sitios disponibles. Contacta al titular de la cuenta para ampliar los sitios incluidos.' };
    }
    throw error;
  }
}

export default ruta(['GET', 'POST'], async (req, res) => {
  const sesion = await sesionDesdeEncabezado(req.headers?.authorization, req.headers?.['x-downtimeos-planta']);
  if (req.method === 'GET') {
    const disponibilidad = await disponibilidadMultiplanta(sesion);
    const esPropietario = sesion.perfil.es_propietario_cuenta === true;
    return json(res, 200, {
      ok: true,
      plantas: sesion.plantas_disponibles,
      ...disponibilidad,
      puede_crear_planta: esPropietario && disponibilidad.puede_agregar_planta,
      motivo_crear_planta: esPropietario ? disponibilidad.motivo_agregar_planta : 'Solo el titular de la cuenta puede agregar plantas.',
    });
  }
  if (sesion.perfil.es_propietario_cuenta !== true) return json(res, 403, { ok: false, error: 'Solo el titular de la cuenta puede agregar plantas.' });
  await exigirPlanActivo(sesion, 'multiplanta');
  const cuerpo = leerCuerpo(req);
  const nombre = String(cuerpo.nombre || '').trim().slice(0, 160);
  if (nombre.length < 2) return json(res, 400, { ok: false, error: 'Escribe el nombre de la planta.' });
  const { data, error } = await supabase.rpc('organizacion_agregar_planta', {
    p_organizacion_id: sesion.perfil.organizacion_id,
    p_usuario_id: sesion.user.id,
    p_planta_origen_id: sesion.perfil.planta_id,
    p_nombre: nombre,
  });
  if (error) {
    const status = ['42501'].includes(error.code) ? 403 : ['23514', '23505'].includes(error.code) ? 409 : 500;
    return json(res, status, { ok: false, error: error.message || 'No pudimos crear la planta.' });
  }
  return json(res, 201, { ok: true, planta: data });
});
