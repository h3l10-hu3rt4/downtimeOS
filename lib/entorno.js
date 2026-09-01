/**
 * Carga de variables de entorno para ejecución LOCAL.
 *
 * En Vercel (producción, preview y `vercel dev`) las variables ya vienen
 * inyectadas en process.env, así que aquí no se hace nada. Fuera de Vercel
 * —por ejemplo `node script.js` o pruebas de integración— se lee `.env.local`
 * y, si no existe, `.env`.
 *
 * Importar este módulo tiene efecto secundario: hazlo ANTES de leer
 * process.env (ver lib/supabase.js).
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const enVercel = Boolean(process.env.VERCEL);

if (!enVercel) {
  const candidatos = ['.env.local', '.env'].map((f) => resolve(process.cwd(), f));
  const archivo = candidatos.find((ruta) => existsSync(ruta));

  if (archivo) {
    try {
      const { config } = await import('dotenv');
      config({ path: archivo });
    } catch {
      // dotenv es opcional: si no está instalado, se asume que las variables
      // ya vienen del shell. No vale la pena tumbar el proceso por esto.
      console.warn('[downtimeos] dotenv no disponible; usando process.env tal cual.');
    }
  }
}

export const ENTORNO = {
  enVercel,
  nombre: process.env.VERCEL_ENV ?? 'local',
};
