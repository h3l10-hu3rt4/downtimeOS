/**
 * DowntimeOS · Reglas de validación de la capa de negocio (Node / ESM).
 * Puerto 1:1 de `server/validacion.py` (PRD, RF-03).
 *
 *   · Campos obligatorios según el origen del lead.
 *   · Correo con formato válido y regla B2B: se rechazan dominios genéricos
 *     (@gmail.com, @hotmail.com, @outlook.com, @yahoo…) cuando la regla está
 *     activa.
 *   · Teléfono/WhatsApp de 10 dígitos (MX) tolerando espacios, guiones y +52.
 *   · Saneamiento: se recortan cadenas y se limita su longitud para que nada
 *     raro llegue a Postgres.
 *
 * La lista de dominios se queda en código (y no en una tabla de Supabase) a
 * propósito: cambia seguido, no vale un round-trip a la base por request, y así
 * el comportamiento es idéntico al del prototipo local.
 */

export const RE_EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

/** Regla B2B (RF-03): dominios públicos rechazados. */
export const DOMINIOS_GENERICOS = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.es', 'hotmail.mx',
  'outlook.com', 'outlook.es', 'live.com', 'live.com.mx', 'msn.com',
  'yahoo.com', 'yahoo.com.mx', 'yahoo.es', 'icloud.com', 'me.com',
  'aol.com', 'protonmail.com', 'proton.me', 'gmx.com', 'mail.com',
  'zoho.com', 'yandex.com', 'tutanota.com', 'example.com',
]);

// Se puede apagar por entorno sin tocar código (útil para demos).
export const REGLA_B2B_ACTIVA = process.env.REGLA_B2B_ACTIVA !== 'false';

export const LARGO_MAXIMO = 160;
export const ORIGENES_VALIDOS = new Set(['CALCULADORA', 'AUDITORIA']);
export const ESTATUS_VALIDOS = new Set(['NUEVO', 'AUDITORIA_SOLICITADA']);

/** Error de validación con el mapa campo → mensaje que consume el frontend. */
export class ErrorValidacion extends Error {
  constructor(errores) {
    super('Datos inválidos');
    this.name = 'ErrorValidacion';
    this.status = 400;
    this.errores = errores;
  }
}

export function limpiarTexto(valor, maximo = LARGO_MAXIMO) {
  if (valor === null || valor === undefined) return '';
  return String(valor)
    .replace(/\0/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, maximo);
}

/** Tolera espacios, guiones, paréntesis y la lada de país (+52 / +52 1). */
export function normalizarTelefono(valor) {
  let d = String(valor ?? '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('52')) d = d.slice(2);
  if (d.length === 13 && d.startsWith('521')) d = d.slice(3);
  return d;
}

export function dominioDe(email) {
  return email.includes('@') ? email.split('@').pop().toLowerCase() : '';
}

export function validarEmail(email, errores, campo = 'email') {
  const limpio = limpiarTexto(email).toLowerCase();

  if (!limpio) {
    errores[campo] = 'El correo corporativo es obligatorio.';
    return limpio;
  }
  if (!RE_EMAIL.test(limpio)) {
    errores[campo] = 'El formato del correo no es válido.';
    return limpio;
  }
  if (REGLA_B2B_ACTIVA && DOMINIOS_GENERICOS.has(dominioDe(limpio))) {
    errores[campo] = 'Usa un correo corporativo. Los dominios públicos '
      + '(@gmail.com, @hotmail.com, @outlook.com...) no son aceptados.';
  }
  return limpio;
}

/** Normaliza el origen recibido; cualquier valor raro cae a CALCULADORA. */
export function normalizarOrigen(valor) {
  const o = String(valor ?? 'CALCULADORA').toUpperCase();
  return ORIGENES_VALIDOS.has(o) ? o : 'CALCULADORA';
}

export function estatusDeOrigen(origen) {
  return origen === 'AUDITORIA' ? 'AUDITORIA_SOLICITADA' : 'NUEVO';
}

/**
 * Valida y normaliza el payload del formulario.
 *
 * @param {object} payload  Cuerpo JSON de la petición.
 * @param {'CALCULADORA'|'AUDITORIA'} origen
 * @returns {object} datos saneados listos para `calcular()` y para insertar.
 * @throws {ErrorValidacion} con `.errores` = { campo: mensaje }
 */
export function validarLead(payload, origen) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ErrorValidacion({ _: 'El cuerpo debe ser un objeto JSON.' });
  }

  const errores = {};
  const limpio = {};

  limpio.nombre = limpiarTexto(payload.nombre);
  if (limpio.nombre.length < 3) {
    errores.nombre = 'Escribe tu nombre completo (mínimo 3 caracteres).';
  }

  limpio.empresa = limpiarTexto(payload.empresa);
  if (limpio.empresa.length < 2) {
    errores.empresa = 'El nombre de la empresa es obligatorio.';
  }

  limpio.email = validarEmail(payload.email, errores);

  const telefono = normalizarTelefono(payload.telefono);
  if (!telefono) {
    errores.telefono = 'El teléfono / WhatsApp es obligatorio.';
  } else if (telefono.length !== 10) {
    errores.telefono = 'El teléfono debe tener 10 dígitos.';
  }
  limpio.telefono = telefono;

  limpio.puesto = limpiarTexto(payload.puesto) || 'No especificado';
  limpio.ciudad = limpiarTexto(payload.ciudad);
  limpio.parque_industrial = limpiarTexto(payload.parque_industrial);
  limpio.sector = limpiarTexto(payload.sector);
  limpio.notas = limpiarTexto(payload.notas, 500);

  // El formulario de cierre exige ciudad / parque industrial.
  if (origen === 'AUDITORIA' && !limpio.ciudad) {
    errores.ciudad = 'Indica la ciudad o parque industrial de la planta.';
  }

  // --- Parámetros de la calculadora -----------------------------------------
  // Acepta "1,500" y "$1500" porque el input de la landing es de texto libre.
  const numero = (clave, defecto) => {
    const crudo = payload[clave] ?? defecto;
    const n = Number(String(crudo).replace(/,/g, '').replace(/\$/g, '').trim());
    if (!Number.isFinite(n)) {
      errores[clave] = 'Debe ser un valor numérico.';
      return Number(defecto);
    }
    return n;
  };

  limpio.maquinas = numero('maquinas', 5);
  limpio.turnos = numero('turnos', 2);
  limpio.tarifa_hora = numero('tarifa_hora', 1200);
  limpio.minutos_paro_dia = numero('minutos_paro_dia', 25);
  limpio.divisa = String(payload.divisa ?? 'MXN').toUpperCase() === 'USD' ? 'USD' : 'MXN';

  const utm = (payload.utm && typeof payload.utm === 'object' && !Array.isArray(payload.utm))
    ? payload.utm
    : {};
  limpio.utm = {
    utm_source: limpiarTexto(utm.utm_source) || 'directo',
    utm_medium: limpiarTexto(utm.utm_medium) || 'landing',
    utm_campaign: limpiarTexto(utm.utm_campaign) || 'margen-oculto-2026',
  };

  if (Object.keys(errores).length > 0) throw new ErrorValidacion(errores);
  return limpio;
}
