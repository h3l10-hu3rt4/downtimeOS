const LOCALHOST_URL = 'http://localhost:3000';

function esProduccion(env) {
  // Docker conserva NODE_ENV=production para servir el build standalone,
  // pero el perfil local debe permitir callbacks a localhost.
  if (!env.VERCEL && env.APP_ENV === 'development') return false;
  return env.NODE_ENV === 'production' || Boolean(env.VERCEL && env.VERCEL_ENV === 'production');
}

function urlBaseValida(valor, { exigirHttps = false } = {}) {
  try {
    const url = new URL(valor);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (url.username || url.password || url.search || url.hash) return null;
    if (exigirHttps && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

function hostnameVercelValido(valor) {
  const entrada = String(valor || '').trim();
  let hostname = entrada;
  if (/^https?:\/\//i.test(entrada)) {
    try {
      const url = new URL(entrada);
      if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) return null;
      hostname = url.hostname;
    } catch {
      return null;
    }
  }
  hostname = hostname.replace(/\/$/, '').toLowerCase();
  if (!hostname || hostname.includes('/') || hostname.includes(':') || hostname.includes('@')) return null;
  return /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+vercel\.app$/.test(hostname)
    ? `https://${hostname}`
    : null;
}

/** Devuelve solo el origen público validado para generar enlaces de autenticación. */
export function obtenerBaseApp(env = process.env) {
  const produccion = esProduccion(env);
  const explicita = env.APP_URL || env.NEXT_PUBLIC_SITE_URL;

  if (explicita) {
    const base = urlBaseValida(explicita, { exigirHttps: produccion });
    if (base && (!produccion || !/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(base))) return base;
    throw new Error('APP_URL o NEXT_PUBLIC_SITE_URL debe ser una URL HTTP(S) válida y, en producción, usar HTTPS con un dominio público.');
  }

  if (env.VERCEL_URL) {
    const base = hostnameVercelValido(env.VERCEL_URL);
    if (base) return base;
    throw new Error('VERCEL_URL no es un dominio verificado de Vercel; configura APP_URL con el dominio público de la aplicación.');
  }

  if (!produccion) return LOCALHOST_URL;
  throw new Error('Falta configurar APP_URL o NEXT_PUBLIC_SITE_URL para generar enlaces de autenticación en producción.');
}

export function crearUrlApp(ruta, env = process.env) {
  if (typeof ruta !== 'string' || !ruta.startsWith('/') || ruta.startsWith('//') || ruta.includes('\\')) {
    throw new Error('La ruta del enlace de la aplicación debe ser absoluta y local.');
  }
  return new URL(ruta, `${obtenerBaseApp(env)}/`);
}
