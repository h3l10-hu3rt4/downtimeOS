import { spawn } from 'node:child_process';

const port = '3101';
let child = null;
let base = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3000';
const rutas = ['/', '/demo', '/demo/operaciones', '/demo/operador', '/demo/direccion', '/administracion/acceso', '/privacidad', '/acceso', '/registro', '/recuperar', '/activar', '/configurar-planta', '/plantas', '/estructura', '/equipo', '/suscripcion', '/direccion', '/operaciones', '/operador', '/api/config'];
const apisQueExigenSesion = [
  '/api/cuenta', '/api/planta', '/api/planta/estado-vivo', '/api/planta/equipo',
  '/api/planta/suscripcion', '/api/planta/plantas', '/api/planta/estructura',
  '/api/planta/exportacion', '/api/administracion/suscripciones',
];
// Estas rutas cambian estados o datos si la petición llega autenticada. El
// smoke manda un cuerpo vacío y sin Bearer: deben rechazar antes de mutar.
const apisMutablesQueExigenSesion = [
  '/api/planta/estados', '/api/planta/eventos', '/api/planta/reportes',
  '/api/planta/solicitudes', '/api/planta/configuracion', '/api/ia/resumen',
];

function esperarServidor() {
  return new Promise((resolve, reject) => {
    const limite = setTimeout(() => reject(new Error('Next no inició dentro del tiempo esperado.')), 15000);
    const revisar = async () => {
      try {
        const respuesta = await fetch(`${base}/api/config`);
        if (respuesta.ok) { clearTimeout(limite); resolve(); return; }
      } catch {}
      setTimeout(revisar, 150);
    };
    revisar();
  });
}

