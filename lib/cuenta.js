import { supabase } from './supabase.js';
import { createClient } from '@supabase/supabase-js';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { crearUrlApp } from './app-url.js';
import { passwordTieneLongitudInvalida } from './password.js';

const ROLES = new Set(['direccion', 'finanzas', 'operaciones', 'operador']);
const INVITATION_TTL_MS = 72 * 60 * 60 * 1000;

function vencimientoInvitacion(desde = Date.now()) {
  return new Date(new Date(desde).getTime() + INVITATION_TTL_MS).toISOString();
}

function errorPeticion(mensaje, status = 400) {
  return Object.assign(new Error(mensaje), { status });
}

function errorConexionRegistro(error) {
  // No registrar el objeto completo: los errores HTTP de Auth pueden contener
  // detalles de la solicitud. nombre/código bastan para diagnosticar la red.
  console.error('[downtimeos] Supabase Auth no respondió durante el registro:', {
    nombre: error?.name || 'Error',
    codigo: error?.code || error?.cause?.code || null,
  });
  return Object.assign(
    new Error('No pudimos confirmar el resultado del registro por un problema de conexión. Si alcanzó a completarse, inicia sesión o recupera tu contraseña antes de volver a registrarte.'),
    { status: 503 },
  );
}

function esRechazoSqlDeterminista(error) {
  const status = Number(error?.status);
  const codigoSql = typeof error?.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code);
  // Solo errores PostgreSQL devueltos como respuesta 4xx confirman que la
  // función rechazó la llamada y su transacción hizo rollback. Los 5xx,
  // errores de red y errores sin SQLSTATE pueden ocultar un commit exitoso.
  return status >= 400 && status < 500 && codigoSql;
}

function errorAltaAmbigua(error) {
  console.error('[downtimeos] la RPC de alta no devolvió un resultado concluyente:', {
    nombre: error?.name || 'Error',
    codigo: error?.code || null,
    status: error?.status || null,
  });
  return Object.assign(
    new Error('No pudimos confirmar si la empresa y la planta se crearon. No vuelvas a registrarte todavía; inicia sesión o contacta a soporte para revisar el alta.'),
    { status: 503 },
  );
}

function errorEnvioInvitacion(error, { enlaceAnteriorVigente = false } = {}) {
  if (error?.code === 'over_email_send_rate_limit' || error?.status === 429) {
    const mensaje = enlaceAnteriorVigente
      ? 'Supabase alcanzó el límite temporal de correos. El enlace anterior sigue vigente; espera un poco y vuelve a enviarlo.'
      : 'Supabase alcanzó el límite temporal de correos. El acceso quedó desactivado; espera un poco y vuelve a enviar la invitación.';
    return Object.assign(new Error(mensaje), { status: 429 });
  }
  const mensaje = enlaceAnteriorVigente
    ? 'No pudimos enviar el correo. El enlace anterior sigue vigente; revisa la configuración de correo e inténtalo de nuevo.'
    : 'No pudimos enviar el correo de invitación. El acceso quedó desactivado; revisa la configuración de correo e inténtalo de nuevo.';
  return Object.assign(new Error(mensaje), { status: 422 });
}

function errorEnvioInvitacionIndeterminado() {
  return Object.assign(
    new Error('No pudimos confirmar si el correo llegó. La invitación sigue pendiente; el enlace más reciente pudo haberse enviado. Revisa la bandeja y el spam antes de solicitar otro.'),
    { status: 503, code: 'INVITATION_EMAIL_DELIVERY_UNKNOWN' },
  );
}

async function revertirInvitacionFallida({ userId, plantaId, invitacionId, membresiaAnterior, perfilNuevo, usuarioCreado }) {
  const fallos = [];
  async function ejecutar(nombre, operacion) {
    try {
      const resultado = await operacion;
      if (resultado?.error) fallos.push(nombre);
    } catch {
      fallos.push(nombre);
    }
  }

  if (invitacionId) {
    await ejecutar('revocar_invitacion', supabase.from('planta_invitaciones')
      .update({ estado: 'revocada' }).eq('id', invitacionId).eq('estado', 'pendiente'));
  }
  if (membresiaAnterior) {
    await ejecutar('restaurar_membresia', supabase.from('planta_membresias')
      .upsert(membresiaAnterior, { onConflict: 'user_id,planta_id' }));
  } else {
    await ejecutar('eliminar_membresia_nueva', supabase.from('planta_membresias')
      .delete().eq('user_id', userId).eq('planta_id', plantaId));
  }
  if (perfilNuevo) {
    await ejecutar('eliminar_perfil_nuevo', supabase.from('planta_perfiles').delete().eq('user_id', userId));
  }
  if (usuarioCreado) {
    await ejecutar('eliminar_usuario_auth', supabase.auth.admin.deleteUser(userId));
  }
  if (fallos.length) {
    console.error('[downtimeos] no se pudo completar la compensación de una invitación:', { operaciones: fallos });
  }
  return fallos;
}

function errorReversionInvitacionIncompleta() {
  return Object.assign(
    new Error('La invitación falló y no pudimos restaurar por completo el acceso previo. No vuelvas a invitar a esta persona todavía; contacta a soporte para revisar su membresía.'),
    { status: 503 },
  );
}

