/* ==========================================================================
   DowntimeCO — Sesión simulada y separación de vistas por rol
   --------------------------------------------------------------------------
   ⚠️ ESTO NO ES AUTENTICACIÓN. Es una maqueta de demostración: las tres
   cuentas y su contraseña están escritas en este archivo, que el navegador
   descarga en claro, y el "candado" entre roles es una redirección de
   JavaScript. Cualquiera puede saltárselo con las herramientas de desarrollo.

   Sirve para enseñar CÓMO se comporta el producto con RBAC, no para proteger
   nada. El blindaje real del producto vive en las políticas de Row Level
   Security de Postgres, donde el servidor —y no el navegador— decide qué
   columnas puede leer cada rol. Cuando esta demo se convierta en producto,
   este archivo se reemplaza por Supabase Auth; no se "endurece".
   ========================================================================== */
(function (global) {
  "use strict";

  var LS_SESION = "downtimeco_demo_sesion";
  var CLAVE_DEMO = "demo1234";

  /* Permisos por rol. Cada vista PREGUNTA por el permiso en vez de asumirlo,
     así que mover una capacidad de un rol a otro es una línea aquí. */
  var CUENTAS = [
    {
      email: "ceo@downtimeco.com",
      rol: "direccion",
      // Las iniciales son explícitas, no derivadas del nombre: la pantalla de
      // acceso muestra SOLO la inicial y el nombre completo aparece ya dentro.
      iniciales: "AH",
      nombre: "Alex Huerta",
      puesto: "Dirección General y Finanzas",
      inicio: "direccion.html",
      permisos: { verMontos: true, verTarifas: true, exportar: true, registrarParo: false }
    },
    {
      email: "gerente@downtimeco.com",
      rol: "operaciones",
      iniciales: "AG",
      nombre: "Alondra González",
      puesto: "Gerencia de Operaciones y Mantenimiento",
      inicio: "operaciones.html",
      permisos: { verMontos: true, verTarifas: false, exportar: false, registrarParo: true }
    },
    {
      email: "operador@downtimeco.com",
      rol: "operador",
      iniciales: "EH",
      nombre: "Helio Emmanuel Huerta",
      puesto: "Operador de Piso",
      inicio: "operador.html",
      permisos: { verMontos: false, verTarifas: false, exportar: false, registrarParo: true }
    }
  ];

  function cuentaPorEmail(email) {
    var buscado = String(email || "").trim().toLowerCase();
    for (var i = 0; i < CUENTAS.length; i++) if (CUENTAS[i].email === buscado) return CUENTAS[i];
    return null;
  }

  function cuentaPorRol(rol) {
    for (var i = 0; i < CUENTAS.length; i++) if (CUENTAS[i].rol === rol) return CUENTAS[i];
    return null;
  }

  function actual() {
    try {
      var crudo = global.localStorage.getItem(LS_SESION);
      if (!crudo) return null;
      var s = JSON.parse(crudo);
      return cuentaPorEmail(s.email);
    } catch (e) {
      return null;
    }
  }

  /** Devuelve la cuenta si las credenciales coinciden, o null. */
  function entrar(email, clave) {
    var cuenta = cuentaPorEmail(email);
    if (!cuenta || String(clave) !== CLAVE_DEMO) return null;
    try {
      global.localStorage.setItem(LS_SESION, JSON.stringify({ email: cuenta.email, desde: new Date().toISOString() }));
    } catch (e) { /* sin almacenamiento la sesión no sobrevive al salto de página */ }
    return cuenta;
  }

  function salir() {
    try { global.localStorage.removeItem(LS_SESION); } catch (e) { /* nada */ }
    global.location.href = "index.html";
  }

  function puede(permiso) {
    var cuenta = actual();
    return !!(cuenta && cuenta.permisos[permiso]);
  }

  /**
   * Guarda de página. Sin sesión manda al acceso; con el rol equivocado manda
   * a la pantalla propia marcando el bloqueo, que es justo lo que hay que
   * enseñar: el operador no puede abrir el tablero financiero ni escribiendo
   * la URL a mano.
   */
  function exigir(rolRequerido) {
    var cuenta = actual();
    if (!cuenta) {
      global.location.replace("index.html?destino=" + encodeURIComponent(rolRequerido));
      return null;
    }
    if (cuenta.rol !== rolRequerido) {
      global.location.replace(cuenta.inicio + "?bloqueado=" + encodeURIComponent(rolRequerido));
      return null;
    }
    return cuenta;
  }

  var NOMBRE_VISTA = {
    direccion: "Dirección y Finanzas",
    operaciones: "Operaciones y Mantenimiento",
    operador: "Operador de Piso"
  };

  /** Cabecera común de las tres vistas. */
  function pintarBarra(cuenta) {
    var barra = document.getElementById("appBar");
    if (!barra) return;

    barra.innerHTML =
      '<a class="app__brand" href="../index.html" title="Volver a la landing de DowntimeOS">' +
        '<svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">' +
          '<rect width="32" height="32" rx="7" fill="#FFB627"></rect>' +
          '<path d="M4 18h5l3-8 4 14 3-9 2 3h7" fill="none" stroke="#06080B" stroke-width="2.4" ' +
                'stroke-linecap="round" stroke-linejoin="round"></path>' +
        '</svg>' +
        'Downtime<span class="hl">OS</span>' +
      '</a>' +
      '<span class="app__planta mono" id="appContexto">DowntimeCO</span>' +
      '<span class="app__sim mono" title="Los datos de esta pantalla son simulados">Demo · Datos simulados</span>' +
      '<div class="app__user">' +
        '<div class="app__user-txt">' +
          '<b>' + cuenta.nombre + '</b>' +
          '<span class="mono">' + NOMBRE_VISTA[cuenta.rol] + '</span>' +
        '</div>' +
        '<span class="app__avatar mono" aria-hidden="true">' + cuenta.iniciales + '</span>' +
        '<button type="button" class="app__salir" id="btnSalir">Salir</button>' +
      '</div>';

    document.getElementById("btnSalir").addEventListener("click", salir);
  }

  /**
   * Si la página se abrió por un intento de entrar donde no corresponde,
   * lo explica en pantalla en vez de fallar en silencio.
   */
  function avisarBloqueo(cuenta) {
    var caja = document.getElementById("avisoBloqueo");
    if (!caja) return;
    var intento = new URLSearchParams(global.location.search).get("bloqueado");
    if (!intento) return;

    caja.innerHTML =
      '<b>Acceso denegado a la vista de ' + (NOMBRE_VISTA[intento] || intento) + '.</b> ' +
      'Tu sesión es <b class="mono">' + cuenta.email + '</b> (' + NOMBRE_VISTA[cuenta.rol] + '), ' +
      'así que el sistema te devolvió a tu pantalla. En el producto esta separación la ' +
      'resuelve el servidor con segregación lógica de datos, no el navegador.';
    caja.hidden = false;
  }

  /** Contexto de la barra superior (p. ej. la línea activa del operador). */
  function contexto(texto) {
    var el = document.getElementById("appContexto");
    if (el) el.textContent = texto;
  }

  /** Arranque común: valida el rol, pinta la barra y avisa bloqueos. */
  function iniciarVista(rolRequerido) {
    var cuenta = exigir(rolRequerido);
    if (!cuenta) return null;
    pintarBarra(cuenta);
    avisarBloqueo(cuenta);
    return cuenta;
  }

  global.Sesion = {
    CUENTAS: CUENTAS,
    CLAVE_DEMO: CLAVE_DEMO,
    NOMBRE_VISTA: NOMBRE_VISTA,
    actual: actual,
    cuentaPorRol: cuentaPorRol,
    entrar: entrar,
    salir: salir,
    puede: puede,
    exigir: exigir,
    contexto: contexto,
    iniciarVista: iniciarVista
  };
})(window);
