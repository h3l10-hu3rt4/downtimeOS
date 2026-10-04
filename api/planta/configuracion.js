import { ruta, json, leerCuerpo } from '../../lib/http.js';
import { exigirRolProducto, sesionDesdeEncabezado } from '../../lib/cuenta.js';
import { ordenEtapasInicialValido } from '../../lib/configurar-planta.js';
import { supabase } from '../../lib/supabase.js';

export default ruta(['POST'], async (req, res) => {
  const sesion = await sesionDesdeEncabezado(req.headers?.authorization, req.headers?.['x-downtimeos-planta']);
  exigirRolProducto(sesion, ['direccion', 'admin']);
  const { lineas, activos } = leerCuerpo(req);
  if (!Array.isArray(lineas) || !Array.isArray(activos)) {
    return json(res, 400, { ok: false, error: 'La configuración de líneas y máquinas no es válida.' });
  }
  if (lineas.length > 30 || activos.length > 500) {
    return json(res, 400, { ok: false, error: 'La configuración supera los límites permitidos.' });
  }
  if (!ordenEtapasInicialValido(activos)) {
    return json(res, 400, { ok: false, error: 'El orden de cada etapa debe ser un número entero entre 1 y 99.' });
  }
  const { data, error } = await supabase.rpc('planta_configurar_inicial', {
    p_planta_id: sesion.perfil.planta_id,
    p_usuario_id: sesion.user.id,
    p_lineas: lineas,
    p_activos: activos,
  });
  if (error) {
    const conflicto = error.code === '23505';
    const datosInvalidos = ['22023', '23514'].includes(error.code);
    return json(res, conflicto ? 409 : datosInvalidos ? 400 : 500, {
      ok: false,
      error: conflicto
        ? 'La configuración ya fue guardada. Actualiza la página para continuar.'
        : datosInvalidos
          ? 'Revisa los códigos, nombres, etapas y tarifas. No pudimos validar esa configuración.'
          : 'No pudimos guardar la configuración por un problema del servidor. Tus datos siguen en esta pantalla; inténtalo de nuevo.',
    });
  }

  const { error: auditoriaError } = await supabase.from('planta_auditoria').insert({
    organizacion_id: sesion.perfil.organizacion_id,
    planta_id: sesion.perfil.planta_id,
    actor_id: sesion.user.id,
    accion: 'configuracion_inicial_creada',
    entidad: 'planta',
    entidad_id: sesion.perfil.planta_id,
    detalles: data,
  });
  if (auditoriaError) console.error('[downtimeos] no se pudo guardar auditoría de onboarding:', auditoriaError.message);
  return json(res, 201, { ok: true, configuracion: data });
});