async function pedir(ruta) {
  let ultimo;
  for (let intento = 0; intento < 8; intento += 1) {
    try {
      const respuesta = await fetch(`${base}${ruta}`);
      if (respuesta.ok) return respuesta;
      ultimo = new Error(`${ruta} respondió ${respuesta.status}.`);
    } catch (error) {
      ultimo = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw ultimo;
}

try {
  // Docker ya contiene el build standalone; en ese caso smoke puede verificar
  // la aplicación servida sin exigir que .next/standalone exista en el host.
  let disponible = false;
  try {
    const respuesta = await fetch(`${base}/api/config`, { signal: AbortSignal.timeout(1500) });
    disponible = respuesta.ok;
  } catch {}
  if (!disponible) {
    base = `http://127.0.0.1:${port}`;
    const envSmoke = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
      ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'PATHEXT'].includes(name),
    ));
    Object.assign(envSmoke, {
      NODE_ENV: 'production',
      PORT: port,
      HOSTNAME: '127.0.0.1',
      APP_ENV: 'local',
      APP_URL: base,
      NEXT_PUBLIC_SITE_URL: base,
      DOWNTIMEOS_DISABLE_DOTENV: '1',
      // Credenciales ficticias únicamente para que las rutas administrativas
      // alcancen su guardia de sesión en el smoke aislado (y respondan 401).
      DASHBOARD_ADMIN_EMAIL: 'smoke-admin@example.invalid',
      DASHBOARD_ADMIN_PASSWORD: 'smoke-only-not-a-real-secret',
      WHATSAPP_PROVIDER: 'meta',
      WHATSAPP_ALERTAS_ACTIVAS: 'false',
      WHATSAPP_APROBACIONES_ACTIVAS: 'false',
      WHATSAPP_META_USE_TEMPLATES: 'false',
    });
    child = spawn(process.execPath, ['.next/standalone/server.js'], {
      env: envSmoke,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await esperarServidor();
  }
  for (const ruta of rutas) {
    await pedir(ruta);
  }
  for (const ruta of apisQueExigenSesion) {
    const respuesta = await fetch(`${base}${ruta}`);
    // Administración devuelve 503 cuando no se configuraron credenciales
    // locales; también es un rechazo seguro y esperado para el smoke.
    const estadosDeRechazo = ruta === '/api/administracion/suscripciones' ? [401, 503] : [401];
    if (!estadosDeRechazo.includes(respuesta.status)) {
      throw new Error(`${ruta} debe rechazar llamadas sin sesión; respondió ${respuesta.status}.`);
    }
  }
  for (const ruta of apisMutablesQueExigenSesion) {
    const respuesta = await fetch(`${base}${ruta}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    if (respuesta.status !== 401) {
      throw new Error(`${ruta} debe rechazar escrituras sin sesión con HTTP 401; respondió ${respuesta.status}.`);
    }
  }
  // Smoke HTTP sin credenciales: solo verifica que Next sirve una respuesta,
  // no que la página autorice al usuario ni que el flujo complete acciones.
  for (const ruta of ['/recuperar', '/activar', '/configurar-planta', '/equipo', '/suscripcion']) {
    await pedir(ruta);
  }
  const landing = await (await pedir('/')).text();
  // LegacyPage pasa estos scripts como descriptores al cliente para ejecutarlos
  // después de la hidratación; Next los serializa en el payload RSC, no como
  // etiquetas <script> de la respuesta HTML inicial.
  if (!landing.includes(String.raw`\"src\":\"/js/calculator.js\"`) || !landing.includes(String.raw`\"src\":\"/js/app.js\"`)) {
    throw new Error('La landing no entregó sus scripts interactivos.');
  }
  for (const rutaDemo of ['/demo', '/demo/operaciones', '/demo/operador', '/demo/direccion']) {
    const respuesta = await fetch(`${base}${rutaDemo}`, { redirect: 'manual' });
    const destino = respuesta.headers.get('location');
    if (![301, 302, 307, 308].includes(respuesta.status) || !destino || new URL(destino, base).pathname !== '/acceso') {
      throw new Error(`${rutaDemo} debe redirigir al acceso del producto.`);
    }
  }
  const accesoAdmin = await (await pedir('/administracion/acceso')).text();
  if (!accesoAdmin.includes('admin-twinkle')) {
    throw new Error('El acceso administrativo perdió sus estilos propios.');
  }
  const privacidad = await (await pedir('/privacidad')).text();
  if (!privacidad.includes('<style')) {
    throw new Error('La página de privacidad perdió sus estilos propios.');
  }
  // Las páginas operativas solo entregan un cascarón genérico. Supabase Auth
  // vive en localStorage: la guardia del cliente redirige a quien no tiene
  // sesión, mientras los endpoints de datos se validan arriba con Bearer.
  for (const rutaTablero of ['/direccion', '/operaciones', '/operador']) {
    const respuesta = await fetch(`${base}${rutaTablero}`, { redirect: 'manual' });
    if (respuesta.status !== 200 || respuesta.headers.has('location')) {
      throw new Error(`${rutaTablero} debe servir el cascarón para que el guard de cliente lea localStorage; HTTP ${respuesta.status}.`);
    }
    const cookieFalsa = await fetch(`${base}${rutaTablero}`, {
      redirect: 'manual', headers: { Cookie: 'downtimeos_session=no-es-una-sesion' },
    });
    if (cookieFalsa.status !== 200) {
      throw new Error(`${rutaTablero} no debe depender de una cookie legacy; HTTP ${cookieFalsa.status}.`);
    }
  }
  const demoCss = await (await pedir('/demo/css/demo.css')).text();
  if (!demoCss.includes('.mapa-flecha-tren') || !demoCss.includes('prefers-reduced-motion')) {
    throw new Error('Los estilos del mapa y accesibilidad del demo no están disponibles.');
  }
  const demoSesion = await (await pedir('/demo/js/sesion.js')).text();
  if (!demoSesion.includes('Sesion') || !demoSesion.includes('downtimeos_sesion') || demoSesion.includes('downtimeco_demo_sesion')) {
    throw new Error('El script de sesión no está configurado para el producto.');
  }
  const acceso = await (await pedir('/acceso')).text();
  if (!acceso.includes('Acceso a tu planta')) throw new Error('La pantalla de acceso del producto no se entregó.');
  const registro = await (await pedir('/registro')).text();
  if (!registro.includes('Configura tu primera planta')) throw new Error('La pantalla de registro no se entregó.');
  const config = await (await pedir('/api/config')).json();
  if (config.ok !== true || !config.modelo) throw new Error('La API de configuración no devolvió el contrato esperado.');
  console.log(`Smoke Next OK: ${rutas.length} rutas y ${apisQueExigenSesion.length + apisMutablesQueExigenSesion.length} APIs protegidas comprobadas (${apisQueExigenSesion.length} lecturas, ${apisMutablesQueExigenSesion.length} escrituras sin sesión).`);
} finally {
  child?.kill();
}
