import { supabase } from './supabase.js';

function errorPlan(mensaje, codigo = 'PLAN_REQUIRED', status = 402) {
  return Object.assign(new Error(mensaje), { status, codigo });
}

/** Materializa el vencimiento al consultar el producto o la pantalla de pagos. */
export async function marcarSuscripcionesVencidas(organizacionId, ahora = new Date()) {
  if (!organizacionId) return 0;
  const marcaTiempo = ahora.toISOString();
  const { error: programadasError } = await supabase.from('organizacion_suscripciones')
    .update({ periodo_programado: false, updated_at: marcaTiempo })
    .eq('organizacion_id', organizacionId).eq('periodo_programado', true)
    .in('estado', ['activa', 'piloto', 'cancelacion_programada'])
    .not('inicia_en', 'is', null).lte('inicia_en', marcaTiempo);
  if (programadasError) throw Object.assign(new Error('No pudimos actualizar el periodo programado.'), { status: 503 });
  const { data, error } = await supabase.from('organizacion_suscripciones')
    .update({ estado: 'vencida', updated_at: marcaTiempo })
    .eq('organizacion_id', organizacionId)
    .in('estado', ['activa', 'piloto', 'cancelacion_programada'])
    .not('termina_en', 'is', null)
    .lte('termina_en', marcaTiempo)
    .select('id');
  if (error) throw Object.assign(new Error('No pudimos actualizar el estado vencido de la suscripción.'), { status: 503 });
  return data?.length || 0;
}

/** Comprueba en servidor la suscripción de la organización y su vigencia. */
export async function exigirPlanActivo(sesion, funcion = null) {
  await marcarSuscripcionesVencidas(sesion.perfil.organizacion_id);
  const { data: filas, error } = await supabase.from('organizacion_suscripciones')
    .select('id,plan_codigo,estado,inicia_en,termina_en,renueva_en,periodicidad,plantas_incluidas')
    .eq('organizacion_id', sesion.perfil.organizacion_id)
    .in('estado', ['piloto', 'activa', 'cancelacion_programada'])
    .order('creada_en', { ascending: false }).limit(10);
  if (error) throw Object.assign(new Error('No pudimos validar el plan de tu empresa.'), { status: 503 });
  const ahora = Date.now();
  const actual = (filas || []).find((fila) => {
    const inicio = fila.inicia_en ? Date.parse(fila.inicia_en) : 0;
    const fin = fila.termina_en ? Date.parse(fila.termina_en) : Number.POSITIVE_INFINITY;
    return inicio <= ahora && fin > ahora;
  });
  if (!actual) throw errorPlan('Tu planta aún no tiene un plan activo. Revisa la solicitud de suscripción con tu administrador de cuenta.', 'PLAN_REQUIRED');

  const { data: plantaActiva, error: plantaError } = await supabase.from('plantas').select('id')
    .eq('id', sesion.perfil.planta_id).eq('organizacion_id', sesion.perfil.organizacion_id).eq('activa', true).maybeSingle();
  if (plantaError) throw Object.assign(new Error('No pudimos validar que esta planta siga activa.'), { status: 503 });
  if (!plantaActiva) throw errorPlan('Esta planta no está activa dentro de la cuenta.', 'PLANT_INACTIVE', 403);
  const { count: plantasActivas, error: conteoPlantasError } = await supabase.from('plantas')
    .select('id', { count: 'exact', head: true }).eq('organizacion_id', sesion.perfil.organizacion_id).eq('activa', true);
  if (conteoPlantasError) throw Object.assign(new Error('No pudimos validar los sitios incluidos en el plan.'), { status: 503 });
  const limitePlantas = actual.plantas_incluidas;
  if (plantasActivas > limitePlantas) throw errorPlan(`La cuenta tiene ${plantasActivas} plantas activas, pero el plan incluye ${limitePlantas}. Contacta a DowntimeOS para regularizar los sitios.`, 'PLAN_SITE_LIMIT', 409);

  const { data: plan, error: planError } = await supabase.from('planes')
    .select('codigo,max_activos,max_plantas,funciones').eq('codigo', actual.plan_codigo).eq('activo', true).maybeSingle();
  if (planError || !plan) throw Object.assign(new Error('El plan de tu empresa no está configurado.'), { status: 503 });
  if (funcion && plan.funciones?.[funcion] !== true) {
    throw errorPlan('Esta función no está incluida en el plan actual de tu planta.', 'PLAN_FEATURE_REQUIRED', 403);
  }
  return { suscripcion: actual, plan };
}

/** Permite la portabilidad a quien tuvo un plan/piloto, incluso ya vencido. */
export async function exigirExportacion(sesion) {
  const { data: suscripcion, error } = await supabase.from('organizacion_suscripciones')
    .select('id,plan_codigo,estado,inicia_en')
    .eq('organizacion_id', sesion.perfil.organizacion_id)
    .not('inicia_en', 'is', null)
    .in('estado', ['activa', 'piloto', 'cancelacion_programada', 'vencida', 'cancelada'])
    .order('creada_en', { ascending: false }).limit(1).maybeSingle();
  if (error) throw Object.assign(new Error('No pudimos validar el derecho de exportación.'), { status: 503 });
  if (!suscripcion) throw errorPlan('La exportación estará disponible cuando se active el primer plan o piloto.');
  const { data: plan, error: errorPlanConfig } = await supabase.from('planes')
    .select('funciones').eq('codigo', suscripcion.plan_codigo).maybeSingle();
  if (errorPlanConfig || !plan) throw Object.assign(new Error('No pudimos validar las funciones de tu plan.'), { status: 503 });
  if (plan.funciones?.exportacion !== true) throw errorPlan('La exportación no está incluida en tu plan.', 'PLAN_FEATURE_REQUIRED', 403);
  return { suscripcion };
}

export async function exigirLimiteActivos(organizacionId, plantaId, plan) {
  if (plan.max_activos == null) return;
  const { count, error } = await supabase.from('planta_activos')
    .select('id', { count: 'exact', head: true }).eq('planta_id', plantaId).eq('activo', true);
  if (error) throw Object.assign(new Error('No pudimos revisar el límite de activos.'), { status: 503 });
  if (count > plan.max_activos) {
    throw errorPlan(`El plan permite hasta ${plan.max_activos} activos. Tu configuración tiene ${count}; solicita Pro o ajusta la planta antes de activar.`, 'PLAN_ASSET_LIMIT', 409);
  }
}
