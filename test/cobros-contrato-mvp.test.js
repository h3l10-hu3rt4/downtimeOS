import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { etiquetaEstadoSuscripcion, fechaFinSuscripcion } from '../lib/etiquetas-suscripcion.js';
import { validarCantidadPlantasEnterprise } from '../api/planta/suscripcion.js';

const api = await readFile(new URL('../api/planta/suscripcion.js', import.meta.url), 'utf8');
const ui = await readFile(new URL('../app/suscripcion/page.js', import.meta.url), 'utf8');
const sql = await readFile(new URL('../supabase/migrations/20260930000200_onboarding.sql', import.meta.url), 'utf8');
const renovacion = await readFile(new URL('../supabase/migrations/20261001000000_renovacion.sql', import.meta.url), 'utf8');
const periodosOfrecidos = await readFile(new URL('../supabase/migrations/20261004000300_renovar_solo_periodos_ofrecidos.sql', import.meta.url), 'utf8');
const endurecimiento = await readFile(new URL('../supabase/migrations/20261001000100_endurecimiento.sql', import.meta.url), 'utf8');
const adminUi = await readFile(new URL('../app/administracion/suscripciones/panel.js', import.meta.url), 'utf8');
const landing = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const docsMvp = await readFile(new URL('../docs/MVP-CUENTAS-SUSCRIPCIONES.md', import.meta.url), 'utf8');
const docsPrecios = await readFile(new URL('../docs/copy-calculadora-y-precios.md', import.meta.url), 'utf8');

test('suscripción ofrece solo periodos semestrales y anuales', () => {
  assert.match(api, /!\['semestral', 'anual'\]\.includes\(periodo\)/);
  assert.match(ui, /option value="semestral">Semestral/);
  assert.match(ui, /option value="anual">Anual/);
  assert.doesNotMatch(ui, /option value="mensual"/);
  assert.doesNotMatch(ui, /periodicidad === 'mensual'/);
});

test('una renovación cancelada antes de iniciar no se presenta como acceso vigente', () => {
  const ahora = Date.parse('2026-10-03T12:00:00.000Z');
  const renovacionCancelada = {
    estado: 'cancelada',
    inicia_en: '2027-04-03T00:00:00.000Z',
    termina_en: '2028-04-03T00:00:00.000Z',
  };
  assert.equal(etiquetaEstadoSuscripcion(renovacionCancelada, ahora), 'Renovación cancelada antes de iniciar');
  assert.equal(fechaFinSuscripcion(renovacionCancelada, ahora), null);
  assert.equal(fechaFinSuscripcion({ estado: 'cancelacion_programada', termina_en: '2027-04-03T00:00:00.000Z' }, ahora), 'Acceso hasta');
  assert.equal(fechaFinSuscripcion({ estado: 'vencida', termina_en: '2026-09-03T00:00:00.000Z' }, ahora), 'Periodo contratado hasta');
});

