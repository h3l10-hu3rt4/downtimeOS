/**
 * GET /api/planta
 *
 * Devuelve TODO el estado de la planta en una sola respuesta: catálogo de
 * líneas, causas y activos, estado vivo del piso, bandeja de solicitudes y la
 * bitácora de paros.
 *
 * Va junto a propósito. Los tres tableros necesitan las cinco cosas a la vez
 * para pintar su primera vista, y una función serverless que responde una vez
 * cuesta menos —en latencia y en arranques en frío— que cinco que responden
 * por separado.
 *
 * Query:
 *   ?desde=2026-08-01T00:00:00Z   acota la bitácora (opcional)
 *   ?limite=500                   tope de eventos devueltos
 */
import { estadoPlanta, eventosDePlanta } from '../../lib/planta.js';
import { ruta, json } from '../../lib/http.js';
import { sesionDesdeEncabezado } from '../../lib/cuenta.js';
import { agregarImpactoActual, datosVisiblesPorRol as protegerFinanzas } from '../../lib/visibilidad-financiera.js';

export function datosVisiblesPorRol(estado, perfil) {
  // La administración de usuarios/cuenta no equivale al permiso para ver
  // costos de producción. Operaciones ve impacto para priorizar, no tarifas;
  // el Operador solo ve estado y duración. Una delegación no amplía el rol.
  // La misma protección se comparte con respuestas de escritura (eventos y
  // cierres); un Operador no debe recibir costos por una ruta secundaria.
  return protegerFinanzas(estado, perfil);
}

function fechaCursorValida(valor) {
  return typeof valor === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(valor) &&
    !Number.isNaN(Date.parse(valor));
}

export default ruta(['GET'], async (req, res) => {
  const { desde, hasta, limite, cursor, solo_eventos: soloEventos } = req.query ?? {};
  const sesion = await sesionDesdeEncabezado(req.headers?.authorization, req.headers?.['x-downtimeos-planta']);
  if (!sesion.perfil.onboarding_completado_en) {
    return json(res, 409, { ok: false, codigo: 'ONBOARDING_INCOMPLETO', error: 'Termina de configurar tus líneas y máquinas para abrir el tablero.', siguiente: '/configurar-planta' });
  }

  let cursorEventos = null;
  if (cursor) {
    try { cursorEventos = typeof cursor === 'string' ? JSON.parse(cursor) : null; } catch { cursorEventos = null; }
    if (!cursorEventos || !fechaCursorValida(cursorEventos.created_at) || !fechaCursorValida(cursorEventos.snapshot) ||
        typeof cursorEventos.folio !== 'string' || !/^[\w-]{1,200}$/.test(cursorEventos.folio)) {
      return json(res, 400, { ok: false, error: 'El cursor de la bitácora no es válido.' });
    }
  }

  if (soloEventos === '1') {
    if (!cursorEventos) return json(res, 400, { ok: false, error: 'Falta el cursor de la bitácora.' });
    const pagina = await eventosDePlanta({
      desde: desde || null,
      hasta: hasta || null,
      limite: 500,
      plantaId: sesion.perfil.planta_id,
      cursor: cursorEventos,
      snapshot: cursorEventos.snapshot,
    });
    return json(res, 200, datosVisiblesPorRol({
      ok: true,
      eventos: pagina.eventos,
      meta: { eventos: pagina.eventos.length, snapshot: pagina.snapshot, siguiente_cursor: pagina.siguiente_cursor },
    }, sesion.perfil));
  }

  const tamanoPagina = limite === undefined ? 500 : Number(limite);
  if (!Number.isSafeInteger(tamanoPagina) || tamanoPagina < 1 || tamanoPagina > 500) {
    return json(res, 400, { ok: false, error: 'El tamaño de página debe estar entre 1 y 500.' });
  }

  const estado = await estadoPlanta({
    desde: desde || null,
    hasta: hasta || null,
    limite: tamanoPagina,
    plantaId: sesion.perfil.planta_id,
  });

  // La API conserva la política por rol: impacto para Operaciones; tarifas solo
  // para Dirección/Finanzas; Operadores sin importes ni tarifas.
  const salida = datosVisiblesPorRol(agregarImpactoActual(estado), sesion.perfil);
  // La identidad UUID del autor solo se usa en servidor para autorizar el
  // retiro de su reporte; los tableros muestran el nombre, nunca ese ID.
  salida.solicitudes = salida.solicitudes.map(({ reportado_por_user_id, ...solicitud }) => solicitud);
  return json(res, 200, {
    ok: true,
    meta: {
      actualizado: new Date().toISOString(),
      lineas: estado.lineas.length,
      activos: estado.activos.length,
      eventos: estado.eventos.length,
      snapshot: estado.paginacion_eventos.snapshot,
      siguiente_cursor: estado.paginacion_eventos.siguiente_cursor,
      solicitudes_abiertas: estado.solicitudes.length,
    },
    ...salida,
  });
});
