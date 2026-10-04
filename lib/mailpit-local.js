const HOSTS_LOCALES = new Set(['localhost', '127.0.0.1', '[::1]', 'host.docker.internal']);

/** Devuelve el origen de Inbucket/Mailpit del Supabase Local si es seguro. */
export function urlMailpitLocal(supabaseUrl) {
  let url;
  try { url = new URL(String(supabaseUrl || '')); } catch { return ''; }
  if (url.protocol !== 'http:' || !HOSTS_LOCALES.has(url.hostname.toLowerCase())) return '';
  const puertoApi = Number(url.port);
  if (!Number.isSafeInteger(puertoApi) || puertoApi < 1 || puertoApi > 65532) return '';

  // Supabase Local asigna Inbucket al puerto API + 3 (54321 → 54324).
  if (url.hostname.toLowerCase() === 'host.docker.internal') url.hostname = 'localhost';
  url.port = String(puertoApi + 3);
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return url.origin;
}