function crearClienteAuthPublico() {
  const url = process.env.SUPABASE_URL;
  const clavePublica = process.env.SUPABASE_PUBLISHABLE_KEY
    || process.env.SUPABASE_ANON_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !clavePublica) {
    throw Object.assign(new Error('Falta configurar la clave pública de Supabase para habilitar el acceso.'), { status: 503 });
  }
  return createClient(url, clavePublica, {
    auth: { flowType: 'implicit', persistSession: false, autoRefreshToken: false },
  });
}

function texto(valor, campo, maximo = 120) {
  const limpio = String(valor ?? '').trim();
  if (!limpio) throw errorPeticion(`Falta ${campo}.`);
  return limpio.slice(0, maximo);
}

export function validarRegistro(datos) {
  const email = texto(datos.email, 'el correo', 254).toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw errorPeticion('El correo no tiene un formato válido.');
  const password = String(datos.password ?? '');
  if (passwordTieneLongitudInvalida(password)) throw errorPeticion('La contraseña debe tener al menos 10 caracteres.');
  const empresa = texto(datos.empresa, 'el nombre de la empresa');
  const planta = texto(datos.planta || 'Planta principal', 'el nombre de la planta');
  if (empresa.length < 2 || planta.length < 2) {
    throw errorPeticion('El nombre de la empresa y de la planta deben tener al menos 2 caracteres.');
  }
  return {
    email, password,
    nombre: texto(datos.nombre, 'el nombre'),
    empresa,
    planta,
  };
}

export async function registrarEmpresa(datos) {
  let authPublico;
  try {
    authPublico = crearClienteAuthPublico();
  } catch (error) {
    if (error?.status) throw error;
    throw errorConexionRegistro(error);
  }
  return registrarEmpresaConDependencias(datos, { authPublico });
}

/** @internal Dependencias inyectables para probar los resultados ambiguos sin servicios externos. */
export async function registrarEmpresaConDependencias(datos, dependencias = {}) {
  const entrada = validarRegistro(datos);
  const crearAuthPublico = dependencias.crearAuthPublico || crearClienteAuthPublico;
  const registrarOrganizacion = dependencias.registrarOrganizacion
    || ((argumentos) => supabase.rpc('organizacion_registrar_empresa', argumentos));
  const eliminarUsuarioAuth = dependencias.eliminarUsuarioAuth
    || ((userId) => supabase.auth.admin.deleteUser(userId));
  let authPublico;
  let emailRedirectTo;
  try {
    authPublico = dependencias.authPublico || crearAuthPublico();
    emailRedirectTo = crearUrlApp('/activar').toString();
  } catch (error) {
    if (error?.status) throw error;
    throw errorConexionRegistro(error);
  }
  let resultadoAuth;
  try {
    resultadoAuth = await authPublico.auth.signUp({
      email: entrada.email, password: entrada.password,
      options: {
        emailRedirectTo,
        data: {
          nombre: entrada.nombre,
          downtimeos_registro: { version: 1, empresa: entrada.empresa, planta: entrada.planta, nombre: entrada.nombre },
        },
      },
    });
  } catch (error) {
    throw errorConexionRegistro(error);
  }
  const { data: usuario, error: errorUsuario } = resultadoAuth;
  const falloTransporte = errorUsuario && (
    errorUsuario.status === 0
    || errorUsuario.status >= 500
    || errorUsuario.name === 'AuthRetryableFetchError'
    || /fetch failed|network|timed? ?out|socket|ECONN|ENOTFOUND|EAI_AGAIN/i.test(errorUsuario.message || '')
  );
  if (falloTransporte) throw errorConexionRegistro(errorUsuario);
  if (errorUsuario || !usuario?.user) throw Object.assign(new Error(errorUsuario?.message || 'No fue posible crear el usuario.'), { status: 422 });
  if (Array.isArray(usuario.user.identities) && usuario.user.identities.length === 0) {
    // Supabase intentionally omits identities for an existing email. Keep the
    // public registration result indistinguishable from a newly accepted
    // request so this endpoint cannot be used to enumerate accounts.
    return { siguiente: 'confirmar_o_iniciar_sesion' };
  }
  let resultadoRegistro;
  try {
    resultadoRegistro = await registrarOrganizacion({
      p_usuario_id: usuario.user.id,
      p_empresa: entrada.empresa,
      p_planta: entrada.planta,
      p_nombre: entrada.nombre,
    });
  } catch (error) {
    if (!esRechazoSqlDeterminista(error)) throw errorAltaAmbigua(error);
    resultadoRegistro = { data: null, error };
  }

  const { data: registro, error: errorRegistro } = resultadoRegistro || {};
  if (errorRegistro || !registro?.empresa?.id || !registro?.planta?.id) {
    if (!esRechazoSqlDeterminista(errorRegistro)) {
      throw errorAltaAmbigua(errorRegistro);
    }

    let errorLimpieza;
    try {
      ({ error: errorLimpieza } = await eliminarUsuarioAuth(usuario.user.id) || {});
    } catch (error) {
      errorLimpieza = error;
    }
    if (errorLimpieza) {
      console.error('[downtimeos] rechazo SQL de registro y limpieza de Auth fallida:', errorLimpieza.message);
      throw Object.assign(new Error('La base rechazó el alta, pero no pudimos limpiar la cuenta de acceso. No vuelvas a registrarte todavía; contacta a soporte.'), { status: 503 });
    }
    throw Object.assign(new Error('No se pudo crear la empresa y la planta. La solicitud fue rechazada y puedes corregir los datos antes de volver a intentarlo.'), { status: 422 });
  }

  return {
    ...registro,
    usuario: { ...registro.usuario, id: usuario.user.id, email: entrada.email, rol: 'direccion' },
    sesion: usuario.session || null,
    requiere_confirmacion: !usuario.session,
  };
}

