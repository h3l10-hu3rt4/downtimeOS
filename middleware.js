/**
 * Protección de servidor para el área privada de administración.
 *
 * No reutiliza la sesión simulada de /demo: aquella vive en el navegador y no
 * protege rutas. Aquí las credenciales viven solamente en variables de Vercel
 * o .env.local y el contenido estático nunca se entrega sin autenticación.
 */
import './lib/entorno.js';
import { administradorConfigurado, sesionAdministradorValida } from './lib/administracion.js';

function requiereProteccion(url, metodo) {
  const ruta = url.pathname;
  if (ruta === '/administracion/acceso') return false;
  if (ruta === '/administracion' || ruta.startsWith('/administracion/')) return true;
  if (ruta === '/dashboard/apiGastos' || ruta.startsWith('/dashboard/apiGastos/')) return true;
  if (ruta === '/api/observabilidad/uso') return true;
  // POST es el análisis usado por las pantallas de la demo. GET/PUT son el
  // catálogo y el selector de proveedor exclusivos de Administración.
  return ruta === '/api/ia/resumen' && metodo !== 'POST';
}

function continuar() {
  // Equivalente framework-agnóstico de NextResponse.next(). Sin esta cabecera,
  // `vercel dev` devolvía 200 con cuerpo vacío tras una sesión válida.
  return new Response(null, { headers: { 'x-middleware-next': '1' } });
}

export default function middleware(request) {
  const url = new URL(request.url);
  if (!requiereProteccion(url, request.method)) return continuar();

  if (!administradorConfigurado()) {
    return new Response('La administración no está configurada.', {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  if (sesionAdministradorValida(request.headers.get('cookie'))) {
    return continuar();
  }

  if (url.pathname === '/administracion' || url.pathname.startsWith('/dashboard/apiGastos')) {
    return Response.redirect(new URL('/administracion/acceso', request.url), 302);
  }

  return new Response(JSON.stringify({ ok: false, error: 'Sesión de administración requerida.' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
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
