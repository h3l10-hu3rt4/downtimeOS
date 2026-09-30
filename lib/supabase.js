/**
 * Cliente de Supabase para los procesos de servidor.
 *
 * La service role jamás se expone al navegador. El cliente se crea bajo demanda:
 * esto permite importar validadores y plantillas sin una base configurada, pero
 * una ruta que necesite datos sigue fallando de forma explícita y segura.
 */
import './entorno.js';
import { createClient } from '@supabase/supabase-js';

let cliente;

function obtenerCliente() {
  if (cliente) return cliente;
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      'Faltan variables de entorno: SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY. '
      + 'Configúralas en el entorno del servidor o en .env.local.',
    );
  }

  const fetchConTiempoLimite = async (input, init = {}) => {
    const controlador = new AbortController();
    const temporizador = setTimeout(() => controlador.abort(), 8_000);
    try {
      return await fetch(input, { ...init, signal: controlador.signal });
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('La conexión con Supabase superó los 8 segundos.');
      const causa = error?.cause;
      if (causa?.code === 'ENOTFOUND' || causa?.code === 'EAI_AGAIN') {
        throw new Error(`No se pudo resolver el dominio de Supabase (${new URL(url).hostname}).`);
      }
      throw error;
    } finally {
      clearTimeout(temporizador);
    }
  };

  cliente = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-application-name': 'downtimeos-landing' }, fetch: fetchConTiempoLimite },
  });
  return cliente;
}

// El Proxy conserva el contrato existente (`supabase.from(...)`) sin abrir una
// conexión durante imports de pruebas o de páginas estáticas.
export const supabase = new Proxy({}, {
  get(target, propiedad) {
    // Las pruebas pueden inyectar un adaptador en memoria sin crear cliente real.
    if (Reflect.has(target, propiedad)) return Reflect.get(target, propiedad);
    const instancia = obtenerCliente();
    const valor = instancia[propiedad];
    return typeof valor === 'function' ? valor.bind(instancia) : valor;
  },
});
