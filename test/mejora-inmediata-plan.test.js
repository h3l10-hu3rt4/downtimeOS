import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { etiquetaEstadoSuscripcion, fechaFinSuscripcion } from '../lib/etiquetas-suscripcion.js';

const leer = async (ruta) => (await readFile(new URL(ruta, import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const sql = await leer('../supabase/migrations/20261006000100_mejora_inmediata_plan.sql');
const api = await leer('../api/planta/suscripcion.js');
const apiAdmin = await leer('../api/administracion/suscripciones.js');
const ui = await leer('../app/suscripcion/page.js');
const adminUi = await leer('../app/administracion/suscripciones/panel.js');
const planes = await leer('../lib/planes.js');

const mejorar = sql.slice(sql.indexOf('function public.organizacion_mejorar_plan'), sql.indexOf('function public.organizacion_admin_resolver_solicitud'));
const resolver = sql.slice(sql.indexOf('function public.organizacion_admin_resolver_solicitud'));

test('HIST-15: la mejora solo aplica a un plan pagado vigente y a un plan superior', () => {
  assert.match(mejorar, /s\.estado not in \('activa','cancelacion_programada'\)[\s\S]*?Solo puedes mejorar un plan pagado que esté vigente/);
  assert.match(mejorar, /v_plan\.precio_semestral_usd<=v_plan_actual\.precio_semestral_usd[\s\S]*?solo aplica a un plan superior al vigente/);
  assert.match(mejorar, /propietario_id=p_usuario_id[\s\S]*?puede_administrar_facturacion[\s\S]*?errcode='42501'/);
  assert.match(mejorar, /x\.estado in \('solicitada','pendiente_pago'\)\) then\s+raise exception 'Ya existe una solicitud pendiente/);
  assert.match(mejorar, /x\.inicia_en>now\(\) and x\.termina_en>now\(\)\) then\s+raise exception 'Ya hay un próximo periodo contratado/);
});

test('HIST-15: la mejora cobra el periodo completo, sin prorrateo, y queda auditada', () => {
  assert.match(mejorar, /v_importe := \(case p_periodicidad when 'anual' then v_plan\.precio_anual_usd\s+else v_plan\.precio_semestral_usd end\)\*p_plantas;/);
  assert.doesNotMatch(mejorar, /v_importe\s*:=[^;]*termina_en/);
  assert.match(mejorar, /'solicitada',p_periodicidad,p_plantas,[\s\S]*?p_usuario_id,s\.id\)/);
  assert.match(mejorar, /'mejora_plan_solicitada'[\s\S]*?'prorrateo',false/);
  assert.match(sql, /revoke all on function public\.organizacion_mejorar_plan\(uuid,uuid,uuid,text,text,integer,text\) from public,anon,authenticated;/);
  assert.match(sql, /grant execute on function public\.organizacion_mejorar_plan\(uuid,uuid,uuid,text,text,integer,text\) to service_role;/);
});

test('HIST-15: al verificar el pago, el plan vigente queda reemplazado y el nuevo inicia de inmediato', () => {
  assert.match(sql, /check \(estado in \([^)]*'reemplazada'\)\)/);
  // El plan anterior se cierra antes de activar el nuevo: la exclusión no admite traslapes.
  const cierre = resolver.indexOf("set estado='reemplazada',termina_en=v_inicio");
  const activacion = resolver.indexOf("set estado='activa',inicia_en=v_inicio");
  assert.ok(cierre > 0 && activacion > cierre);
  assert.match(resolver, /v_mejora and p_accion='piloto' then\s+raise exception 'Una mejora de plan solo puede activarse tras verificar el pago/);
  assert.match(resolver, /Hay un próximo periodo contratado que se traslaparía con la mejora/);
  assert.match(resolver, /'mejora_pago_verificado_plan_reemplazado'/);
  assert.match(resolver, /'termina_en_original',v_anterior\.termina_en/);
  assert.match(resolver, /'mejora_inmediata',v_mejora and p_accion='activar'/);
  // Las renovaciones conservan su comportamiento: se programan al terminar el periodo vigente.
  assert.match(resolver, /if s\.periodo_programado then[\s\S]*?select greatest\(v_inicio,termina_en\) into v_inicio/);
});

test('HIST-15: la API del titular expone la acción mejorar y el servidor decide el importe', () => {
  assert.match(api, /\['solicitar', 'renovar', 'mejorar'\]\.includes\(cuerpo\.accion\)/);
  assert.match(api, /mejorar \? 'organizacion_mejorar_plan' : renovar \? 'organizacion_renovar_plan' : 'organizacion_solicitar_plan'/);
  assert.match(api, /sin prorrateo; al validar el pago reemplazará de inmediato a tu plan actual/);
  assert.equal(api.match(/mejora_de_suscripcion_id,plantas_incluidas/g)?.length, 2);
  assert.doesNotMatch(api, /cuerpo\.importe/);
  assert.match(apiAdmin, /periodo_programado,mejora_de_suscripcion_id,/);
  assert.match(apiAdmin, /data\?\.mejora_inmediata \? 'Pago verificado\. El plan nuevo quedó activo y reemplazó de inmediato al plan anterior\.'/);
});

test('HIST-15: la pantalla del titular ofrece la mejora inmediata y explica que no hay prorrateo', () => {
  assert.match(ui, /const esMejora = Boolean\(suscripcionVigente && \['activa', 'cancelacion_programada'\]\.includes\(suscripcionVigente\.estado\)/);
  assert.match(ui, /Number\(seleccion\.precio_semestral_usd\) > Number\(planVigente\.precio_semestral_usd\)/);
  assert.match(ui, /accion: esMejora \? 'mejorar' : renovar \? 'renovar' : 'solicitar'/);
  assert.match(ui, /Mejorar plan ahora/);
  assert.match(ui, /reemplazará de inmediato a tu plan actual; no hay que esperar al vencimiento/);
  assert.match(ui, /sin prorrateo: el tiempo restante del plan actual no se acredita ni se reembolsa/);
  assert.match(ui, /Solicitar mejora inmediata/);
  assert.match(ui, /Mejora de plan pendiente/);
});

test('HIST-15: el panel admin identifica la mejora y no permite convertirla en piloto', () => {
  assert.match(adminUi, /const mejora = Boolean\(s\.mejora_de_suscripcion_id\);/);
  assert.match(adminUi, /mejora inmediata · pago pendiente/);
  assert.match(adminUi, /Confirmar pago y reemplazar el plan vigente/);
  assert.match(adminUi, /!renovacion && !mejora \? <button[\s\S]{0,80}resolver\(s\.id, 'piloto'\)/);
});

test('HIST-15: un plan reemplazado se etiqueta como tal, no da acceso y conserva la exportación', () => {
  const reemplazada = { estado: 'reemplazada', inicia_en: '2026-10-01T00:00:00.000Z', termina_en: '2026-10-06T00:00:00.000Z' };
  const ahora = Date.parse('2026-10-06T12:00:00.000Z');
  assert.equal(etiquetaEstadoSuscripcion(reemplazada, ahora), 'Reemplazada por mejora de plan');
  assert.equal(fechaFinSuscripcion(reemplazada, ahora), null);
  assert.match(planes, /\.in\('estado', \['piloto', 'activa', 'cancelacion_programada'\]\)/);
  assert.match(planes, /'vencida', 'cancelada', 'reemplazada'\]/);
});
