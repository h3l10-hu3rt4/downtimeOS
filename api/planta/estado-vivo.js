/**
 * GET /api/planta/estado-vivo
 * Sondeo ligero de estados actuales y solicitudes abiertas; excluye bitácora.
 */
import { estadoVivoPlanta, impactoActualEstados } from '../../lib/planta.js';
import { ruta, json } from '../../lib/http.js';
import { sesionDesdeEncabezado } from '../../lib/cuenta.js';
import { datosVisiblesPorRol } from '../../lib/visibilidad-financiera.js';

export default ruta(['GET'], async (req, res) => {
  const sesion = await sesionDesdeEncabezado(req.headers?.authorization, req.headers?.['x-downtimeos-planta']);
  if (!sesion.perfil.onboarding_completado_en) {
    return json(res, 409, { ok: false, codigo: 'ONBOARDING_INCOMPLETO', error: 'Termina de configurar tus líneas y máquinas para abrir el tablero.', siguiente: '/configurar-planta' });
  }
  const vivo = await estadoVivoPlanta({ plantaId: sesion.perfil.planta_id });
  if (sesion.perfil.rol === 'operaciones') {
    vivo.estados = (await impactoActualEstados(vivo.estados, { plantaId: sesion.perfil.planta_id })).estados;
  }
  vivo.estados = datosVisiblesPorRol(vivo, sesion.perfil).estados;
  vivo.solicitudes = vivo.solicitudes.map(({ reportado_por_user_id, ...solicitud }) => solicitud);
  return json(res, 200, {
    ok: true,
    meta: { actualizado: new Date().toISOString(), estados: vivo.estados.length, solicitudes_abiertas: vivo.solicitudes.length },
    ...vivo,
  });
});
