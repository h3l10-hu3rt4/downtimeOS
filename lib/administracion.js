import { createHmac, timingSafeEqual } from 'node:crypto';

const NOMBRE_COOKIE = 'downtimeos_admin';
const DURACION_SESION_SEGUNDOS = 8 * 60 * 60;

function firma(valor, secreto) {
  return createHmac('sha256', secreto).update(valor).digest('base64url');
}

function cookies(encabezado = '') {
  return Object.fromEntries(String(encabezado).split(';').map((parte) => {
    const indice = parte.indexOf('=');
    return indice < 0 ? [] : [parte.slice(0, indice).trim(), parte.slice(indice + 1).trim()];
  }).filter((par) => par.length));
}

export function credencialesAdministradorValidas(correo, clave) {
  return Boolean(process.env.DASHBOARD_ADMIN_EMAIL && process.env.DASHBOARD_ADMIN_PASSWORD)
    && correo === process.env.DASHBOARD_ADMIN_EMAIL
    && clave === process.env.DASHBOARD_ADMIN_PASSWORD;
}

export function administradorConfigurado() {
  return Boolean(process.env.DASHBOARD_ADMIN_EMAIL && process.env.DASHBOARD_ADMIN_PASSWORD);
}

export function crearCookieSesion() {
  const vence = Math.floor(Date.now() / 1000) + DURACION_SESION_SEGUNDOS;
  const carga = `admin:${vence}`;
  const token = `${Buffer.from(carga).toString('base64url')}.${firma(carga, process.env.DASHBOARD_ADMIN_PASSWORD)}`;
  const segura = process.env.VERCEL_ENV === 'production' ? '; Secure' : '';
  return `${NOMBRE_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${DURACION_SESION_SEGUNDOS}${segura}`;
}

export function cookieSesionInvalida() {
  return `${NOMBRE_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

export function sesionAdministradorValida(encabezadoCookie) {
  if (!administradorConfigurado()) return false;
  const token = cookies(encabezadoCookie)[NOMBRE_COOKIE];
  if (!token) return false;
  const [cargaCodificada, firmaRecibida] = token.split('.');
  if (!cargaCodificada || !firmaRecibida) return false;
  try {
    const carga = Buffer.from(cargaCodificada, 'base64url').toString('utf8');
    const [, vence] = carga.split(':');
    if (!/^[0-9]+$/.test(vence) || Number(vence) < Math.floor(Date.now() / 1000)) return false;
    const esperada = firma(carga, process.env.DASHBOARD_ADMIN_PASSWORD);
    const recibida = Buffer.from(firmaRecibida);
    const esperadaBuffer = Buffer.from(esperada);
    return recibida.length === esperadaBuffer.length && timingSafeEqual(recibida, esperadaBuffer);
  } catch {
    return false;
  }
}
