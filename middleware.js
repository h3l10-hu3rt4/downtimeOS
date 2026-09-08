/**
 * Protección de servidor para el área privada de administración.
 *
 * No reutiliza la sesión simulada de /demo: aquella vive en el navegador y no
 * protege rutas. Aquí las credenciales viven solamente en variables de Vercel
 * o .env.local y el contenido estático nunca se entrega sin autenticación.
 */
import './lib/entorno.js';

function requiereProteccion(url, metodo) {
  const ruta = url.pathname;
  if (ruta === '/administracion' || ruta.startsWith('/administracion/')) return true;
  if (ruta === '/dashboard/apiGastos' || ruta.startsWith('/dashboard/apiGastos/')) return true;
  if (ruta === '/api/observabilidad/uso') return true;
  // POST es el análisis usado por las pantallas de la demo. GET/PUT son el
  // catálogo y el selector de proveedor exclusivos de Administración.
  return ruta === '/api/ia/resumen' && metodo !== 'POST';
}

function respuestaSinAcceso() {
  return new Response('Acceso restringido.', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="DowntimeOS Administracion", charset="UTF-8"',
      'Cache-Control': 'no-store',
    },
  });
}

export default function middleware(request) {
  if (!requiereProteccion(new URL(request.url), request.method)) return;

  const correoConfigurado = process.env.DASHBOARD_ADMIN_EMAIL;
  const claveConfigurada = process.env.DASHBOARD_ADMIN_PASSWORD;
  if (!correoConfigurado || !claveConfigurada) {
    return new Response('La administración no está configurada.', {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const encabezado = request.headers.get('authorization') || '';
  if (!encabezado.startsWith('Basic ')) return respuestaSinAcceso();

  try {
    const credenciales = atob(encabezado.slice(6));
    const separador = credenciales.indexOf(':');
    const correo = credenciales.slice(0, separador);
    const clave = credenciales.slice(separador + 1);
    if (separador < 0 || correo !== correoConfigurado || clave !== claveConfigurada) {
      return respuestaSinAcceso();
    }
  } catch {
    return respuestaSinAcceso();
  }
}

export const config = {
  runtime: 'nodejs',
  matcher: [
    '/administracion/:path*',
    '/dashboard/apiGastos/:path*',
    '/api/observabilidad/uso',
    '/api/ia/resumen',
  ],
};
