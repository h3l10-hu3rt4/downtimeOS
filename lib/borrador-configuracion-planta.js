const PREFIJO = 'downtimeos_borrador_configuracion';

export function claveBorradorConfiguracion(usuarioId, plantaId) {
  if (!usuarioId || !plantaId) return '';
  return `${PREFIJO}:${usuarioId}:${plantaId}`;
}

function borradorValido(valor) {
  return valor && typeof valor === 'object' && valor.version === 1
    && Array.isArray(valor.lineas) && valor.lineas.length > 0 && valor.lineas.length <= 30
    && valor.lineas.every((linea) => linea && typeof linea.id === 'string' && typeof linea.nombre === 'string')
    && Array.isArray(valor.activos) && valor.activos.length <= 500
    && valor.activos.every((activo) => activo && typeof activo.id === 'string'
      && typeof activo.linea_id === 'string' && typeof activo.nombre === 'string'
      && typeof activo.tipo === 'string' && typeof activo.etapa === 'string');
}

export function leerBorradorConfiguracion(clave) {
  if (!clave || typeof window === 'undefined') return null;
  try {
    const borrador = JSON.parse(window.localStorage.getItem(clave) || 'null');
    return borradorValido(borrador) ? borrador : null;
  } catch {
    return null;
  }
}

export function guardarBorradorConfiguracion(clave, lineas, activos) {
  if (!clave || typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(clave, JSON.stringify({ version: 1, lineas, activos }));
    return true;
  } catch {
    return false;
  }
}

export function borrarBorradorConfiguracion(clave) {
  if (!clave || typeof window === 'undefined') return false;
  try {
    window.localStorage.removeItem(clave);
    return true;
  } catch {
    return false;
  }
}
