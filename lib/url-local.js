/**
 * En Docker local la app habla con Supabase por `host.docker.internal`, que el
 * navegador del desarrollador no resuelve. Los enlaces firmados de Storage que
 * se entregan al navegador deben apuntar a `localhost`; cualquier otra URL
 * (producción incluida) se devuelve sin cambios.
 */
export function urlParaNavegador(url) {
  let parsed;
  try { parsed = new URL(String(url || '')); } catch { return url; }
  if (parsed.protocol !== 'http:' || parsed.hostname.toLowerCase() !== 'host.docker.internal') return url;
  parsed.hostname = 'localhost';
  return parsed.toString();
}