export async function iniciarSesion({ email, password }) {
  // Nunca autenticar con el cliente privilegiado `supabase`: supabase-js guarda
  // la sesión obtenida y reemplaza su Authorization para RPC posteriores.
  const authPublico = crearClienteAuthPublico();
  const { data, error } = await authPublico.auth.signInWithPassword({ email: String(email || '').trim(), password: String(password || '') });
  if (error || !data.session) throw errorPeticion('Correo o contraseña incorrectos.', 401);
  const { perfil, plantas_disponibles } = await resolverPerfilConReanudacion(data.user);
  return { access_token: data.session.access_token, refresh_token: data.session.refresh_token, perfil, plantas_disponibles };
}

export async function renovarSesion(refreshToken, plantaSolicitada = null) {
  const token = String(refreshToken || '').trim();
  if (!token) throw errorPeticion('La sesión venció. Inicia sesión para continuar.', 401);
  // Supabase JS conserva el Authorization de refreshSession en el cliente.
  // No usar el singleton service-role: un refresh reemplazaría su credencial y
  // rompería las consultas privilegiadas de esta y futuras peticiones.
  const authPublico = crearClienteAuthPublico();
  const { data, error } = await authPublico.auth.refreshSession({ refresh_token: token });
  if (error || !data?.session?.access_token || !data?.session?.refresh_token || !data?.user?.id) {
    throw errorPeticion('La sesión venció. Inicia sesión para continuar.', 401);
  }
  const { perfil, plantas_disponibles } = await resolverPerfil(data.user.id, plantaSolicitada || null);
  return {
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    perfil,
    plantas_disponibles,
  };
}

export async function solicitarRecuperacion(email) {
  const correo = texto(email, 'el correo', 254).toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(correo)) throw errorPeticion('El correo no tiene un formato válido.');
  const { error } = await supabase.auth.resetPasswordForEmail(correo, {
    redirectTo: crearUrlApp('/recuperar').toString(),
  });
  if (error) throw Object.assign(new Error('No fue posible enviar el correo de recuperación.'), { status: 400 });
  return { enviado: true };
}

export async function reenviarConfirmacionRegistro(email) {
  return reenviarConfirmacionConDependencias(email);
}

/** @internal Dependencia inyectable para probar reenvíos sin servicios externos. */
export async function reenviarConfirmacionConDependencias(email, dependencias = {}) {
  const correo = texto(email, 'el correo', 254).toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(correo)) throw errorPeticion('El correo no tiene un formato válido.');
  const authPublico = dependencias.authPublico || crearClienteAuthPublico();
  let resultado;
  try {
    resultado = await authPublico.auth.resend({
      type: 'signup',
      email: correo,
      options: { emailRedirectTo: crearUrlApp('/activar').toString() },
    });
  } catch {
    throw Object.assign(new Error('No pudimos confirmar el envío del enlace. Espera un momento e inténtalo de nuevo.'), { status: 503 });
  }
  const { error } = resultado || {};
  if (error) {
    if (error.status === 429 || error.code === 'over_email_send_rate_limit') {
      throw Object.assign(new Error('Ya solicitaste un correo hace poco. Espera un momento antes de volver a intentarlo.'), { status: 429 });
    }
    throw Object.assign(new Error('No pudimos confirmar el envío del enlace. Espera un momento e inténtalo de nuevo.'), { status: 503 });
  }
  return { enviado: true };
}

