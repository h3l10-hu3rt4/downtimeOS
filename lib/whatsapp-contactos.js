import { createHash } from 'node:crypto';

export function hashCodigoVerificacionWhatsApp(codigo) {
  return createHash('sha256').update(String(codigo)).digest('hex');
}

export function normalizarTelefonoE164(valor) {
  const entrada = String(valor ?? '').trim();
  const digitos = entrada.replace(/\D/g, '');
  const e164 = entrada.startsWith('+') ? `+${digitos}` : digitos.length === 10 ? `+52${digitos}` : '';
  if (!/^\+[1-9][0-9]{7,14}$/.test(e164)) {
    const error = new Error('Escribe el número en formato internacional, por ejemplo +52 55 1234 5678.');
    error.status = 400;
    throw error;
  }
  return e164;
}

/**
 * Meta may represent Mexican WhatsApp senders as 52 + 10 digits or 521 + 10
 * digits. Compare both forms as the same subscriber, without relaxing the
 * requirement that the contact is consented and verified.
 */
export function normalizarTelefonoWhatsAppParaComparar(valor) {
  const digitos = String(valor ?? '').replace(/\D/g, '');
  return digitos.length === 13 && digitos.startsWith('521')
    ? `52${digitos.slice(3)}`
    : digitos;
}

export function esCodigoDeVerificacionEntrante(texto) {
  return /^DOWNTIMEOS\s+VERIFICAR\s+[A-Za-z0-9_-]{32,}$/i.test(String(texto ?? '').trim());
}
