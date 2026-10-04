const CAMPOS_TARIFA = /tarifa/i;
const CAMPOS_FINANCIEROS = /(tarifa|costo|coste|impacto|importe|monto|precio)/i;
const ROLES_FINANCIEROS = new Set(['direccion', 'finanzas', 'admin']);
const ROLES_IMPACTO = new Set(['direccion', 'finanzas', 'admin', 'operaciones']);

/** Agrega el importe del paro vivo sin exponer tarifa por máquina. */
export function agregarImpactoActual(estado, ahora = Date.now()) {
  const tarifasPorLinea = new Map();
  const paralelosPorActivo = new Map();
  const paralelosPorEtapa = new Map();
  for (const activo of estado.activos || []) {
    const linea = activo.linea_id;
    const grupo = `${linea}:${activo.etapa ?? ''}`;
    tarifasPorLinea.set(linea, (tarifasPorLinea.get(linea) || 0) + Number(activo.tarifa_hora || 0));
    paralelosPorEtapa.set(grupo, (paralelosPorEtapa.get(grupo) || 0) + 1);
    paralelosPorActivo.set(activo.id, grupo);
  }
  return {
    ...estado,
    estados: (estado.estados || []).map((fila) => {
      if (fila.estado !== 'STOP') return fila;
      const grupo = paralelosPorActivo.get(fila.activo_id);
      const activo = (estado.activos || []).find((item) => item.id === fila.activo_id);
      if (!grupo || !activo || !Number.isFinite(Date.parse(fila.desde))) return fila;
      const minutos = Math.max(0, Math.round((ahora - Date.parse(fila.desde)) / 60_000));
      const tarifaEfectiva = (tarifasPorLinea.get(activo.linea_id) || 0) / paralelosPorEtapa.get(grupo);
      return { ...fila, impacto_actual_mxn: Math.round((minutos / 60) * tarifaEfectiva * 100) / 100 };
    }),
  };
}

/**
 * Quita campos financieros de cualquier objeto de respuesta, incluso cuando
 * vienen anidados dentro de un evento o una respuesta RPC.
 */
export function ocultarDatosFinancieros(valor) {
  if (Array.isArray(valor)) return valor.map(ocultarDatosFinancieros);
  if (!valor || typeof valor !== 'object') return valor;
  return Object.fromEntries(Object.entries(valor)
    .filter(([campo]) => !CAMPOS_FINANCIEROS.test(campo))
    .map(([campo, contenido]) => [campo, ocultarDatosFinancieros(contenido)]));
}

function ocultarTarifas(valor) {
  if (Array.isArray(valor)) return valor.map(ocultarTarifas);
  if (!valor || typeof valor !== 'object') return valor;
  return Object.fromEntries(Object.entries(valor)
    .filter(([campo]) => !CAMPOS_TARIFA.test(campo))
    .map(([campo, contenido]) => [campo, ocultarTarifas(contenido)]));
}

export function datosVisiblesPorRol(valor, perfil = {}) {
  if (ROLES_FINANCIEROS.has(perfil.rol)) return valor;
  if (ROLES_IMPACTO.has(perfil.rol)) return ocultarTarifas(valor);
  return ocultarDatosFinancieros(valor);
}
