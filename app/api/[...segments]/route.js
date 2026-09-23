import { NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import { apiHandlers } from '../../../src/server/api-registry.js';

export const runtime = 'nodejs';

function createResponse() {
  let status = 200;
  const headers = new Headers();
  let body = null;
  return {
    setHeader(name, value) { headers.set(name, Array.isArray(value) ? value.join(', ') : String(value)); },
    getHeader(name) { return headers.get(name); },
    status(code) { status = code; return this; },
    json(value) { body = JSON.stringify(value); headers.set('content-type', 'application/json; charset=utf-8'); return this; },
    send(value) { body = typeof value === 'string' ? value : JSON.stringify(value); return this; },
    end(value = '') { body = value; return this; },
    result() { return new NextResponse(body, { status, headers }); },
  };
}

async function invoke(request, context) {
  const segments = (await context.params).segments || [];
  const key = segments.join('/');
  const loader = apiHandlers[key];
  if (!loader) return NextResponse.json({ ok: false, error: 'Ruta API no encontrada.' }, { status: 404 });
  const module = await loader();
  const url = new URL(request.url);
  let body;
  if (!['GET', 'HEAD'].includes(request.method)) {
    const raw = await request.text();
    try { body = raw ? JSON.parse(raw) : {}; } catch { body = raw; }
  }
  const req = Object.assign(Readable.from([]), {
    method: request.method,
    headers: Object.fromEntries(request.headers.entries()),
    body,
    query: {
      ...Object.fromEntries(url.searchParams.entries()),
      ...(key === 'config' ? { config: '1' } : {}),
      ...(key === 'administracion/sesion' ? { admin_sesion: '1' } : {}),
      ...(key === 'administracion/salir' ? { admin_salir: '1' } : {}),
    },
    url: `${url.pathname}${url.search}`,
  });
  const response = createResponse();
  await module.default(req, response);
  return response.result();
}

export const GET = invoke;
export const POST = invoke;
export const PUT = invoke;
export const PATCH = invoke;
export const DELETE = invoke;
