import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const tableros = [
  ["Dirección", "public/demo/js/direccion.js", "actualizarPollingDireccion", "sincronizarDireccion"],
  ["Operaciones", "public/demo/js/operaciones.js", "actualizarPollingPiso", "sincronizarPiso"],
  ["Operador", "public/demo/js/operador.js", "actualizarPollingPiso", "sincronizarPiso"]
];

for (const [nombre, ruta, controlador, sincronizar] of tableros) {
  test(`${nombre}: pausa el polling oculto y conserva el ciclo visible de 5 s`, async () => {
    const fuente = await readFile(new URL(`../${ruta}`, import.meta.url), "utf8");
    assert.match(fuente, /document\.addEventListener\("visibilitychange",\s*actualizarPolling/);
    assert.match(fuente, new RegExp(`function ${controlador}\\(\\)[\\s\\S]*?document\\.visibilityState === "hidden"[\\s\\S]*?clearInterval\\([^)]+\\)[\\s\\S]*?return;`));
    assert.match(fuente, new RegExp(`function ${controlador}\\(\\)[\\s\\S]*?${sincronizar}\\(\\)[\\s\\S]*?setInterval\\(${sincronizar}, 5000\\)`));
    assert.match(fuente, /intervalo(?:Direccion|Piso) === null/);
  });

  test(`${nombre}: el ciclo visible sincroniza solo el estado vivo, conserva carga inicial`, async () => {
    const fuente = await readFile(new URL(`../${ruta}`, import.meta.url), "utf8");
    assert.match(fuente, /D\.cargar\(\)\.then\(function \(\)/, "la carga inicial sigue siendo completa");
    assert.match(fuente, new RegExp(`function ${sincronizar}\\(\\)[\\s\\S]*?D\\.sincronizarVivo\\(\\)`));
    assert.doesNotMatch(fuente, new RegExp(`function ${sincronizar}\\(\\)[\\s\\S]*?D\\.cargar\\(\\)`));
  });
}

test("la sincronización viva valida y aplica estados/solicitudes sin reemplazar eventos", async () => {
  const fuente = await readFile(new URL("../public/demo/js/datos.js", import.meta.url), "utf8");
  const metodo = fuente.match(/function sincronizarVivo\(\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(metodo, "existe el método de actualización ligera");
  assert.match(metodo, /API \+ "\/estado-vivo"/);
  assert.match(metodo, /nube\.estados = estados/);
  assert.match(metodo, /nube\.solicitudes = Array\.from\(porFolio\.values\(\)\)/);
  assert.doesNotMatch(metodo, /nube\.eventos\s*=/, "el historial de eventos no se modifica en el sondeo");
});

test("el endpoint estado-vivo solo devuelve estados y solicitudes abiertas, nunca eventos", async () => {
  const api = await readFile(new URL("../api/planta/estado-vivo.js", import.meta.url), "utf8");
  const planta = await readFile(new URL("../lib/planta.js", import.meta.url), "utf8");
  const registro = await readFile(new URL("../src/server/api-registry.js", import.meta.url), "utf8");
  assert.match(api, /sesionDesdeEncabezado/);
  assert.match(api, /estadoVivoPlanta\(\{ plantaId: sesion\.perfil\.planta_id \}\)/);
  assert.doesNotMatch(api, /estadoPlanta|eventos/);
  const metodo = planta.match(/export async function estadoVivoPlanta\([\s\S]*?\n\}/)?.[0];
  assert.ok(metodo);
  assert.match(metodo, /planta_estados/);
  assert.match(metodo, /planta_solicitudes/);
  assert.match(metodo, /eq\('cerrada', false\)\.eq\('estado', 'pendiente'\)/);
  assert.doesNotMatch(metodo, /planta_eventos|planta_bitacora|eventos/);
  assert.doesNotMatch(metodo, /tarifa|costo|coste|impacto|importe|monto|precio/i);
  assert.match(api, /if \(sesion\.perfil\.rol === 'operaciones'\)/);
  assert.match(api, /datosVisiblesPorRol\(vivo, sesion\.perfil\)/);
  assert.doesNotMatch(api, /planta_bitacora|planta_eventos/);
  const impacto = planta.match(/export async function impactoActualEstados\([\s\S]*?\n\}/)?.[0];
  assert.ok(impacto);
  assert.match(impacto, /select\('id,linea_id,etapa,tarifa_hora'\)/);
  assert.match(registro, /'planta\/estado-vivo':\s*\(\) => import\('\.\.\/\.\.\/api\/planta\/estado-vivo\.js'\)/);
});
