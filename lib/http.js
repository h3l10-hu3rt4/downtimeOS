/**
 * Utilidades HTTP compartidas por las funciones serverless.
 * Equivalente a los helpers `_json` / `_cors` / `_leer_json` de server/main.py.
 */

export const MAX_BODY = 64 * 1024; // 64 KB: de sobra para un lead

/** CORS abierto, igual que el prototipo local (la landing es pública). */
export function aplicarCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '600');
}

export function json(res, codigo, payload) {
  aplicarCors(res);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(codigo).send(JSON.stringify(payload, null, 2));
}

/**
 * Envuelve un handler: resuelve OPTIONS, filtra métodos y atrapa excepciones
 * para que nunca se escape un 500 sin cuerpo JSON.
 *
 * @param {string[]} metodos  Métodos permitidos, p. ej. ['GET', 'POST'].
 * @param {(req, res) => Promise<void>} handler
 */
export function ruta(metodos, handler) {
  return async function (req, res) {
    if (req.method === 'OPTIONS') {
      aplicarCors(res);
      return res.status(204).end();
    }
    if (!metodos.includes(req.method)) {
      res.setHeader('Allow', [...metodos, 'OPTIONS'].join(', '));
      return json(res, 405, { ok: false, error: `Método ${req.method} no permitido.` });
    }
    try {
      return await handler(req, res);
    } catch (err) {
      console.error('[downtimeos] error no controlado:', err);
      // `.errores` sale de ErrorValidacion; el resto se degrada a 500.
      const codigo = err?.status ?? 500;
      return json(res, codigo, {
        ok: false,
        error: codigo === 500 ? 'Error interno del servidor.' : err.message,
        ...(err?.errores ? { errores: err.errores } : {}),
      });
    }
  };
}

/**
 * Vercel ya parsea el JSON en `req.body`, pero si llega como texto (o si se
 * ejecuta en otro runtime) esto lo cubre igual.
 */
export function leerCuerpo(req) {
  const cuerpo = req.body;
  if (cuerpo === undefined || cuerpo === null || cuerpo === '') {
    const e = new Error('El cuerpo de la petición está vacío.');
    e.status = 400;
    throw e;
  }
  if (typeof cuerpo === 'string') {
    if (cuerpo.length > MAX_BODY) {
      const e = new Error('El cuerpo de la petición excede el límite permitido.');
      e.status = 413;
      throw e;
    }
    try {
      return JSON.parse(cuerpo);
    } catch {
      const e = new Error('El cuerpo no es JSON válido.');
      e.status = 400;
      throw e;
    }
  }
  return cuerpo;
}
