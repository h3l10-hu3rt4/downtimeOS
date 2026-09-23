/**
 * Cliente de Supabase para el runtime de servidor de Next.js.
 *
 * ⚠️ Usa SUPABASE_SERVICE_ROLE_KEY, que OMITE Row Level Security. Esta llave
 *    solo puede vivir en variables de entorno del servidor. Nunca la pongas en
 *    public/, ni en un prefijo NEXT_PUBLIC_/VITE_, ni la subas al repo.
 *
 * El cliente se crea una sola vez por proceso, así que no se paga la
 * construcción en cada request.
 */
import './entorno.js'; // carga .env.local en desarrollo antes de leer process.env
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  // Falla al arrancar, no a media petición: el error es mucho más legible.
  throw new Error(
    'Faltan variables de entorno: SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY. '
    + 'Configúralas como variables del proceso o en .env.local para desarrollo.',
  );
}

// Node/undici no aplica un límite corto a una petición de red. Sin este
// envoltorio, una DNS/red caída podía dejar un tablero esperando mucho tiempo
// antes de que datos.js activara su modo local.
const fetchConTiempoLimite = async (input, init = {}) => {
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), 8_000);
  try {
    return await fetch(input, { ...init, signal: controlador.signal });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('La conexión con Supabase superó los 8 segundos.');
    }
    const causa = error?.cause;
    if (causa?.code === 'ENOTFOUND' || causa?.code === 'EAI_AGAIN') {
      throw new Error(`No se pudo resolver el dominio de Supabase (${new URL(url).hostname}).`);
    }
    throw error;
  } finally {
    clearTimeout(temporizador);
  }
};

export const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: {
    headers: { 'x-application-name': 'downtimeos-landing' },
    fetch: fetchConTiempoLimite,
  },
});
