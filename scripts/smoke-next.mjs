import { spawn } from 'node:child_process';

const port = '3101';
const child = spawn(process.execPath, ['--env-file-if-exists=.env.local', '.next/standalone/server.js'], {
  env: { ...process.env, PORT: port, APP_ENV: 'local' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const base = `http://127.0.0.1:${port}`;
const rutas = ['/', '/demo', '/demo/operaciones', '/demo/operador', '/demo/direccion', '/administracion/acceso', '/privacidad', '/api/config'];

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
  await esperarServidor();
  for (const ruta of rutas) {
    await pedir(ruta);
  }
  const landing = await (await pedir('/')).text();
  if (!landing.includes('src="/js/calculator.js"') || !landing.includes('src="/js/app.js"')) {
    throw new Error('La landing no entregó sus scripts interactivos.');
  }
  const demo = await (await pedir('/demo')).text();
  if (!demo.includes('src="/demo/js/usuarios.js"') || !demo.includes('src="/demo/js/sesion.js"')) {
    throw new Error('El acceso de demo no entregó sus scripts de sesión.');
  }
  const accesoAdmin = await (await pedir('/administracion/acceso')).text();
  if (!accesoAdmin.includes('admin-twinkle')) {
    throw new Error('El acceso administrativo perdió sus estilos propios.');
  }
  const privacidad = await (await pedir('/privacidad')).text();
  if (!privacidad.includes('<style')) {
    throw new Error('La página de privacidad perdió sus estilos propios.');
  }
  const operaciones = await (await pedir('/demo/operaciones')).text();
  if (!operaciones.includes('Tablero de Operaciones')) throw new Error('La pantalla de operaciones no contiene su título.');
  const demoCss = await (await pedir('/demo/css/demo.css')).text();
  if (!demoCss.includes('.scroll-reveal') || !demoCss.includes('prefers-reduced-motion')) {
    throw new Error('Los estilos de entrada progresiva del demo no están disponibles.');
  }
  const demoSesion = await (await pedir('/demo/js/sesion.js')).text();
  if (!demoSesion.includes('iniciarRevealTablero') || !demoSesion.includes('IntersectionObserver')) {
    throw new Error('El script de sesión no entregó el reveal del tablero.');
  }
  const config = await (await pedir('/api/config')).json();
  if (config.ok !== true || !config.modelo) throw new Error('La API de configuración no devolvió el contrato esperado.');
  console.log(`Smoke Next OK: ${rutas.length} rutas comprobadas.`);
} finally {
  child.kill();
}
