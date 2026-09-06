import { supabase } from '../../lib/supabase.js';
import { ruta, json, leerCuerpo } from '../../lib/http.js';

const ENFOQUES = new Set(['finanzas', 'operaciones']);
const PROVEEDORES = new Set(['gemini', 'anthropic']);

export default ruta(['GET', 'PUT'], async (req, res) => {
  if (req.method === 'GET') {
    const { data, error } = await supabase.from('planta_proveedor_ia').select('enfoque, proveedor, updated_at');
    if (error) throw Object.assign(new Error(`No fue posible leer proveedor IA: ${error.message}`), { status: 500 });
    return json(res, 200, { ok: true, proveedores: data });
  }
  const cuerpo = leerCuerpo(req);
  if (!ENFOQUES.has(cuerpo.enfoque) || !PROVEEDORES.has(cuerpo.proveedor)) {
    return json(res, 400, { ok: false, error: 'Enfoque o proveedor no permitido.' });
  }
  const { data, error } = await supabase.from('planta_proveedor_ia').upsert({
    enfoque: cuerpo.enfoque, proveedor: cuerpo.proveedor, updated_at: new Date().toISOString(),
  }, { onConflict: 'enfoque' }).select('enfoque, proveedor, updated_at').single();
  if (error) throw Object.assign(new Error(`No fue posible guardar proveedor IA: ${error.message}`), { status: 500 });
  return json(res, 200, { ok: true, proveedor: data });
});
