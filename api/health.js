/**
 * GET /api/health
 * Estado del servicio y de la persistencia. Responde 503 si Supabase no
 * contesta, para que el badge del footer lo refleje en la landing.
 */
import { MODELO, LIMITES, LIMITES_TARIFA } from '../lib/calculo.js';
import { REGLA_B2B_ACTIVA } from '../lib/validacion.js';
import { administradorConfigurado, cookieSesionInvalida, crearCookieSesion, credencialesAdministradorValidas } from '../lib/administracion.js';
import { ruta, json, leerCuerpo } from '../lib/http.js';

export default ruta(['GET', 'POST'], async (req, res) => {
  if (req.method === 'POST' && req.query?.admin_sesion === '1') {
    const cuerpo = leerCuerpo(req);
    if (!administradorConfigurado()) return json(res, 503, { ok: false, error: 'La administración no está configurada.' });
    if (!credencialesAdministradorValidas(String(cuerpo.correo || ''), String(cuerpo.clave || ''))) {
      return json(res, 401, { ok: false, error: 'Correo o contraseña incorrectos.' });
    }
    res.setHeader('Set-Cookie', crearCookieSesion());
    return json(res, 200, { ok: true });
  }
  if (req.method === 'POST' && req.query?.admin_salir === '1') {
    res.setHeader('Set-Cookie', cookieSesionInvalida());
    return json(res, 200, { ok: true });
  }
  if (req.method !== 'GET') return json(res, 405, { ok: false, error: `Método ${req.method} no permitido.` });
  // /api/config se reescribe aquí para conservar su contrato público sin
  // conservar el contrato público de configuración sin una ruta duplicada.
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
  // El endpoint de salud no debe romperse si faltan credenciales de Supabase:
  // su propósito es justamente comunicar que la persistencia está degradada.
  let conexion;
  try {
    const { verificarConexion } = await import('../lib/repositorio.js');
    conexion = await verificarConexion();
  } catch (error) {
    conexion = {
      disponible: false,
      error: error instanceof Error ? error.message : 'No fue posible inicializar la persistencia.',
      total: null,
      latencia_ms: null,
    };
  }

  return json(res, conexion.disponible ? 200 : 503, {
    ok: conexion.disponible,
    servicio: 'DowntimeOS Landing API',
    version: '2.0.0',
    entorno: process.env.APP_ENV ?? process.env.NODE_ENV ?? 'local',
    region: process.env.APP_REGION ?? null,
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