async function resolverPerfil(userId, plantaSolicitada = null) {
  const { data: membresias, error } = await supabase.from('planta_membresias')
    // La FK compuesta tenant/planta comparte relación con la FK simple; el
    // nombre explícito evita que PostgREST rechace la consulta como ambigua.
    .select('user_id,organizacion_id,planta_id,rol,nombre,es_admin_cuenta,puede_administrar_facturacion,activo,onboarding_completado_en,plantas!planta_membresias_planta_tenant_fkey(nombre,codigo),organizaciones!planta_membresias_organizacion_id_fkey(nombre,propietario_id)')
    .eq('user_id', userId).eq('activo', true).order('created_at', { ascending: true });
  if (error) throw Object.assign(new Error('No fue posible cargar los permisos de tu cuenta.'), { status: 503 });
  const perfiles = membresias || [];
  const perfil = plantaSolicitada
    ? perfiles.find((fila) => fila.planta_id === plantaSolicitada)
    : perfiles[0];
  if (!perfil) throw errorPeticion(plantaSolicitada ? 'No tienes acceso a esa planta.' : 'Tu usuario no tiene una planta asignada.', 403);
  const esPropietarioCuenta = perfil.organizaciones?.propietario_id === userId;
  let esAdminDelegado = false;
  if (!esPropietarioCuenta) {
    const { data: delegacion, error: errorDelegacion } = await supabase.from('organizacion_admin_delegados')
      .select('user_id').eq('organizacion_id', perfil.organizacion_id).eq('user_id', userId).maybeSingle();
    if (errorDelegacion) throw Object.assign(new Error('No fue posible cargar los permisos de administración de tu cuenta.'), { status: 503 });
    esAdminDelegado = Boolean(delegacion);
  }
  const perfilAutorizado = {
    ...perfil,
    es_propietario_cuenta: esPropietarioCuenta,
    es_admin_cuenta: esPropietarioCuenta || esAdminDelegado,
  };
  const plantas_disponibles = perfiles.map((fila) => ({
    planta_id: fila.planta_id, organizacion_id: fila.organizacion_id,
    nombre: fila.plantas?.nombre || 'Planta', organizacion: fila.organizaciones?.nombre || '',
    rol: fila.rol, onboarding_completado_en: fila.onboarding_completado_en,
  }));
  return { perfil: perfilAutorizado, plantas_disponibles };
}

/** Reanuda de forma idempotente un alta Auth cuya respuesta se perdió. */
export async function reanudarRegistroPendienteConDependencias(usuario, dependencias = {}) {
  const datos = usuario?.user_metadata?.downtimeos_registro;
  if (!datos || typeof datos !== 'object' || Array.isArray(datos) || datos.version !== 1 || !usuario.id) return false;

  let entrada;
  try {
    entrada = {
      empresa: texto(datos.empresa, 'el nombre de la empresa'),
      planta: texto(datos.planta, 'el nombre de la planta'),
      nombre: texto(datos.nombre, 'el nombre'),
    };
    if (entrada.empresa.length < 2 || entrada.planta.length < 2) throw new Error('Registro pendiente inválido.');
  } catch {
    throw Object.assign(new Error('No pudimos recuperar los datos del alta. Contacta a soporte para terminar el registro de forma segura.'), { status: 409 });
  }

  let resultado;
  try {
    const registrar = dependencias.registrar || ((argumentos) => supabase.rpc('organizacion_reanudar_registro_empresa', argumentos));
    resultado = await registrar({
      p_usuario_id: usuario.id,
      p_empresa: entrada.empresa,
      p_planta: entrada.planta,
      p_nombre: entrada.nombre,
    });
  } catch {
    throw Object.assign(new Error('No pudimos reanudar el alta por un problema temporal. Vuelve a iniciar sesión más tarde; no vuelvas a crear la cuenta.'), { status: 503 });
  }
  if (resultado?.error || !resultado?.data?.empresa?.id || !resultado?.data?.planta?.id) {
    throw Object.assign(new Error('No pudimos reanudar el alta de forma segura. Vuelve a intentarlo más tarde o contacta a soporte; no vuelvas a crear la cuenta.'), { status: 503 });
  }
  return true;
}

export async function resolverPerfilConReanudacion(usuario, plantaSolicitada = null, dependencias = {}) {
  const resolver = dependencias.resolver || resolverPerfil;
  try {
    return await resolver(usuario.id, plantaSolicitada);
  } catch (error) {
    if (plantaSolicitada || error?.status !== 403 || error.message !== 'Tu usuario no tiene una planta asignada.') throw error;
    const reanudar = dependencias.reanudar || reanudarRegistroPendienteConDependencias;
    const reanudado = await reanudar(usuario, dependencias.reanudacion || {});
    if (!reanudado) throw error;
    return resolver(usuario.id);
  }
}

/** Resuelve en servidor la autoridad de la organización, nunca desde flags enviados por el navegador. */
export async function permisosAdministracionCuenta(sesion) {
  const organizacionId = sesion?.perfil?.organizacion_id;
  const actorId = sesion?.user?.id;
  if (!organizacionId || !actorId) throw errorPeticion('Sesión requerida.', 401);
  const { data: organizacion, error: errorOrganizacion } = await supabase.from('organizaciones')
    .select('propietario_id').eq('id', organizacionId).maybeSingle();
  if (errorOrganizacion || !organizacion) throw Object.assign(new Error('No pudimos validar la titularidad de la cuenta.'), { status: 503 });
  const esPropietario = organizacion.propietario_id === actorId;
  if (esPropietario) return { es_propietario: true, es_admin_cuenta: true };
  const { data: delegacion, error: errorDelegacion } = await supabase.from('organizacion_admin_delegados')
    .select('user_id').eq('organizacion_id', organizacionId).eq('user_id', actorId).maybeSingle();
  if (errorDelegacion) throw Object.assign(new Error('No pudimos validar tus permisos de administración.'), { status: 503 });
  return { es_propietario: false, es_admin_cuenta: Boolean(delegacion) };
}

export async function exigirAdministracionEquipo(sesion) {
  const permisos = await permisosAdministracionCuenta(sesion);
  if (!permisos.es_admin_cuenta) throw errorPeticion('No tienes permiso para administrar el equipo de esta cuenta.', 403);
  return permisos;
}

