import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const fuente = await readFile(new URL("../public/demo/js/datos.js", import.meta.url), "utf8");

function crearEntorno(sesionInicial, fetchMock) {
  const valores = new Map([["downtimeos_sesion", JSON.stringify(sesionInicial)]]);
  const localStorage = {
    getItem: (clave) => valores.has(clave) ? valores.get(clave) : null,
    setItem: (clave, valor) => valores.set(clave, String(valor)),
    removeItem: (clave) => valores.delete(clave)
  };
  const window = {
    localStorage,
    fetch: fetchMock,
    location: { pathname: "/direccion", replace() {} },
    console
  };
  vm.runInNewContext(fuente, { window, console }, { filename: "public/demo/js/datos.js" });
  return {
    window,
    getSesion: () => JSON.parse(localStorage.getItem("downtimeos_sesion")),
    setSesion: (sesion) => localStorage.setItem("downtimeos_sesion", JSON.stringify(sesion))
  };
}

function respuesta(status, body = {}) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

function diferida() {
  let resolve;
  const promise = new Promise((aceptar) => { resolve = aceptar; });
  return { promise, resolve };
}

function sesion(id, access, refresh, planta = "planta-a") {
  return {
    user: { id }, access_token: access, refresh_token: refresh,
    perfil: { user_id: id, planta_id: planta }, planta_id: planta,
    plantas_disponibles: [{ id: planta }]
  };
}

const peticion = (token, planta = "planta-a") => ({
  method: "PATCH",
  headers: { Authorization: `Bearer ${token}`, "X-DowntimeOS-Planta": planta },
  body: "{\"estado\":\"RUN\"}"
});

test("el adaptador legacy no reintenta la mutación de A usando la sesión B", async () => {
  const refresh = diferida();
  const llamadas = [];
  const entorno = crearEntorno(sesion("user-a", "access-a", "refresh-a"), async (url, opciones) => {
    llamadas.push({ url, opciones });
    if (url === "/api/cuenta") return refresh.promise;
    return respuesta(401);
  });

  const mutacion = entorno.window.fetch("/api/planta/eventos", peticion("access-a"));
  await new Promise((resolve) => setImmediate(resolve));
  entorno.setSesion(sesion("user-b", "access-b", "refresh-b", "planta-b"));
  refresh.resolve(respuesta(200, {
    access_token: "renewed-a", refresh_token: "renewed-refresh-a",
    perfil: { user_id: "user-a", planta_id: "planta-a" }
  }));

  const result = await mutacion;
  assert.equal(result.status, 401);
  assert.equal(llamadas.filter((call) => call.url === "/api/planta/eventos").length, 1);
  assert.equal(entorno.getSesion().access_token, "access-b");
});

test("cuentas distintas no comparten renovación en el fetch legacy", async () => {
  const refreshA = diferida();
  const refreshB = diferida();
  const intentos = new Map();
  const entorno = crearEntorno(sesion("user-a", "access-a", "refresh-a"), async (url, opciones) => {
    if (url === "/api/cuenta") {
      const token = JSON.parse(opciones.body).refresh_token;
      return token === "refresh-a" ? refreshA.promise : refreshB.promise;
    }
    const auth = opciones.headers.Authorization;
    const esB = auth.includes("access-b") || auth.includes("renewed-b");
    const cuenta = esB ? "b" : "a";
    const total = (intentos.get(cuenta) || 0) + 1;
    intentos.set(cuenta, total);
    return respuesta(esB && auth === "Bearer renewed-b" ? 200 : 401);
  });

  const mutacionA = entorno.window.fetch("/api/planta/eventos", peticion("access-a"));
  await new Promise((resolve) => setImmediate(resolve));
  entorno.setSesion(sesion("user-b", "access-b", "refresh-b", "planta-b"));
  const mutacionB = entorno.window.fetch("/api/planta/eventos", peticion("access-b", "planta-b"));
  await new Promise((resolve) => setImmediate(resolve));

  refreshB.resolve(respuesta(200, {
    access_token: "renewed-b", refresh_token: "renewed-refresh-b",
    perfil: { user_id: "user-b", planta_id: "planta-b" }
  }));
  assert.equal((await mutacionB).status, 200);

  refreshA.resolve(respuesta(200, {
    access_token: "renewed-a", refresh_token: "renewed-refresh-a",
    perfil: { user_id: "user-a", planta_id: "planta-a" }
  }));
  assert.equal((await mutacionA).status, 401);
  assert.equal(entorno.getSesion().access_token, "renewed-b");
  assert.equal(intentos.get("a"), 1);
  assert.equal(intentos.get("b"), 2);
});

test("la renovación tardía conserva la planta seleccionada en tableros legacy", async () => {
  const refresh = diferida();
  const entorno = crearEntorno(sesion("user-a", "access-a", "refresh-a", "planta-a"), async (url) => {
    if (url === "/api/cuenta") return refresh.promise;
    return respuesta(401);
  });

  const mutacion = entorno.window.fetch("/api/planta/eventos", peticion("access-a", "planta-a"));
  await new Promise((resolve) => setImmediate(resolve));
  entorno.setSesion(sesion("user-a", "access-a", "refresh-a", "planta-b"));
  refresh.resolve(respuesta(200, {
    access_token: "renewed-a", refresh_token: "renewed-refresh-a",
    perfil: { user_id: "user-a", planta_id: "planta-a" }
  }));

  assert.equal((await mutacion).status, 401);
  assert.equal(entorno.getSesion().access_token, "renewed-a");
  assert.equal(entorno.getSesion().perfil.planta_id, "planta-b");
});
