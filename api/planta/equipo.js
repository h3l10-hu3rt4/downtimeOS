import { ruta, json, leerCuerpo } from '../../lib/http.js';
import { exigirAdministracionEquipo, invitarUsuario, permisosAdministracionCuenta, reenviarInvitacion, sesionDesdeEncabezado } from '../../lib/cuenta.js';
import { supabase } from '../../lib/supabase.js';

export default ruta(['GET', 'POST', 'PATCH'], async (req, res) => {
  const sesion = await sesionDesdeEncabezado(req.headers?.authorization, req.headers?.['x-downtimeos-planta']);
  const permisos = await exigirAdministracionEquipo(sesion);

  if (req.method === 'GET') {
    const { data, error } = await supabase.from('planta_invitaciones')
      .select('id,auth_user_id,email,nombre,rol,estado,es_admin_cuenta,puede_administrar_facturacion,enviada_en,aceptada_en')
      .eq('planta_id', sesion.perfil.planta_id).order('enviada_en', { ascending: false });
    if (error) throw Object.assign(new Error('No pudimos cargar las invitaciones.'), { status: 500 });
    return json(res, 200, { ok: true, permisos, invitaciones: data || [] });
  }

  const cuerpo = leerCuerpo(req);
  if (req.method === 'POST') {
    const usuario = await invitarUsuario(sesion, cuerpo);
    return json(res, 201, { ok: true, usuario });
  }

  if (!cuerpo.id || !['revocar', 'reenviar', 'cambiar_rol', 'delegar_admin', 'revocar_delegacion'].includes(cuerpo.accion)) {
    return json(res, 400, { ok: false, error: 'Indica una invitación y la acción que quieres realizar.' });
  }
  const { data: invitacion, error: lecturaError } = await supabase.from('planta_invitaciones')
    .select('*').eq('id', cuerpo.id).eq('planta_id', sesion.perfil.planta_id).maybeSingle();
  if (lecturaError || !invitacion) return json(res, 404, { ok: false, error: 'No encontramos esa invitación en tu planta.' });
  const { data: organizacion, error: errorOrganizacion } = await supabase.from('organizaciones').select('propietario_id')
    .eq('id', sesion.perfil.organizacion_id).maybeSingle();
  if (errorOrganizacion || !organizacion) throw Object.assign(new Error('No pudimos validar el titular de esta cuenta.'), { status: 503 });
  const esTitular = permisos.es_propietario && organizacion.propietario_id === sesion.user.id;
  const { data: delegacionObjetivo, error: errorDelegacion } = invitacion.auth_user_id
    ? await supabase.from('organizacion_admin_delegados').select('user_id')
      .eq('organizacion_id', sesion.perfil.organizacion_id).eq('user_id', invitacion.auth_user_id).maybeSingle()
    : { data: null, error: null };
  if (errorDelegacion) throw Object.assign(new Error('No pudimos validar los permisos de esa persona.'), { status: 503 });
  const objetivoProtegido = invitacion.auth_user_id === organizacion.propietario_id || Boolean(delegacionObjetivo) || invitacion.es_admin_cuenta;
  if (!esTitular && objetivoProtegido) return json(res, 403, { ok: false, error: 'Los administradores delegados no pueden gestionar al titular ni a otros delegados.' });

  if (['delegar_admin', 'revocar_delegacion'].includes(cuerpo.accion)) {
    if (!esTitular) {
      return json(res, 403, { ok: false, error: 'Solo el titular puede conceder o revocar administración delegada.' });
    }
    if (invitacion.estado !== 'aceptada' || !invitacion.auth_user_id || invitacion.auth_user_id === organizacion.propietario_id) {
      return json(res, 409, { ok: false, error: 'Solo se puede delegar o revocar a un miembro activo que no sea titular.' });
    }
    const { data, error } = await supabase.rpc('planta_admin_delegar_cuenta', {
      p_organizacion_id: sesion.perfil.organizacion_id,
      p_planta_id: sesion.perfil.planta_id,
      p_actor_id: sesion.user.id,
      p_objetivo_id: invitacion.auth_user_id,
      p_delegar: cuerpo.accion === 'delegar_admin',
    });
    if (error) return json(res, ['P0002', '23514'].includes(error.code) ? 409 : error.code === '42501' ? 403 : 500, { ok: false, error: error.message });
    return json(res, 200, { ok: true, mensaje: data?.es_admin_cuenta ? 'Administración de cuenta delegada.' : 'Delegación de administración revocada.' });
  }

  if (cuerpo.accion === 'cambiar_rol') {
    if (invitacion.estado !== 'aceptada' || !['direccion', 'finanzas', 'operaciones', 'operador'].includes(cuerpo.rol)) return json(res, 409, { ok: false, error: 'Solo puedes cambiar el rol de un usuario activo y a una función válida.' });
    if ((['direccion', 'finanzas'].includes(cuerpo.rol) && invitacion.rol !== cuerpo.rol
      || cuerpo.administrar_facturacion === true && invitacion.puede_administrar_facturacion !== true) && !esTitular) {
      return json(res, 403, { ok: false, error: 'Solo el titular puede asignar Dirección o Finanzas, o conceder acceso a facturación.' });
    }
    if (cuerpo.administrar_cuenta === true || invitacion.auth_user_id === organizacion.propietario_id || objetivoProtegido && !esTitular) return json(res, 403, { ok: false, error: 'La titularidad y la administración delegada se gestionan por separado.' });
    const { data, error } = await supabase.rpc('planta_admin_cambiar_miembro', {
      p_organizacion_id: sesion.perfil.organizacion_id, p_planta_id: sesion.perfil.planta_id,
      p_actor_id: sesion.user.id, p_invitacion_id: invitacion.id, p_rol: cuerpo.rol,
      p_facturacion: cuerpo.administrar_facturacion === undefined
        ? invitacion.puede_administrar_facturacion === true
        : cuerpo.administrar_facturacion === true,
    });
    if (error) return json(res, ['P0002', '23514'].includes(error.code) ? 409 : error.code === '42501' ? 403 : 500, { ok: false, error: error.message });
    return json(res, 200, { ok: true, mensaje: 'Permisos actualizados.', usuario: data });
  }
  if (!['pendiente', 'aceptada'].includes(invitacion.estado)) return json(res, 409, { ok: false, error: 'Esta invitación ya no está activa.' });

  if (cuerpo.accion === 'revocar') {
    if (invitacion.auth_user_id === sesion.user.id) return json(res, 409, { ok: false, error: 'No puedes desactivar el acceso del propietario de la cuenta.' });
    const { error } = await supabase.rpc('planta_admin_revocar_miembro', {
      p_organizacion_id: sesion.perfil.organizacion_id, p_planta_id: sesion.perfil.planta_id,
      p_actor_id: sesion.user.id, p_invitacion_id: invitacion.id,
    });
    if (error) return json(res, ['P0002', '23514'].includes(error.code) ? 409 : error.code === '42501' ? 403 : 500, { ok: false, error: error.message });
    return json(res, 200, { ok: true, mensaje: 'Invitación revocada.' });
  }

  if (invitacion.estado !== 'pendiente') return json(res, 409, { ok: false, error: 'Solo puedes reenviar una invitación que esté pendiente.' });

  await reenviarInvitacion(sesion, invitacion);
  return json(res, 200, { ok: true, mensaje: 'Enlace de invitación reenviado.' });
});
