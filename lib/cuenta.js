import { supabase } from './supabase.js';

const ROLES = new Set(['direccion', 'operaciones', 'operador']);

function errorPeticion(mensaje, status = 400) {
  return Object.assign(new Error(mensaje), { status });
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
  if (password.length < 10) throw errorPeticion('La contraseña debe tener al menos 10 caracteres.');
  return {
    email, password,
    nombre: texto(datos.nombre, 'el nombre'),
    empresa: texto(datos.empresa, 'el nombre de la empresa'),
    planta: texto(datos.planta || 'Planta principal', 'el nombre de la planta'),
  };
}

export async function registrarEmpresa(datos) {
  const entrada = validarRegistro(datos);
  const { data: usuario, error: errorUsuario } = await supabase.auth.admin.createUser({
    email: entrada.email, password: entrada.password, email_confirm: true,
    user_metadata: { nombre: entrada.nombre },
  });
  if (errorUsuario) throw Object.assign(new Error(errorUsuario.message), { status: 422 });
  try {
    const { data: empresa, error: errorEmpresa } = await supabase
      .from('organizaciones').insert({ nombre: entrada.empresa }).select().single();
    if (errorEmpresa) throw errorEmpresa;
    const { data: planta, error: errorPlanta } = await supabase
      .from('plantas').insert({ organizacion_id: empresa.id, nombre: entrada.planta }).select().single();
    if (errorPlanta) throw errorPlanta;
    const { error: perfilError } = await supabase.from('planta_perfiles').insert({
      user_id: usuario.user.id, organizacion_id: empresa.id, planta_id: planta.id,
      rol: 'direccion', nombre: entrada.nombre, planta_codigo: planta.codigo,
    });
    if (perfilError) throw perfilError;
    return { empresa, planta, usuario: { id: usuario.user.id, email: entrada.email, rol: 'direccion' } };
  } catch (error) {
    await supabase.auth.admin.deleteUser(usuario.user.id).catch(() => {});
    throw Object.assign(new Error(`No fue posible crear la empresa: ${error.message}`), { status: 500 });
  }
}

export async function iniciarSesion({ email, password }) {
  const { data, error } = await supabase.auth.signInWithPassword({ email: String(email || '').trim(), password: String(password || '') });
  if (error || !data.session) throw errorPeticion('Correo o contraseña incorrectos.', 401);
  const { data: perfil, error: errorPerfil } = await supabase.from('planta_perfiles')
    .select('rol,nombre,organizacion_id,planta_id,plantas(nombre,codigo),organizaciones(nombre)')
    .eq('user_id', data.user.id).eq('activo', true).maybeSingle();
  if (errorPerfil || !perfil) throw errorPeticion('Tu usuario no tiene una planta asignada.', 403);
  return { access_token: data.session.access_token, refresh_token: data.session.refresh_token, perfil };
}

export async function sesionDesdeEncabezado(encabezado = '') {
  const token = String(encabezado).replace(/^Bearer\s+/i, '').trim();
  if (!token) throw errorPeticion('Sesión requerida.', 401);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) throw errorPeticion('Sesión inválida o expirada.', 401);
  const { data: perfil, error: errorPerfil } = await supabase.from('planta_perfiles')
    .select('rol,nombre,organizacion_id,planta_id,plantas(nombre,codigo),organizaciones(nombre)')
    .eq('user_id', data.user.id).eq('activo', true).maybeSingle();
  if (errorPerfil || !perfil) throw errorPeticion('Tu usuario no tiene una planta asignada.', 403);
  return { user: data.user, perfil };
}

export async function invitarUsuario(sesion, datos) {
  if (!['direccion', 'operaciones'].includes(sesion.perfil.rol)) throw errorPeticion('No tienes permiso para invitar usuarios.', 403);
  const email = texto(datos.email, 'el correo', 254).toLowerCase();
  const nombre = texto(datos.nombre, 'el nombre');
  const rol = String(datos.rol || 'operador');
  if (!ROLES.has(rol)) throw errorPeticion('Rol no válido.');
  const temporal = String(datos.password || '');
  if (temporal.length < 10) throw errorPeticion('La contraseña temporal debe tener al menos 10 caracteres.');
  const { data: creado, error } = await supabase.auth.admin.createUser({ email, password: temporal, email_confirm: true, user_metadata: { nombre } });
  if (error) throw Object.assign(new Error(error.message), { status: 422 });
  const { error: perfilError } = await supabase.from('planta_perfiles').insert({
    user_id: creado.user.id, organizacion_id: sesion.perfil.organizacion_id, planta_id: sesion.perfil.planta_id,
    rol, nombre, planta_codigo: sesion.perfil.plantas?.codigo || '',
  });
  if (perfilError) { await supabase.auth.admin.deleteUser(creado.user.id).catch(() => {}); throw Object.assign(new Error(perfilError.message), { status: 500 }); }
  return { id: creado.user.id, email, nombre, rol };
}


export async function contextoPlantaOpcional(encabezado = '') {
  if (!String(encabezado || '').trim()) return null;
  return sesionDesdeEncabezado(encabezado);
}
