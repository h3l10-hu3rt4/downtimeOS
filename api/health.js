/**
 * GET /api/health
 * Estado del servicio y de la persistencia. Responde 503 si Supabase no
 * contesta, para que el badge del footer lo refleje en la landing.
 */
import { verificarConexion } from '../lib/repositorio.js';
import { MODELO, LIMITES, LIMITES_TARIFA } from '../lib/calculo.js';
import { REGLA_B2B_ACTIVA } from '../lib/validacion.js';
import { ruta, json } from '../lib/http.js';

export default ruta(['GET'], async (req, res) => {
  // /api/config se reescribe aquí para conservar su contrato público sin
  // consumir una función adicional en Vercel Hobby. Ese cupo permite mantener
  // el middleware que protege Administración.
  if (req.query?.config === '1') {
    return json(res, 200, {
      ok: true,
      modelo: {
        dias_operativos: MODELO.DIAS_OPERATIVOS,
        meses: MODELO.MESES_ANIO,
        factor_mitigacion: MODELO.FACTOR_MITIGACION,
        tipo_cambio_usd: MODELO.TIPO_CAMBIO_USD,
      },
      limites: LIMITES,
      limites_tarifa: LIMITES_TARIFA,
      regla_b2b_activa: REGLA_B2B_ACTIVA,
    });
  }
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
      // Alias de compatibilidad: public/js/app.js pinta `persistencia.archivo`
      // en el badge del footer (venía de la era JSON, donde era la ruta del
      // archivo). Sin este campo el badge muestra "API OK · undefined".
      // public/ es intocable, así que la compatibilidad la da la API.
      archivo: 'public.leads',
      disponible: conexion.disponible,
      latencia_ms: conexion.latencia_ms,
      error: conexion.error,
    },
    leads: { total: conexion.total },
  });
});