export async function sesionDesdeEncabezado(encabezado = '', plantaSolicitada = null) {
  const token = String(encabezado).replace(/^Bearer\s+/i, '').trim();
  if (!token) throw errorPeticion('Sesión requerida.', 401);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) throw errorPeticion('Sesión inválida o expirada.', 401);
  const { perfil, plantas_disponibles } = await resolverPerfilConReanudacion(data.user, plantaSolicitada || null);
  return { user: data.user, perfil, plantas_disponibles };
}

export async function aceptarInvitacion(encabezado = '', invitacionId, tokenAceptacion) {
  const tokenSesion = String(encabezado).replace(/^Bearer\s+/i, '').trim();
  if (!tokenSesion) throw errorPeticion('Sesión requerida.', 401);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(invitacionId || ''))
    || !/^[A-Za-z0-9_-]{40,64}$/.test(String(tokenAceptacion || ''))) {
    throw errorPeticion('El enlace de invitación no es válido o ya venció.', 400);
  }
  const { data: authData, error: authError } = await supabase.auth.getUser(tokenSesion);
  const usuario = authData?.user;
  if (authError || !usuario?.id || !usuario.email) throw errorPeticion('Sesión inválida o expirada.', 401);

  const tokenHash = createHash('sha256').update(String(tokenAceptacion)).digest('hex');
  const { data, error } = await supabase.rpc('planta_aceptar_invitacion', {
    p_invitacion_id: invitacionId,
    p_usuario_id: usuario.id,
    p_email: usuario.email.toLowerCase(),
    p_token_hash: tokenHash,
  });
  if (error) {
    const status = error.code === '42501' ? 403 : ['P0002', '23505'].includes(error.code) ? 409 : 503;
    throw Object.assign(new Error(status === 503
      ? 'No pudimos validar la invitación. Verifica que la migración de invitaciones esté instalada e inténtalo de nuevo.'
      : 'El enlace no corresponde a esta cuenta, ya fue usado o ya no está vigente.'), { status });
  }

  let cuenta;
  try {
    cuenta = await resolverPerfil(usuario.id, data?.planta_id);
  } catch (error) {
    // La RPC pudo confirmar la invitación antes de que una lectura temporal
    // del perfil fallara. No pedir un enlace nuevo: el mismo token es
    // idempotente y permite reintentar la carga de permisos.
    if (error?.status === 503 && data?.planta_id) {
      throw Object.assign(
        new Error('La invitación quedó aceptada, pero no pudimos cargar tu planta por un problema temporal. Inténtalo de nuevo o inicia sesión; no necesitas otro enlace.'),
        { status: 503, code: 'INVITATION_ACCEPTED_PROFILE_PENDING' },
      );
    }
    throw error;
  }
  const { perfil, plantas_disponibles } = cuenta;
  return { user: usuario, perfil, plantas_disponibles };
}

/** Autoridad de roles del producto. Nunca delegar esta decisión al navegador. */
export function exigirRolProducto(sesion, roles) {
  const permitidos = Array.isArray(roles) ? roles : [roles];
  if (!sesion?.perfil || !permitidos.includes(sesion.perfil.rol)) {
    throw errorPeticion('No tienes permiso para realizar esta acción.', 403);
  }
  return sesion;
}

async function buscarUsuarioAuthPorEmail(email) {
  const perPage = 1000;
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw Object.assign(new Error('No pudimos validar el correo de invitación.'), { status: 503 });
    const usuarios = Array.isArray(data?.users) ? data.users : [];
    const existente = usuarios.find((usuario) => String(usuario.email || '').toLowerCase() === email);
    if (existente) return existente;
    if (usuarios.length === 0) return null;
  }
}

