/**
 * Cliente de Supabase para las funciones serverless de Vercel.
 *
 * ⚠️ Usa SUPABASE_SERVICE_ROLE_KEY, que OMITE Row Level Security. Esta llave
 *    solo puede vivir en variables de entorno del servidor. Nunca la pongas en
 *    public/, ni en un prefijo NEXT_PUBLIC_/VITE_, ni la subas al repo.
 *
 * El cliente se crea una sola vez por instancia de la función (Vercel reutiliza
 * el proceso entre invocaciones tibias), así que no se paga la construcción en
 * cada request.
 */
import './entorno.js'; // carga .env.local fuera de Vercel; debe ir ANTES de leer process.env
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  // Falla al arrancar, no a media petición: el error es mucho más legible.
  throw new Error(
    'Faltan variables de entorno: SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY. '
    + 'Configúralas en Vercel → Project → Settings → Environment Variables '
    + '(y en .env.local para desarrollo con `vercel dev`).',
  );
}

export const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { 'x-application-name': 'downtimeos-landing' } },
});