test('Enterprise aplica mínimo de tres plantas en UI, API y RPC SQL', () => {
  assert.match(api, /Number\.isSafeInteger\(parsed\)[\s\S]*?parsed < 3 \|\| parsed > 100/);
  assert.match(api, /Enterprise requiere indicar entre 3 y 100 plantas/);
  assert.doesNotMatch(api, /Math\.max\(3, Math\.min\(100/);
  assert.match(ui, /min=\{Math\.max\(3, datos\.plantas_activas \|\| 0\)\}/);
  assert.match(sql, /if p_plan_codigo='enterprise' and p_plantas<3 then/);
});

test('la API no sustituye silenciosamente una cantidad Enterprise inválida', () => {
  for (const valor of [undefined, null, '', 0, -1, 2, 2.5, 101, 'abc']) {
    assert.equal(validarCantidadPlantasEnterprise(valor), null, `debe rechazar ${String(valor)}`);
  }
  assert.equal(validarCantidadPlantasEnterprise(3), 3);
  assert.equal(validarCantidadPlantasEnterprise('12'), 12);
  assert.equal(validarCantidadPlantasEnterprise(100), 100);
});

test('la cotización Enterprise conoce los sitios activos y preselecciona el contrato actual', () => {
  assert.match(api, /from\('plantas'\)\.select\('id', \{ count: 'exact', head: true \}\)\.eq\('organizacion_id', organizacionId\)\.eq\('activa', true\)/);
  assert.match(api, /plantas_activas: plantasActivas\.count \|\| 0/);
  assert.match(ui, /inicializoFormulario\.current/);
  assert.match(ui, /setPlan\(referencia\.plan_codigo\)/);
  assert.match(ui, /setPeriodicidad\(referencia\.periodicidad\)/);
  assert.match(ui, /Math\.max\(3, datos\.plantas_activas \|\| 0, Number\(e\.target\.value\) \|\| 3\)/);
  assert.match(ui, /La cotización debe cubrir tus \{datos\.plantas_activas \|\| 0\} plantas activas/);
});

test('suscripción distingue carga, falta de permiso y error; nunca confunde una consulta fallida con una cuenta sin plan', () => {
  assert.match(ui, /estadoCarga === 'cargando'[\s\S]*?Consultando tu cuenta/);
  assert.match(ui, /estadoCarga === 'denegado'[\s\S]*?Acceso restringido[\s\S]*?estadoCarga === 'error'[\s\S]*?No pudimos consultar tu cuenta/);
  assert.match(ui, /estadoCarga === 'listo' \? <div className="billing-panels">[\s\S]*?Aún no tienes una suscripción/);
  assert.match(ui, /error\.status === 403 \? 'denegado' : 'error'/);
  assert.match(ui, /location\.replace\('\/acceso\?returnTo=%2Fsuscripcion'\)/);
});

test('suscripción rechaza respuestas 200 incompletas antes de habilitar formularios y pagos', () => {
  assert.match(ui, /cuerpo\.ok !== true \|\| !Array\.isArray\(cuerpo\.planes\) \|\| !Array\.isArray\(cuerpo\.suscripciones\)/);
  assert.match(ui, /!Array\.isArray\(cuerpo\.pagos\) \|\| typeof cuerpo\.puede_editar !== 'boolean'/);
  assert.match(ui, /Recibimos información incompleta de tu cuenta/);
  assert.match(ui, /setEstadoCarga\(error\.status === 403 \? 'denegado' : 'error'\)/);
  assert.match(ui, /estadoCarga === 'listo' \? <div className="billing-panels">/);
});

test('las RPC de suscripción rechazan parámetros nulos explícitamente', () => {
  assert.match(sql, /p_periodicidad is null[\s\S]*?p_plantas is null/);
  assert.match(sql, /p_accion is null or p_accion not in \('activar','piloto','rechazar'\)/);
  assert.match(renovacion, /p_periodicidad is null[\s\S]*?p_plantas is null/);
  assert.match(renovacion, /p_accion is null or p_accion not in \('activar','piloto','rechazar'\)/);
});

test('las RPC finales de solicitud y renovación solo admiten semestres y años', () => {
  assert.match(periodosOfrecidos, /create or replace function public\.organizacion_solicitar_plan[\s\S]*?p_periodicidad is null or p_periodicidad not in \('semestral', 'anual'\)/);
  assert.match(periodosOfrecidos, /create or replace function public\.organizacion_renovar_plan[\s\S]*?p_periodicidad is null or p_periodicidad not in \('semestral','anual'\)/);
  assert.doesNotMatch(periodosOfrecidos, /when 'mensual'/);
});

test('la migración bloquea nuevas suscripciones mensuales sin alterar registros históricos', async () => {
  const migracion = await readFile(new URL('../supabase/migrations/20261002000300_periodos_semianual_anual.sql', import.meta.url), 'utf8');
  assert.match(migracion, /before insert or update of periodicidad on public\.organizacion_suscripciones/i);
  assert.match(migracion, /new\.periodicidad not in \('semestral', 'anual'\)/i);
  assert.match(api, /!\['semestral', 'anual'\]\.includes\(periodo\)/);
});

test('la landing y documentación no presentan periodicidad mensual como plan disponible', () => {
  assert.doesNotMatch(landing, /suscripci[oó]n mensual cancelable|los mensuales, en cualquier momento/i);
  assert.match(landing, /No ofrecemos planes mensuales/);
  assert.match(docsMvp, /periodicidades contratables son semestral y anual/);
  assert.doesNotMatch(docsMvp, /Catálogo mensual\/semestral\/anual|planes mensuales se cancelan/i);
  assert.doesNotMatch(docsPrecios, /planes mensuales se cancelan/i);
});

test('renovar vigente usa un RPC separado, serializado, y crea solo pago pendiente', () => {
  assert.match(api, /'solicitar', 'renovar'/);
  assert.match(api, /'organizacion_renovar_plan'/);
  assert.match(renovacion, /pg_advisory_xact_lock\(hashtextextended\(p_organizacion_id::text, 0\)\)/);
  assert.match(renovacion, /p_suscripcion_actual_id[\s\S]*?for update/);
  assert.match(renovacion, /x\.id<>s\.id and x\.estado in \('solicitada','pendiente_pago','piloto'\)/);
  assert.match(renovacion, /values\(v_nueva\.id,'pendiente'/);
  assert.doesNotMatch(renovacion, /insert into public\.organizacion_pagos[^;]*'verificado'/);
  assert.match(renovacion, /pago_manual',true/);
  assert.match(renovacion, /where estado in \('solicitada','pendiente_pago'\) and not periodo_programado;/);
  assert.match(renovacion, /where estado='piloto' and not periodo_programado;/);
});

test('UI permite elegir el plan/periodo de renovación y comunica que no hay cobro automático', () => {
  assert.match(ui, /suscripcionVigente/);
  assert.match(ui, /No se hará ningún cargo automático/);
  assert.match(ui, /suscripcion_actual_id: renovar \? suscripcionVigente\.id/);
  assert.match(ui, /Elige el plan y periodo del siguiente ciclo/);
  assert.match(ui, /periodo_programado/);
  assert.match(ui, /inicio_programado_en/);
  assert.match(ui, /haySolicitudPendiente = datos\.suscripciones\.some\(\(s\) => \['solicitada', 'pendiente_pago'\]\.includes\(s\.estado\)\)/);
  assert.doesNotMatch(ui, /\['solicitada', 'pendiente_pago', 'piloto'\]\.includes\(s\.estado\)/);
  assert.match(renovacion, /inicio_programado_en=v_inicio/);
  assert.match(adminUi, /Confirmar pago y programar renovación/);
  assert.match(adminUi, /El periodo iniciará al terminar el vigente/);
});

test('el panel de administración no ofrece rechazar una renovación como si fuera una solicitud nueva', () => {
  assert.match(adminUi, /renovacion && pendiente \? <p>Esta renovación no se rechaza como una solicitud nueva/);
  assert.match(adminUi, /!renovacion \? <button className="btn btn--secondary" disabled=\{ocupada\} onClick=\{\(\) => resolver\(s\.id, 'rechazar'\)\}>Rechazar solicitud/);
  assert.match(adminUi, /pago\?\.estado === 'comprobante_recibido'[\s\S]*?resolver\(s\.id, 'rechazar_comprobante'\)/);
});

test('al verificar una renovación se programa después del plan vigente sin doble vigencia', () => {
  assert.match(renovacion, /greatest\(v_inicio, termina_en\)/);
  assert.match(renovacion, /estado='activa',inicia_en=v_inicio,termina_en=v_fin/);
  assert.match(renovacion, /exclude using gist[\s\S]*?tstzrange\(inicia_en, termina_en, '\[\)'\)/);
  assert.match(renovacion, /renovacion_programada',s\.periodo_programado/);
  assert.match(renovacion, /renovacion_programada_cancelada/);
  assert.match(renovacion, /reembolso_manual/);
  assert.match(ui, /Próximo periodo confirmado/);
});

test('el perfil heredado no conserva una política REST basada en membresía obsoleta', () => {
  assert.match(endurecimiento, /drop policy if exists "usuario lee su perfil" on public\.planta_perfiles/i);
});

test('la renovación futura puede cancelarse explícitamente y explica reembolso manual', () => {
  assert.match(ui, /Cancelar próximo periodo/);
  assert.match(ui, /cancelar\(renovacionProgramada\.id, true\)/);
  assert.match(ui, /no genera una devolución automática/);
});

test('la sección fiscal aclara que guardar datos no genera CFDI', () => {
  assert.match(ui, /No emitimos CFDI desde esta pantalla/);
});

test('otorgar piloto anula el pago pendiente asociado', () => {
  assert.match(sql, /Pago anulado al conceder piloto/);
  assert.match(sql, /update public\.organizacion_pagos set estado='anulado'[\s\S]*?where suscripcion_id=s\.id and estado in \('pendiente','comprobante_recibido'\)/);
});

test('confirmar renovación no la encadena sobre otra renovación futura', () => {
  assert.match(endurecimiento, /Ya existe un próximo periodo contratado/);
  assert.match(endurecimiento, /inicia_en is null or inicia_en<=v_inicio/);
  assert.match(api, /error\.code === '23505'[\s\S]*?error: error\.message/);
});

test('los formularios de suscripción y facturación muestran un estado recuperable si falla la conexión', () => {
  for (const inicio of ['async function solicitar(evento)', 'async function cancelar(', 'async function guardarFiscal(evento)']) {
    const desde = ui.indexOf(inicio);
    assert.notEqual(desde, -1, `se encuentra el manejador ${inicio}`);
    const siguiente = ui.indexOf('\n  async function ', desde + inicio.length);
    const bloque = ui.slice(desde, siguiente < 0 ? ui.length : siguiente);
    assert.match(bloque, /catch \{/);
    assert.match(bloque, /No pudimos confirmar[\s\S]*?Recarga esta pantalla/);
    assert.match(bloque, /respuesta\.json\(\)\.catch\(\(\) => \(\{\}\)\)/);
  }
});

test('el panel interno protege las decisiones de pago de dobles envíos y errores de red', () => {
  assert.match(adminUi, /const \[ocupada, setOcupada\] = useState\(false\)/);
  assert.match(adminUi, /if \(ocupada \|\| !window\.confirm\(advertencia\)\) return/);
  assert.match(adminUi, /finally\s*\{\s*setOcupada\(false\)/);
  assert.match(adminUi, /respuesta\.json\(\)\.catch\(\(\) => \(\{\}\)\)/);
  assert.match(adminUi, /No pudimos confirmar ni actualizar el estado\. Recarga esta página antes de volver a procesar la solicitud/);
  assert.match(adminUi, /await cargar\(\);\s*setEstado\(confirmacion\)/);
  assert.match(adminUi, /disabled=\{ocupada\}/);
});
