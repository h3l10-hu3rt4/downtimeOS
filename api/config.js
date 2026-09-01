/**
 * GET /api/config
 * Constantes del modelo y límites de los inputs. Permite que el frontend deje
 * de hardcodearlos algún día (ver HANDOFF.md, "eliminar la duplicación").
 */
import { MODELO, LIMITES, LIMITES_TARIFA } from '../lib/calculo.js';
import { REGLA_B2B_ACTIVA } from '../lib/validacion.js';
import { ruta, json } from '../lib/http.js';

export default ruta(['GET'], async (req, res) => json(res, 200, {
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
}));
