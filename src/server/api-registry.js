// Registro único de casos de uso HTTP. El adapter de Next solo se ocupa de
// traducir Request/Response; la selección del caso de uso vive aquí.
export const apiHandlers = {
  health: () => import('../../api/health.js'),
  config: () => import('../../api/health.js'),
  'administracion/sesion': () => import('../../api/health.js'),
  'administracion/salir': () => import('../../api/health.js'),
  leads: () => import('../../api/leads/index.js'),
  'leads/stats': () => import('../../api/leads/stats.js'),
  'ia/resumen': () => import('../../api/ia/resumen.js'),
  'observabilidad/uso': () => import('../../api/observabilidad/uso.js'),
  planta: () => import('../../api/planta/index.js'),
  'planta/estados': () => import('../../api/planta/estados.js'),
  'planta/eventos': () => import('../../api/planta/eventos.js'),
  'planta/reportes': () => import('../../api/planta/reportes.js'),
  'planta/solicitudes': () => import('../../api/planta/solicitudes.js'),
  'whatsapp/alerta': () => import('../../api/whatsapp/alerta.js'),
};