export async function invitarUsuario(sesion, datos) {
  const permisosCuenta = await exigirAdministracionEquipo(sesion);
  if (!sesion.perfil.onboarding_completado_en) {
    throw errorPeticion('Configura primero las líneas y máquinas de la planta; después podrás invitar a tu equipo.', 409);
  }
  const email = texto(datos.email, 'el correo', 254).toLowerCase();
  const nombre = texto(datos.nombre, 'el nombre');
  const rol = String(datos.rol || 'operador');
  if (!ROLES.has(rol)) throw errorPeticion('Rol no válido.');
  if ((rol === 'direccion' || rol === 'finanzas' || datos.administrar_facturacion === true) && !permisosCuenta.es_propietario) {
    throw errorPeticion('Solo el titular puede asignar Dirección o Finanzas, o conceder acceso a facturación.', 403);
  }
  if (datos.administrar_cuenta === true && !permisosCuenta.es_propietario) {
    throw errorPeticion('Solo el titular de la cuenta puede conceder administración delegada.', 403);
  }
  const esAdminSolicitado = datos.administrar_cuenta === true;
  const puedeAdministrarFacturacion = datos.administrar_facturacion === true;
  const { data: duplicada, error: errorDuplicada } = await supabase.from('planta_invitaciones').select('id,estado')
    .eq('planta_id', sesion.perfil.planta_id).eq('email', email).maybeSingle();
  if (errorDuplicada) throw Object.assign(new Error('No pudimos validar invitaciones anteriores. Inténtalo de nuevo.'), { status: 503 });
  if (duplicada?.estado === 'pendiente') throw errorPeticion('Ya hay una invitación pendiente para ese correo.', 409);
  if (duplicada?.estado === 'aceptada') throw errorPeticion('Esta persona ya tiene acceso a la planta.', 409);
  const usuarioExistente = await buscarUsuarioAuthPorEmail(email);
  let userId = usuarioExistente?.id;
  let membresiaAnterior = null;
  const { data: organizacion, error: errorOrganizacion } = await supabase.from('organizaciones').select('propietario_id')
    .eq('id', sesion.perfil.organizacion_id).maybeSingle();
  if (errorOrganizacion || !organizacion) throw Object.assign(new Error('No pudimos validar el titular de esta cuenta.'), { status: 503 });
  if (userId === organizacion.propietario_id) throw errorPeticion('El titular de la cuenta no puede recibir una invitación de equipo.', 409);
  let yaEsDelegado = false;
  let invitacionDelegadaPendiente = false;
  if (userId) {
    const { data: delegacion, error: errorDelegacion } = await supabase.from('organizacion_admin_delegados').select('user_id')
      .eq('organizacion_id', sesion.perfil.organizacion_id).eq('user_id', userId).maybeSingle();
    if (errorDelegacion) throw Object.assign(new Error('No pudimos validar los permisos de esa persona.'), { status: 503 });
    yaEsDelegado = Boolean(delegacion);
    const { data: invitacionDelegada, error: errorInvitacionDelegada } = await supabase.from('planta_invitaciones')
      .select('id').eq('organizacion_id', sesion.perfil.organizacion_id).eq('auth_user_id', userId)
      .eq('es_admin_cuenta', true).eq('estado', 'pendiente').maybeSingle();
    if (errorInvitacionDelegada) throw Object.assign(new Error('No pudimos validar si esa persona tiene una delegación pendiente.'), { status: 503 });
    invitacionDelegadaPendiente = Boolean(invitacionDelegada);
    if ((yaEsDelegado || invitacionDelegadaPendiente) && !permisosCuenta.es_propietario) {
      throw errorPeticion('Los administradores delegados y las delegaciones pendientes solo pueden ser gestionados por el titular.', 403);
    }
  }
  const esAdminCuenta = esAdminSolicitado || yaEsDelegado || invitacionDelegadaPendiente;
  if (userId) {
    const { data: membresiaActiva, error: membresiaLookupError } = await supabase.from('planta_membresias').select('user_id')
      .eq('user_id', userId).eq('planta_id', sesion.perfil.planta_id).eq('activo', true).maybeSingle();
    if (membresiaLookupError) throw Object.assign(new Error('No pudimos validar si esa persona ya tiene acceso.'), { status: 503 });
    if (membresiaActiva) throw errorPeticion('Esta persona ya tiene acceso a la planta.', 409);
    const { data: membresiaExistente, error: errorMembresiaExistente } = await supabase.from('planta_membresias').select('*')
      .eq('user_id', userId).eq('planta_id', sesion.perfil.planta_id).maybeSingle();
    if (errorMembresiaExistente) throw Object.assign(new Error('No pudimos respaldar el acceso previo de esa persona.'), { status: 503 });
    membresiaAnterior = membresiaExistente;
  }
  let usuarioCreado = false;
  if (!usuarioExistente) {
    const { data: creado, error } = await supabase.auth.admin.createUser({ email, email_confirm: false, user_metadata: { nombre } });
    if (error || !creado?.user) throw Object.assign(new Error('No pudimos preparar la cuenta para la invitación. Revisa la configuración de Supabase.'), { status: 422 });
    userId = creado.user.id;
    usuarioCreado = true;
  }

  const invitacionId = randomUUID();
  const tokenAceptacion = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(tokenAceptacion).digest('hex');
  const enviadaEn = new Date().toISOString();
  const expiraEn = vencimientoInvitacion(enviadaEn);
  const necesitaContrasena = usuarioCreado;
  const enlace = crearUrlApp('/activar');
  enlace.searchParams.set('flujo', 'invitacion');
  enlace.searchParams.set('invitacion', invitacionId);
  enlace.searchParams.set('token', tokenAceptacion);
  if (necesitaContrasena) enlace.searchParams.set('configurar', '1');

  let perfilNuevo = false;
  const { data: perfilExistente, error: errorPerfil } = await supabase.from('planta_perfiles')
    .select('user_id').eq('user_id', userId).maybeSingle();
  if (errorPerfil) {
    const fallos = await revertirInvitacionFallida({ userId, plantaId: sesion.perfil.planta_id, membresiaAnterior, usuarioCreado, perfilNuevo: false });
    if (fallos.length) throw errorReversionInvitacionIncompleta();
    throw Object.assign(new Error('No pudimos preparar el perfil del usuario invitado.'), { status: 503 });
  }
  if (!perfilExistente) {
    perfilNuevo = true;
    const { error: perfilError } = await supabase.from('planta_perfiles').insert({
      user_id: userId, organizacion_id: sesion.perfil.organizacion_id, planta_id: sesion.perfil.planta_id,
      rol, nombre, planta_codigo: sesion.perfil.plantas?.codigo || '', es_admin_cuenta: esAdminCuenta,
      puede_administrar_facturacion: puedeAdministrarFacturacion, activo: false,
      onboarding_completado_en: sesion.perfil.onboarding_completado_en || null,
    });
    if (perfilError) {
      const fallos = await revertirInvitacionFallida({ userId, plantaId: sesion.perfil.planta_id, membresiaAnterior, usuarioCreado, perfilNuevo: true });
      if (fallos.length) throw errorReversionInvitacionIncompleta();
      throw Object.assign(new Error('No pudimos crear el perfil del usuario invitado.'), { status: 500 });
    }
  }

  const { error: membresiaError } = await supabase.from('planta_membresias').upsert({
    user_id: userId, organizacion_id: sesion.perfil.organizacion_id,
    planta_id: sesion.perfil.planta_id, rol, nombre, es_admin_cuenta: esAdminCuenta,
    puede_administrar_facturacion: puedeAdministrarFacturacion, activo: false,
    onboarding_completado_en: sesion.perfil.onboarding_completado_en || null,
  }, { onConflict: 'user_id,planta_id' });
  if (membresiaError) {
    const fallos = await revertirInvitacionFallida({ userId, plantaId: sesion.perfil.planta_id, membresiaAnterior, usuarioCreado, perfilNuevo });
    if (fallos.length) throw errorReversionInvitacionIncompleta();
    throw Object.assign(new Error('No pudimos preparar el acceso a la planta.'), { status: 500 });
  }
  const filaInvitacion = {
    organizacion_id: sesion.perfil.organizacion_id,
    planta_id: sesion.perfil.planta_id,
    id: invitacionId,
    auth_user_id: userId,
    email,
    nombre,
    rol,
    es_admin_cuenta: esAdminCuenta,
    puede_administrar_facturacion: puedeAdministrarFacturacion,
    invitada_por: sesion.user.id,
    estado: 'pendiente', enviada_en: enviadaEn, aceptada_en: null,
    acceptance_token_hash: tokenHash, expires_at: expiraEn,
  };
  const invitacionQuery = duplicada
    ? supabase.from('planta_invitaciones').update(filaInvitacion).eq('id', duplicada.id)
    : supabase.from('planta_invitaciones').insert(filaInvitacion);
  const { error: invitacionError } = await invitacionQuery;
  if (invitacionError) {
    // Una petición paralela pudo guardar la invitación justo antes de que esta
    // insertara la misma planta/correo. No reviertas entonces la membresía que
    // la invitación ganadora necesita para aceptarse.
    const { data: invitacionPendiente, error: errorComprobarPendiente } = await supabase.from('planta_invitaciones')
      .select('id').eq('planta_id', sesion.perfil.planta_id).eq('email', email).eq('estado', 'pendiente').maybeSingle();
    if (!errorComprobarPendiente && invitacionPendiente) {
      throw errorPeticion('La invitación quedó pendiente por una solicitud simultánea. No vuelvas a crearla; actualiza la lista y reenvía el enlace desde ahí si hace falta.', 409);
    }
    const fallos = await revertirInvitacionFallida({ userId, plantaId: sesion.perfil.planta_id, invitacionId, membresiaAnterior, usuarioCreado, perfilNuevo });
    if (fallos.length) throw errorReversionInvitacionIncompleta();
    throw Object.assign(new Error('No pudimos guardar la invitación y no se envió ningún enlace. Inténtalo de nuevo.'), { status: 500 });
  }

  // El correo se envía después de persistir la membresía inactiva y el secreto
  // asociado a esta invitación; ningún token emitido puede autorizar otra planta.
  let resultadoEnvio;
  try {
    resultadoEnvio = usuarioExistente
      ? (usuarioExistente.email_confirmed_at
        ? await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: enlace.toString() } })
        : await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: enlace.toString() } }))
      : await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: enlace.toString() } });
  } catch {
    // El proveedor pudo haber aceptado el correo y perderse solo la respuesta.
    // Conserva la invitación pendiente para que un enlace ya entregado no quede
    // invalidado por una compensación basada en una respuesta ambigua.
    throw errorEnvioInvitacionIndeterminado();
  }
  const { error: errorEnvio } = resultadoEnvio || {};
  if (errorEnvio) {
    const fallos = await revertirInvitacionFallida({ userId, plantaId: sesion.perfil.planta_id, invitacionId, membresiaAnterior, usuarioCreado, perfilNuevo });
    if (fallos.length) throw errorReversionInvitacionIncompleta();
    throw errorEnvioInvitacion(errorEnvio);
  }
  await supabase.from('planta_auditoria').insert({
    organizacion_id: sesion.perfil.organizacion_id, planta_id: sesion.perfil.planta_id,
    actor_id: sesion.user.id, accion: 'usuario_invitado', entidad: 'usuario',
    entidad_id: userId, detalles: { email, rol },
  });
  return { id: userId, email, nombre, rol, es_admin_cuenta: esAdminCuenta, puede_administrar_facturacion: puedeAdministrarFacturacion };
}

