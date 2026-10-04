const ORGANIZACION_LEGACY = 'Histórico DowntimeOS';

// Business/tenant tables that must be empty before this write-heavy E2E starts.
// Global reference catalogs and leads are intentionally excluded: migrations
// seed those independently of any customer tenant.
export const TABLAS_CON_DATOS_TENANT_E2E = Object.freeze([
  'planta_lineas',
  'planta_activos',
  'planta_estados',
  'planta_eventos',
  'planta_solicitudes',
  'planta_cancelaciones',
  'planta_perfiles',
  'planta_analisis_ia',
  'planta_reportes',
  'planta_mensajes',
  'planta_membresias',
  'planta_invitaciones',
  'planta_auditoria',
  'organizacion_admin_delegados',
  'organizacion_suscripciones',
  'organizacion_suscripcion_avisos',
  'organizacion_pagos',
  'organizacion_facturacion',
  'organizacion_pago_comprobante_intentos',
]);

export const BUCKETS_CON_ARCHIVOS_TENANT_E2E = Object.freeze([
  'comprobantes-suscripcion',
  'reportes',
]);

export function esUrlFirmadaStorageLocal(value, supabaseOrigin) {
  try {
    const url = new URL(value);
    return url.origin === supabaseOrigin && url.pathname.startsWith('/storage/v1/object/sign/');
  } catch {
    return false;
  }
}

/**
 * A migration-only bootstrap tenant is created when upgrading the original
 * single-plant schema. It is safe for the disposable E2E only while it remains
 * the sole organization, with its single LEGACY plant and no account data.
 */
export function validarBaseE2E({
  organizaciones,
  totalOrganizaciones,
  plantasLegacy = [],
  totalPlantasLegacy = 0,
  filasTenant,
  bucketsConArchivos,
}) {
  if (!Array.isArray(organizaciones) || !Number.isSafeInteger(totalOrganizaciones) || totalOrganizaciones < 0) return false;
  if (totalOrganizaciones === 0 && organizaciones.length !== 0) return false;
  if (totalOrganizaciones > 1 || organizaciones.length > 1) return false;

  if (totalOrganizaciones === 1) {
    const [organizacion] = organizaciones;
    if (!organizacion?.id || organizacion.nombre !== ORGANIZACION_LEGACY) return false;
    if (!Array.isArray(plantasLegacy) || totalPlantasLegacy !== 1 || plantasLegacy.length !== 1) return false;
    const [planta] = plantasLegacy;
    if (planta?.organizacion_id !== organizacion.id || planta.codigo !== 'LEGACY') return false;
  } else if (totalPlantasLegacy !== 0 || plantasLegacy.length !== 0) {
    return false;
  }

  if (!filasTenant || typeof filasTenant !== 'object'
    || TABLAS_CON_DATOS_TENANT_E2E.some((tabla) => !Number.isSafeInteger(filasTenant[tabla]) || filasTenant[tabla] !== 0)) {
    return false;
  }
  if (!Array.isArray(bucketsConArchivos) || bucketsConArchivos.length > 0) return false;
  return true;
}
