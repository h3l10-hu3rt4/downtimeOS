/**
 * GET  /api/leads   Lista de leads. Query: ?estatus=NUEVO&limite=10&desde=0
 * POST /api/leads   Alta de lead: valida → recalcula → persiste en Supabase.
 *
 * Equivale a `_listar_leads()` y `_crear_lead()` de server/main.py.
 * Este handler no contiene reglas de negocio: orquesta validación, cálculo y
 * repositorio, igual que el servidor local.
 */
import { calcular } from '../../lib/calculo.js';
import { validarLead, normalizarOrigen, estatusDeOrigen } from '../../lib/validacion.js';
import { listarLeads, crearLead } from '../../lib/repositorio.js';
import { ruta, json, leerCuerpo } from '../../lib/http.js';

export default ruta(['GET', 'POST'], async (req, res) => {
  if (req.method === 'GET') {
    const { estatus, limite, desde } = req.query ?? {};
    const { leads, total } = await listarLeads({ estatus, limite, desde: Number(desde) || 0 });
    return json(res, 200, {
      ok: true,
      meta: { total, actualizado: new Date().toISOString() },
      total_filtrado: leads.length,
      leads,
    });
  }

  // ---------------------------------------------------------------- POST
  const payload = leerCuerpo(req);
  const origen = normalizarOrigen(payload.origen);

  // Lanza ErrorValidacion (400 + mapa campo→mensaje), que atrapa `ruta()`.
  const limpio = validarLead(payload, origen);

  // El servidor NUNCA confía en las cifras del cliente: recalcula.
  const finanzas = calcular({
    maquinas: limpio.maquinas,
    turnos: limpio.turnos,
    tarifa_hora: limpio.tarifa_hora,
    minutos_paro_dia: limpio.minutos_paro_dia,
    divisa: limpio.divisa,
  });

  const lead = await crearLead({
    nombre: limpio.nombre,
    puesto: limpio.puesto,
    empresa: limpio.empresa,
    sector: limpio.sector,
    email: limpio.email,
    telefono: limpio.telefono,
    ciudad: limpio.ciudad,
    parque_industrial: limpio.parque_industrial,

    maquinas: finanzas.maquinas,
    turnos: finanzas.turnos,
    tarifa_hora: finanzas.tarifa_hora,
    minutos_paro_dia: finanzas.minutos_paro_dia,
    divisa: finanzas.divisa,

    perdida_diaria: finanzas.perdida_diaria,
    perdida_mensual: finanzas.perdida_mensual,
    perdida_anual: finanzas.perdida_anual,
    ahorro_proyectado: finanzas.ahorro_proyectado,
    perdida_anual_mxn: finanzas.perdida_anual_mxn,
    costo_por_minuto: finanzas.costo_por_minuto,

    origen,
    estatus: estatusDeOrigen(origen),
    utm: limpio.utm,
    notas: limpio.notas,
  });

  console.log(`[downtimeos] LEAD ${lead.id} -> ${lead.empresa} (${lead.estatus})`);

  return json(res, 201, {
    ok: true,
    mensaje: 'Lead registrado correctamente.',
    lead,
  });
});