export async function reenviarInvitacion(sesion, invitacion) {
  const permisosCuenta = await exigirAdministracionEquipo(sesion);
  if (!invitacion?.id || invitacion.estado !== 'pendiente' || !invitacion.auth_user_id) {
    throw errorPeticion('Esta invitación ya no está pendiente.', 409);
  }
  const { data: organizacion, error: errorOrganizacion } = await supabase.from('organizaciones').select('propietario_id')
    .eq('id', sesion.perfil.organizacion_id).maybeSingle();
  if (errorOrganizacion || !organizacion) throw Object.assign(new Error('No pudimos validar el titular de esta cuenta.'), { status: 503 });
  const { data: delegacion, error: errorDelegacion } = await supabase.from('organizacion_admin_delegados').select('user_id')
    .eq('organizacion_id', sesion.perfil.organizacion_id).eq('user_id', invitacion.auth_user_id).maybeSingle();
  if (errorDelegacion) throw Object.assign(new Error('No pudimos validar los permisos de esa persona.'), { status: 503 });
  if (!permisosCuenta.es_propietario && (invitacion.auth_user_id === organizacion.propietario_id || invitacion.es_admin_cuenta || delegacion)) {
    throw errorPeticion('Los delegados no pueden gestionar al titular ni a otros administradores delegados.', 403);
  }
  const { data: resultadoUsuario, error: errorUsuario } = await supabase.auth.admin.getUserById(invitacion.auth_user_id);
  const usuario = resultadoUsuario?.user;
  if (errorUsuario || !usuario?.id || String(usuario.email || '').toLowerCase() !== String(invitacion.email || '').toLowerCase()) {
    throw Object.assign(new Error('No pudimos validar la cuenta asociada a esta invitación.'), { status: 409 });
  }

  const tokenAnterior = invitacion.acceptance_token_hash || null;
  const expiracionAnterior = invitacion.expires_at || null;
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const enviadaEn = new Date().toISOString();
  const expiraEn = vencimientoInvitacion(enviadaEn);
  const enlace = crearUrlApp('/activar');
  enlace.searchParams.set('flujo', 'invitacion');
  enlace.searchParams.set('invitacion', invitacion.id);
  enlace.searchParams.set('token', token);
  if (!usuario.email_confirmed_at) enlace.searchParams.set('configurar', '1');

  let actualizacion = supabase.from('planta_invitaciones')
    .update({ acceptance_token_hash: tokenHash, enviada_en: enviadaEn, expires_at: expiraEn })
    .eq('id', invitacion.id).eq('estado', 'pendiente');
  actualizacion = tokenAnterior
    ? actualizacion.eq('acceptance_token_hash', tokenAnterior)
    : actualizacion.is('acceptance_token_hash', null);
  const { data: actualizada, error: errorActualizar } = await actualizacion.select('id').maybeSingle();
  if (errorActualizar || !actualizada) throw Object.assign(new Error('No pudimos preparar el nuevo enlace. Actualiza la lista e inténtalo otra vez.'), { status: 409 });

  let resultadoEnvio;
  try {
    resultadoEnvio = usuario.email_confirmed_at
      ? await supabase.auth.signInWithOtp({ email: invitacion.email, options: { shouldCreateUser: false, emailRedirectTo: enlace.toString() } })
      : await supabase.auth.resend({ type: 'signup', email: invitacion.email, options: { emailRedirectTo: enlace.toString() } });
  } catch {
    // No restaurar el token anterior: la respuesta se perdió y este correo
    // pudo haberse entregado con el token nuevo que ya quedó persistido.
    throw errorEnvioInvitacionIndeterminado();
  }
  const { error: errorEnvio } = resultadoEnvio || {};
  if (errorEnvio) {
    const { data: restaurada, error: errorRestauracion } = await supabase.from('planta_invitaciones')
      .update({ acceptance_token_hash: tokenAnterior, expires_at: expiracionAnterior })
      .eq('id', invitacion.id).eq('estado', 'pendiente').eq('acceptance_token_hash', tokenHash).select('id').maybeSingle();
    if (errorRestauracion || !restaurada) {
      console.error('[downtimeos] no se pudo restaurar la invitación tras fallar el envío:', errorRestauracion?.message || 'la invitación cambió de estado');
      throw Object.assign(new Error('No pudimos enviar el nuevo enlace ni confirmar que el anterior siga vigente. Pide a quien administra la cuenta que vuelva a enviar la invitación.'), { status: 503 });
    }
    throw errorEnvioInvitacion(errorEnvio, { enlaceAnteriorVigente: true });
  }

  const { error: errorAuditoria } = await supabase.from('planta_auditoria').insert({
    organizacion_id: sesion.perfil.organizacion_id, planta_id: sesion.perfil.planta_id,
    actor_id: sesion.user.id, accion: 'invitacion_reenviada', entidad: 'invitacion',
    entidad_id: invitacion.id, detalles: { email: invitacion.email, rol: invitacion.rol },
  });
  if (errorAuditoria) console.error('[downtimeos] no se pudo auditar el reenvío de invitación:', errorAuditoria.message);
  return { enviada: true };
}


export async function contextoPlantaOpcional(encabezado = '') {
  if (!String(encabezado || '').trim()) return null;
  return sesionDesdeEncabezado(encabezado);
}
