/* ==========================================================================
   DowntimeCO — Sesión simulada y separación de vistas por rol
   --------------------------------------------------------------------------
   ⚠️ ESTO NO ES AUTENTICACIÓN. Los usuarios y la contraseña viven en
   `usuarios.js`, que el navegador descarga en claro, y el "candado" entre
   roles es una redirección de JavaScript. Cualquiera se lo salta con las
   herramientas de desarrollo.

   Sirve para enseñar CÓMO se comporta el producto con perfiles diferenciados,
   no para proteger nada. Cuando esto pase a producto, este archivo se
   reemplaza por Supabase Auth; no se "endurece".

   Este módulo solo hace tres cosas: guardar quién entró, impedir que una
   sesión abra la vista de otro rol, y pintar la barra superior común.
   ========================================================================== */
(function (global) {
  "use strict";

  var LS_SESION = "downtimeco_demo_sesion";
  var LS_TURNO = "downtimeco_demo_turno";

  /* ====================== TURNO SELECCIONADO (GLOBAL) ===================
     Turnos de 8 horas desde las 06:00. Vive en la barra superior de los TRES
     perfiles y se guarda en un solo lugar, así que cambiarlo en un rol y
     saltar a otro conserva la selección: en una demostración comercial se
     recorre el mismo turno por las tres vistas sin volver a elegirlo.
     ===================================================================== */
  var RANGOS_TURNO = { T1: "06:00–14:00", T2: "14:00–22:00", T3: "22:00–06:00" };
  var oyentesTurno = [];

  function turnoEnCurso() {
    var h = new Date().getHours();
    if (h >= 6 && h < 14) return "T1";
    if (h >= 14 && h < 22) return "T2";
    return "T3";
  }

  /** Turno mostrado: el guardado, o el que corre según el reloj del sistema. */
  function turno() {
    try {
      return global.localStorage.getItem(LS_TURNO) || turnoEnCurso();
    } catch (e) {
      return turnoEnCurso();
    }
  }

  function fijarTurno(valor) {
    try { global.localStorage.setItem(LS_TURNO, valor); } catch (e) { /* nada */ }
    oyentesTurno.forEach(function (fn) { fn(valor); });
  }

  function alCambiarTurno(fn) { oyentesTurno.push(fn); }

  function etiquetaTurno(t) {
    t = t || turno();
    return t === "TODOS" ? "los tres turnos" : "el turno " + t + " (" + RANGOS_TURNO[t] + ")";
  }

  /** Misma etiqueta con la contracción correcta: «del turno T3», no «de el». */
  function etiquetaTurnoDe(t) {
    t = t || turno();
    return t === "TODOS" ? "de los tres turnos" : "del turno " + t + " (" + RANGOS_TURNO[t] + ")";
  }

  function actual() {
    try {
      var crudo = global.localStorage.getItem(LS_SESION);
      if (!crudo) return null;
      return global.Usuarios.porEmail(JSON.parse(crudo).email);
    } catch (e) {
      return null;
    }
  }

  /** Devuelve el usuario si las credenciales coinciden, o null. */
  function entrar(email, clave) {
    var usuario = global.Usuarios.autenticar(email, clave);
    if (!usuario) return null;
    try {
      global.localStorage.setItem(LS_SESION, JSON.stringify({
        email: usuario.email,
        desde: new Date().toISOString()
      }));
    } catch (e) { /* sin almacenamiento la sesión no sobrevive al salto de página */ }
    return usuario;
  }

  function salir() {
    try { global.localStorage.removeItem(LS_SESION); } catch (e) { /* nada */ }
    global.location.href = "index.html";
  }

  function puede(permiso) {
    var usuario = actual();
    return !!(usuario && usuario.permisos[permiso]);
  }

  /**
   * Guarda de página. Sin sesión manda al acceso; con el rol equivocado manda
   * a la pantalla propia marcando el bloqueo, que es justo lo que hay que
   * enseñar: el operador no puede abrir el tablero financiero ni escribiendo
   * la URL a mano.
   */
  function exigir(rolRequerido) {
    var usuario = actual();
    if (!usuario) {
      global.location.replace("index.html?destino=" + encodeURIComponent(rolRequerido));
      return null;
    }
    if (usuario.rol !== rolRequerido) {
      global.location.replace(usuario.inicio + "?bloqueado=" + encodeURIComponent(rolRequerido));
      return null;
    }
    return usuario;
  }

  function etiquetaRol(idRol) {
    var r = global.Usuarios.rol(idRol);
    return r ? r.etiqueta : idRol;
  }

  /** Cabecera común de las tres vistas. */
  function pintarBarra(usuario) {
    var barra = document.getElementById("appBar");
    if (!barra) return;

    barra.innerHTML =
      '<a class="app__brand" href="../index.html" title="Volver a la página principal">' +
        '<svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">' +
          '<rect width="32" height="32" rx="7" fill="#FFB627"></rect>' +
          '<path d="M4 18h5l3-8 4 14 3-9 2 3h7" fill="none" stroke="#06080B" stroke-width="2.4" ' +
                'stroke-linecap="round" stroke-linejoin="round"></path>' +
        '</svg>' +
        '<span class="wordmark">Downtime<span class="hl">CO</span></span>' +
      '</a>' +
      '<span class="app__planta mono" id="appContexto">DowntimeCO</span>' +
      '<span class="app__sim mono" title="Los datos de esta pantalla son simulados">Demo · Datos simulados</span>' +
      '<label class="turno-sel" title="Simulación de turno para demostraciones">' +
        '<span class="mono">Turno</span>' +
        '<select id="selTurno" class="input mono"></select>' +
      '</label>' +
      '<div class="app__user">' +
        '<a class="app__volver" href="../index.html" title="Volver a la página principal de DowntimeOS">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
               'stroke-width="2.2" aria-hidden="true">' +
            '<path d="M19 12H5M11 6l-6 6 6 6" stroke-linecap="round" stroke-linejoin="round"></path>' +
          '</svg>' +
          '<span>Volver a la página principal</span>' +
        '</a>' +
        '<div class="app__user-txt">' +
          '<b>' + usuario.nombre + '</b>' +
          '<span class="mono">' + usuario.etiquetaRol + '</span>' +
        '</div>' +
        '<span class="app__avatar mono" aria-hidden="true">' + usuario.iniciales + '</span>' +
        '<button type="button" class="app__salir" id="btnSalir">Salir</button>' +
      '</div>';

    document.getElementById("btnSalir").addEventListener("click", salir);
    pintarSelectorTurno();
  }

  function pintarSelectorTurno() {
    var sel = document.getElementById("selTurno");
    if (!sel) return;

    var vivo = turnoEnCurso();
    var elegido = turno();

    sel.innerHTML =
      ["T1", "T2", "T3"].map(function (t) {
        return '<option value="' + t + '"' + (t === elegido ? " selected" : "") + ">" +
          t + " · " + RANGOS_TURNO[t] + (t === vivo ? " · en curso" : "") + "</option>";
      }).join("") +
      '<option value="TODOS"' + (elegido === "TODOS" ? " selected" : "") + ">Todos los turnos</option>";

    sel.addEventListener("change", function () { fijarTurno(sel.value); });
  }

  /**
   * Si la página se abrió por un intento de entrar donde no corresponde,
   * lo explica en pantalla en vez de fallar en silencio.
   */
  function avisarBloqueo(usuario) {
    var caja = document.getElementById("avisoBloqueo");
    if (!caja) return;
    var intento = new URLSearchParams(global.location.search).get("bloqueado");
    if (!intento) return;

    caja.innerHTML =
      '<b>Acceso denegado a la vista de ' + etiquetaRol(intento) + '.</b> ' +
      'Tu sesión es <b class="mono">' + usuario.email + '</b> (' + usuario.etiquetaRol + '), ' +
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
    var usuario = exigir(rolRequerido);
    if (!usuario) return null;
    pintarBarra(usuario);
    avisarBloqueo(usuario);
    return usuario;
  }

  global.Sesion = {
    actual: actual,
    entrar: entrar,
    salir: salir,
    puede: puede,
    exigir: exigir,
    etiquetaRol: etiquetaRol,
    RANGOS_TURNO: RANGOS_TURNO,
    turno: turno,
    turnoEnCurso: turnoEnCurso,
    fijarTurno: fijarTurno,
    alCambiarTurno: alCambiarTurno,
    etiquetaTurno: etiquetaTurno,
    etiquetaTurnoDe: etiquetaTurnoDe,
    contexto: contexto,
    iniciarVista: iniciarVista
  };
})(window);
