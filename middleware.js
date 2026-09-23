import { NextResponse } from 'next/server';

// El middleware solo decide navegación y no importa módulos Node. La
// autenticación administrativa vive en los handlers de servidor.
export function middleware() {
  return NextResponse.next();
}

export const config = {
  matcher: ['/administracion/:path*', '/dashboard/apiGastos/:path*', '/api/observabilidad/uso', '/api/ia/resumen'],
};
