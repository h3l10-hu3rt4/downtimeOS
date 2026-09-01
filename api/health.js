/**
 * GET /api/health
 * Estado del servicio y de la persistencia. Responde 503 si Supabase no
 * contesta, para que el badge del footer lo refleje en la landing.
 */
import { verificarConexion } from '../lib/repositorio.js';
import { ruta, json } from '../lib/http.js';

export default ruta(['GET'], async (req, res) => {
  const conexion = await verificarConexion();

  return json(res, conexion.disponible ? 200 : 503, {
    ok: conexion.disponible,
    servicio: 'DowntimeOS Landing API',
    version: '2.0.0',
    entorno: process.env.VERCEL_ENV ?? 'local',
    region: process.env.VERCEL_REGION ?? null,
    timestamp: new Date().toISOString(),
    persistencia: {
      motor: 'Supabase (PostgreSQL)',
      tabla: 'public.leads',
      disponible: conexion.disponible,
      latencia_ms: conexion.latencia_ms,
      error: conexion.error,
    },
    leads: { total: conexion.total },
  });
});
