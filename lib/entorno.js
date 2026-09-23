/**
 * Carga de variables de entorno para el runtime de Next.js y pruebas.
 *
 * En producción las variables llegan desde el proceso/contenedor. En local y
 * tests se lee `.env.local` y, si no existe, `.env`.
 *
 * Importar este módulo tiene efecto secundario: hazlo ANTES de leer
 * process.env (ver lib/supabase.js).
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as cargarDotenv } from 'dotenv';

const enRuntimeProduccion = process.env.NODE_ENV === 'production';
// `npm start` usa NODE_ENV=production aunque siga siendo una ejecución local.
// APP_ENV=production se reserva para el contenedor/despliegue real.
const cargarArchivoLocal = process.env.APP_ENV !== 'production';

if (cargarArchivoLocal) {
  const candidatos = ['.env.local', '.env'].map((f) => resolve(process.cwd(), f));
  const archivo = candidatos.find((ruta) => existsSync(ruta));

  if (archivo) {
    // Importación estática: Next la incluye también en `.next/standalone`.
    // Con importación dinámica `npm start` no encontraba dotenv y omitía
    // `.env.local`, aunque el modo de desarrollo sí funcionara.
    cargarDotenv({ path: archivo });
  }
}

export const ENTORNO = {
  enRuntimeProduccion,
  nombre: process.env.APP_ENV ?? process.env.NODE_ENV ?? 'local',
};
