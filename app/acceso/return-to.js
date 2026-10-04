// Solo acepta destinos internos conocidos. Nunca devolver URLs externas ni
// rutas arbitrarias recibidas por query string.
export function destinoRetornoSeguro(valor, perfil = null) {
  const destinos = ['/configurar-planta', '/estructura', '/equipo', '/plantas', '/suscripcion', '/direccion', '/operaciones', '/operador'];
  if (!destinos.includes(valor)) return null;

  // El allowlist evita redirecciones externas; estos destinos además dependen
  // de permisos que solo conoce la sesión validada por el servidor.
  if (perfil) {
    if (['/configurar-planta', '/estructura'].includes(valor)
      && !['direccion', 'admin'].includes(perfil.rol)) return null;
    if (valor === '/equipo' && !perfil.es_admin_cuenta) return null;
    if (valor === '/suscripcion'
      && !perfil.es_propietario_cuenta && !perfil.puede_administrar_facturacion) return null;
  }
  return valor;
}

const DESTINOS_LEGACY = Object.freeze({
  direccion: '/direccion',
  finanzas: '/direccion',
  operaciones: '/operaciones',
  operador: '/operador',
  '/direccion': '/direccion',
  '/operaciones': '/operaciones',
  '/operador': '/operador',
});

/** Acepta el parámetro antiguo de los dashboards, pero nunca su valor libre. */
export function destinoDeParametros(parametros, perfil = null) {
  if (parametros.has('returnTo')) {
    return destinoRetornoSeguro(parametros.get('returnTo'), perfil);
  }
  const ruta = DESTINOS_LEGACY[parametros.get('destino')];
  return ruta ? destinoRetornoSeguro(ruta, perfil) : null;
}
