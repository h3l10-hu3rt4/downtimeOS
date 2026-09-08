import { supabase } from './supabase.js';

const TABLA = 'planta_interruptores_integraciones';
const DEFAULT = { ia: true, whatsapp: true, pdf: true };

function errorPeticion(mensaje, status = 400) {
  const error = new Error(mensaje);
  error.status = status;
  return error;
}

function esTablaAusente(error) {
  return error?.code === '42P01' || /planta_interruptores_integraciones/i.test(error?.message || '');
}

export async function estadoInterruptoresIntegraciones() {
  const { data, error } = await supabase.from(TABLA).select('ia_activa, whatsapp_activa, pdf_activa, updated_at').eq('clave', 'global').maybeSingle();
  if (error && !esTablaAusente(error)) throw errorPeticion(`No fue posible leer los interruptores: ${error.message}`, 500);
  const configuracion = data
    ? { ia: data.ia_activa, whatsapp: data.whatsapp_activa, pdf: data.pdf_activa }
    : DEFAULT;
  return {
    configuracion,
    efectivos: configuracion,
    persistencia_lista: !error,
    updated_at: data?.updated_at ?? null,
  };
}

export async function guardarInterruptoresIntegraciones(configuracion) {
  for (const nombre of Object.keys(DEFAULT)) {
    if (typeof configuracion?.[nombre] !== 'boolean') throw errorPeticion(`El interruptor ${nombre} debe ser booleano.`);
  }
  const { error } = await supabase.from(TABLA).upsert({
    clave: 'global', ia_activa: configuracion.ia, whatsapp_activa: configuracion.whatsapp,
    pdf_activa: configuracion.pdf, updated_at: new Date().toISOString(),
  }, { onConflict: 'clave' });
  if (error) {
    const mensaje = esTablaAusente(error)
      ? 'Falta aplicar la migración de interruptores de integraciones en Supabase.'
      : `No fue posible guardar los interruptores: ${error.message}`;
    throw errorPeticion(mensaje, 503);
  }
  return estadoInterruptoresIntegraciones();
}

export async function exigirIntegracionActiva(nombre) {
  const estado = await estadoInterruptoresIntegraciones();
  if (!estado.efectivos[nombre]) {
    throw errorPeticion('Esta función no está disponible en este momento.', 503);
  }
  return estado;
}
