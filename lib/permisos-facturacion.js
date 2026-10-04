/**
 * La administración de cuenta y la autoridad para editar facturación son
 * permisos distintos. El propietario siempre puede editar; otros miembros
 * necesitan el permiso explícito de facturación.
 */
export function puedeLeerFacturacion(perfil = {}) {
  return Boolean(perfil.es_propietario_cuenta || perfil.puede_administrar_facturacion);
}

export function puedeEditarFacturacion(perfil = {}) {
  return Boolean(perfil.es_propietario_cuenta || perfil.puede_administrar_facturacion);
}
