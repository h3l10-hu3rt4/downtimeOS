const ETIQUETAS_ESTADO = Object.freeze({
  solicitada: 'En revisión',
  piloto: 'Piloto activo',
  pendiente_pago: 'Pago pendiente',
  activa: 'Activa',
  vencida: 'Vencida',
  cancelacion_programada: 'Cancelación al fin del periodo',
  cancelada: 'Cancelada',
  suspendida: 'Suspendida',
  reemplazada: 'Reemplazada por mejora de plan',
});

export function etiquetaEstadoSuscripcion(suscripcion, ahora = Date.now()) {
  if (suscripcion?.estado === 'cancelada' && suscripcion.inicia_en && Date.parse(suscripcion.inicia_en) > ahora) {
    return 'Renovación cancelada antes de iniciar';
  }
  return ETIQUETAS_ESTADO[suscripcion?.estado] || suscripcion?.estado || 'Sin estado';
}

export function fechaFinSuscripcion(suscripcion, ahora = Date.now()) {
  if (!suscripcion?.termina_en) return null;
  if (suscripcion.inicia_en && Date.parse(suscripcion.inicia_en) > ahora) return null;
  if (['activa', 'piloto', 'cancelacion_programada'].includes(suscripcion.estado)) return 'Acceso hasta';
  if (suscripcion.estado === 'vencida') return 'Periodo contratado hasta';
  return null;
}
