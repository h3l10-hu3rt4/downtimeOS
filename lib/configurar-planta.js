function siguienteCodigo(prefijo, elementos) {
  const usados = new Set(elementos.map(({ id }) => id));
  for (let numero = 1; numero <= elementos.length + 1; numero += 1) {
    const codigo = `${prefijo}-${String(numero).padStart(2, '0')}`;
    if (!usados.has(codigo)) return codigo;
  }
  return `${prefijo}-${String(elementos.length + 2).padStart(2, '0')}`;
}

export function codigoLineaDisponible(lineas) {
  return siguienteCodigo('L', lineas);
}

export function codigoMaquinaDisponible(activos) {
  return siguienteCodigo('M', activos);
}

export function renombrarLinea(lineas, activos, indice, codigo) {
  const anterior = lineas[indice]?.id;
  return {
    lineas: lineas.map((linea, i) => i === indice ? { ...linea, id: codigo } : linea),
    activos: activos.map((activo) => activo.linea_id === anterior ? { ...activo, linea_id: codigo } : activo),
  };
}

export function quitarLinea(lineas, activos, indice) {
  if (lineas.length <= 1 || !lineas[indice]) return { lineas, activos };
  const codigo = lineas[indice].id;
  return {
    lineas: lineas.filter((_, i) => i !== indice),
    activos: activos.filter((activo) => activo.linea_id !== codigo),
  };
}

export function nuevoActivo(lineas, activos) {
  if (!lineas.length) return null;
  const codigo = codigoMaquinaDisponible(activos);
  return { id: codigo, linea_id: lineas[0].id };
}

export function ordenEtapasInicialValido(activos) {
  return Array.isArray(activos) && activos.every((activo) => activo
    && Number.isInteger(Number(activo.etapa_orden))
    && Number(activo.etapa_orden) >= 1
    && Number(activo.etapa_orden) <= 99);
}

export function validarBorradorPlanta(lineas, activos) {
  if (!lineas.length) return 'Agrega al menos una línea para configurar la planta.';
  if (!activos.length) return 'Agrega al menos una máquina para configurar la planta.';
  if (new Set(lineas.map(({ id }) => id)).size !== lineas.length) {
    return 'Hay códigos de línea repetidos. Asigna un código distinto a cada línea.';
  }
  if (new Set(activos.map(({ id }) => id)).size !== activos.length) {
    return 'Hay códigos de máquina repetidos. Asigna un código distinto a cada máquina.';
  }
  const codigosLinea = new Set(lineas.map(({ id }) => id));
  if (activos.some(({ linea_id }) => !codigosLinea.has(linea_id))) {
    return 'Cada máquina debe pertenecer a una línea existente. Revisa la línea asignada.';
  }
  return '';
}
