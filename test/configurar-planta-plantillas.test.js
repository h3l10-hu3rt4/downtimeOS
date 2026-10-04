import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { codigoLineaDisponible, codigoMaquinaDisponible, nuevoActivo, ordenEtapasInicialValido, quitarLinea, renombrarLinea, validarBorradorPlanta } from '../lib/configurar-planta.js';

const fuente = await readFile(new URL('../app/configurar-planta/page.js', import.meta.url), 'utf8');
const estilos = await readFile(new URL('../public/css/styles.css', import.meta.url), 'utf8');

test('ofrece inicio desde cero y plantillas como borradores con campos reales vacíos', () => {
  assert.match(fuente, /Empezar desde cero/);
  assert.match(fuente, /Object\.entries\(PLANTILLAS\)/);
  assert.match(fuente, /nombre: ''/);
  assert.match(fuente, /tarifa_hora: ''/);
  assert.match(fuente, /No incluye nombres de activos ni tarifas[\s\S]*no guarda nada hasta que captures tus datos reales y pulses Guardar y continuar/);
  assert.match(fuente, /function cargarPlantilla\(clave\)/);
  assert.match(fuente, /setLineas\(borrador\.lineas\);\s*setActivos\(borrador\.activos\)/);
});

test('plantillas mantienen etapas secuenciales y permiten máquinas paralelas en una etapa', () => {
  assert.match(fuente, /basica:[\s\S]*etapas: 3, paralelas: 1/);
  assert.match(fuente, /paralela:[\s\S]*etapas: 2, paralelas: 2/);
  assert.match(fuente, /etapa_orden: etapa \+ 1/);
  assert.match(fuente, /Array\.from\(\{ length: definicion\.paralelas \}/);
  assert.match(fuente, /Máquinas con el mismo nombre de etapa se consideran paralelas/);
});

test('permite quitar líneas y sus máquinas, así como máquinas individuales', () => {
  assert.match(fuente, /function quitarLinea\(indice\)/);
  assert.match(fuente, /quitarLineaDelBorrador\(lineas, activos, indice\)/);
  assert.match(fuente, /aria-label=\{`Quitar línea \$\{linea\.id\}`\}/);
  assert.match(fuente, /function quitarActivo\(indice\)/);
  assert.match(fuente, />Quitar máquina</);
});

test('la configuración informa y aplica en la interfaz los mismos máximos que la API', async () => {
  assert.match(fuente, /lineas\.length >= 30/);
  assert.match(fuente, /máximo 30/);
  assert.match(fuente, /activos\.length >= 500/);
  assert.match(fuente, /máximo 500/);
  const api = await readFile(new URL('../api/planta/configuracion.js', import.meta.url), 'utf8');
  assert.match(api, /lineas\.length > 30 \|\| activos\.length > 500/);
});

test('el orden de etapa queda limitado a 1–99 en el guardado inicial, la API y la base', async () => {
  assert.equal(ordenEtapasInicialValido([{ etapa_orden: 1 }, { etapa_orden: 99 }]), true);
  assert.equal(ordenEtapasInicialValido([{ etapa_orden: 100 }]), false);
  assert.equal(ordenEtapasInicialValido([{ etapa_orden: 1.5 }]), false);
  assert.equal(ordenEtapasInicialValido([{}]), false);
  const api = await readFile(new URL('../api/planta/configuracion.js', import.meta.url), 'utf8');
  const sql = await readFile(new URL('../supabase/migrations/20261003000200_limitar_orden_etapa.sql', import.meta.url), 'utf8');
  assert.match(api, /ordenEtapasInicialValido\(activos\)/);
  assert.match(sql, /new\.etapa_orden not between 1 and 99/);
  assert.match(sql, /before insert or update on public\.planta_activos/i);
});

test('un error inesperado del guardado no expone el mensaje técnico de Supabase', async () => {
  const api = await readFile(new URL('../api/planta/configuracion.js', import.meta.url), 'utf8');
  assert.match(api, /datosInvalidos \? 400 : 500/);
  assert.match(api, /No pudimos guardar la configuración por un problema del servidor/);
  assert.doesNotMatch(api, /error:\s*conflicto\s*\?[^\n]*:\s*error\.message/);
});

test('los códigos nuevos no se duplican al borrar filas intermedias', () => {
  assert.equal(codigoLineaDisponible([{ id: 'L-01' }, { id: 'L-03' }]), 'L-02');
  assert.equal(codigoMaquinaDisponible([{ id: 'M-01' }, { id: 'M-03' }]), 'M-02');
});

test('renombrar o quitar líneas mantiene coherentes las máquinas asociadas', () => {
  const lineas = [{ id: 'L-01' }, { id: 'L-02' }];
  const activos = [{ id: 'M-01', linea_id: 'L-01' }, { id: 'M-02', linea_id: 'L-02' }];
  const renombrado = renombrarLinea(lineas, activos, 0, 'L-03');
  assert.equal(renombrado.activos[0].linea_id, 'L-03');
  const quitado = quitarLinea(renombrado.lineas, renombrado.activos, 0);
  assert.deepEqual(quitado.lineas, [{ id: 'L-02' }]);
  assert.deepEqual(quitado.activos, [{ id: 'M-02', linea_id: 'L-02' }]);
});

test('se conserva al menos una línea y una máquina, y se rechazan referencias inválidas', () => {
  const lineas = [{ id: 'L-01' }];
  const activos = [{ id: 'M-01', linea_id: 'L-01' }];
  assert.deepEqual(quitarLinea(lineas, activos, 0), { lineas, activos });
  assert.equal(nuevoActivo([], activos), null);
  assert.match(validarBorradorPlanta(lineas, []), /al menos una máquina/);
  assert.match(validarBorradorPlanta(lineas, [{ id: 'M-02', linea_id: 'L-99' }]), /línea existente/);
  assert.equal(validarBorradorPlanta(lineas, activos), '');
});

test('la única escritura remota sigue siendo el envío explícito del formulario', () => {
  assert.match(fuente, /<form[^>]*onSubmit=\{guardar\}/);
  assert.match(fuente, /fetchConSesion\('\/api\/planta\/configuracion'/);
  assert.equal((fuente.match(/fetchConSesion\('\/api\/planta\/configuracion'/g) || []).length, 1);
  assert.match(fuente, /async function guardar\(evento\)[\s\S]*?fetchConSesion\('\/api\/planta\/configuracion'/);
});

test('acciones secundarias de configuración tienen contraste oscuro de DowntimeOS', () => {
  assert.match(estilos, /\.btn--secondary\s*\{[^}]*background:\s*#111820;[^}]*color:\s*#c4cedb;/);
  assert.match(estilos, /\.btn--secondary:hover:not\(:disabled\)/);
  assert.match(fuente, /className="btn btn--secondary"/);
});

test('configuración inicial redirige a acceso antes de mostrar el formulario si falta sesión', () => {
  assert.match(fuente, /const \[sesionLista, setSesionLista\] = useState\(false\)/);
  assert.match(fuente, /useEffect\(\(\) => \{\s*const sesion = leerSesionNavegador\(\);\s*if \(!sesion\.access_token\) \{\s*location\.replace\('\/acceso\?returnTo=%2Fconfigurar-planta'\)/);
  assert.match(fuente, /if \(!sesionLista\) return <main className="auth-page"[\s\S]*?Verificando tu sesión/);
});

test('administración de estructura redirige a acceso antes de mostrar formularios si falta sesión', async () => {
  const estructura = await readFile(new URL('../app/estructura/page.js', import.meta.url), 'utf8');
  assert.match(estructura, /const \[sesionLista, setSesionLista\] = useState\(false\)/);
  assert.match(estructura, /if \(!sesion\.access_token\) \{\s*location\.replace\('\/acceso\?returnTo=%2Festructura'\)/);
  assert.match(estructura, /if \(!sesionLista\) return <main className="account-page"[\s\S]*?Verificando tu sesión/);
  assert.match(await readFile(new URL('../app/acceso/return-to.js', import.meta.url), 'utf8'), /'\/estructura'/);
});

test('estructura espera autorización del API y oculta formularios a roles sin permiso', async () => {
  const estructura = await readFile(new URL('../app/estructura/page.js', import.meta.url), 'utf8');
  assert.match(estructura, /error\.status = respuesta\.status/);
  assert.match(estructura, /setAcceso\(error\.status === 403 \? 'denegado' : 'error'\)/);
  assert.match(estructura, /acceso === 'denegado'[\s\S]*?Solo Dirección puede cambiar/);
  assert.match(estructura, /acceso === 'permitido' \? <>[\s\S]*?Agregar línea[\s\S]*?Agregar equipo[\s\S]*?<\/\> : null/);
});

test('formularios de onboarding y facturación aplican controles oscuros con foco visible', async () => {
  const suscripcion = await readFile(new URL('../app/suscripcion/page.js', import.meta.url), 'utf8');
  assert.match(suscripcion, /className="onboarding-section billing-request"/);
  assert.match(suscripcion, /className="onboarding-section billing-fiscal"/);
  assert.match(estilos, /\.onboarding-section input:not\(\[type="checkbox"\]\):not\(\[type="file"\]\),\s*\.onboarding-section select,\s*\.onboarding-section textarea\s*\{[^}]*background:\s*var\(--bg-base\);[^}]*color:\s*var\(--text-primary\);/);
  assert.match(estilos, /\.onboarding-section select\s*\{\s*color-scheme:\s*dark;/);
  assert.match(estilos, /\.onboarding-section input:not\(\[type="checkbox"\]\):not\(\[type="file"\]\):focus,\s*\.onboarding-section select:focus,\s*\.onboarding-section textarea:focus/);
  assert.match(suscripcion, /className="billing-panels"/);
  assert.match(estilos, /\.billing-panels\s*\{\s*display:\s*grid;\s*gap:\s*18px;\s*margin-top:\s*18px;/);
  assert.match(estilos, /\.billing-card select\s*\{/);
  assert.match(estilos, /\.team-invite-form select,[\s\S]*?\.billing-card select\s*\{[^}]*min-height:\s*42px;[^}]*border:\s*1px solid var\(--border\);[^}]*color-scheme:\s*dark;/);
  assert.match(estilos, /\.billing-panels\s*\{[^}]*gap:\s*18px/);
  assert.match(estilos, /@media\s*\(max-width:\s*520px\)\s*\{[\s\S]*?\.billing-panels\s*\{\s*gap:\s*14px;/);
});
