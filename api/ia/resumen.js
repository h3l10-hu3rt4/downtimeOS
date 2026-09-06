import { generarAnalisis } from '../../lib/integraciones.js';
import { supabase } from '../../lib/supabase.js';
import { ruta, json, leerCuerpo } from '../../lib/http.js';

// Claude con análisis financiero profundo puede tardar más que el modelo rápido
// de Gemini; evitamos que la función termine antes de devolver el JSON.
export const maxDuration = 60;

const ENFOQUES = new Set(['finanzas', 'operaciones']);
const PROVEEDORES = new Set(['gemini', 'anthropic']);

export default ruta(['GET', 'POST', 'PUT'], async (req, res) => {
  // Esta misma función aloja la configuración del proveedor para no exceder
  // las 12 funciones del plan Hobby. POST sigue reservado al análisis.
  if (req.method === 'GET') {
    const { data, error } = await supabase.from('planta_proveedor_ia').select('enfoque, proveedor, updated_at');
    if (error) throw Object.assign(new Error(`No fue posible leer proveedor IA: ${error.message}`), { status: 500 });
    return json(res, 200, { ok: true, proveedores: data });
  }
  const cuerpo = leerCuerpo(req);
  if (req.method === 'PUT') {
    if (!ENFOQUES.has(cuerpo.enfoque) || !PROVEEDORES.has(cuerpo.proveedor)) {
      return json(res, 400, { ok: false, error: 'Enfoque o proveedor no permitido.' });
    }
    const { data, error } = await supabase.from('planta_proveedor_ia').upsert({
      enfoque: cuerpo.enfoque, proveedor: cuerpo.proveedor, updated_at: new Date().toISOString(),
    }, { onConflict: 'enfoque' }).select('enfoque, proveedor, updated_at').single();
    if (error) throw Object.assign(new Error(`No fue posible guardar proveedor IA: ${error.message}`), { status: 500 });
    return json(res, 200, { ok: true, proveedor: data });
  }
  const enfoque = cuerpo.enfoque === 'operaciones' ? 'operaciones' : 'finanzas';
  const analisis = await generarAnalisis({
    desde: cuerpo.desde ?? null, hasta: cuerpo.hasta ?? null, enfoque,
  });
  return json(res, 201, { ok: true, analisis });
});
