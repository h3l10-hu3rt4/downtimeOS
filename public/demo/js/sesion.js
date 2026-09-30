/* ==========================================================================
   DowntimeOS — Sesión de producto y separación de vistas por rol
   --------------------------------------------------------------------------
   La autoridad está en Supabase Auth y en los Route Handlers. Este archivo
   solo conserva el token de acceso para enviar el Bearer a las APIs y pinta
   la interfaz correspondiente al perfil que el servidor entregó.
   ========================================================================== */
(function (global) {
  "use strict";

  var LS_PRODUCTO = "downtimeos_sesion";
  var LS_TURNO = "downtimeco_demo_turno";

  /* ====================== TURNO SELECCIONADO (GLOBAL) ===================
     Turnos de 8 horas desde las 06:00. Vive en la barra superior de los TRES
     perfiles y se guarda en un solo lugar, así que cambiarlo en un rol y
     saltar a otro conserva la selección: en una demostración comercial se
     recorre el mismo turno por las tres vistas sin volver a elegirlo.
     ===================================================================== */
  var RANGOS_TURNO = { T1: "06:00–14:00", T2: "14:00–22:00", T3: "22:00–06:00" };
  var oyentesTurno = [];
  var ROLES = {
    direccion: { etiqueta: "Dirección y Finanzas", permisos: { finanzas: true, operaciones: false, captura: false } },
    operaciones: { etiqueta: "Operaciones y Mantenimiento", permisos: { finanzas: false, operaciones: true, captura: true } },
    operador: { etiqueta: "Operador de Piso", permisos: { finanzas: false, operaciones: false, captura: true } }
  };

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
      var producto = global.localStorage.getItem(LS_PRODUCTO);
      if (producto) {
        var sesionProducto = JSON.parse(producto);
        var perfil = sesionProducto.perfil || {};
        var rolProducto = perfil.rol;
        if (ROLES[rolProducto]) {
          var rutas = { direccion: "/direccion", operaciones: "/operaciones", operador: "/operador" };
          var nombre = perfil.nombre || sesionProducto.user?.email || "Usuario";
          return { id: sesionProducto.user?.id || "", email: sesionProducto.user?.email || "", nombre: nombre,
            iniciales: nombre.split(/\s+/).slice(0, 2).map(function (p) { return p[0]; }).join("").toUpperCase(),
            rol: rolProducto, etiquetaRol: ROLES[rolProducto].etiqueta, inicio: rutas[rolProducto],
            permisos: ROLES[rolProducto].permisos, planta: perfil.plantas?.nombre || "Planta" };
        }
      }
    } catch (e) { return null; }
    return null;
  }

  function salir() {
    try { global.localStorage.removeItem(LS_PRODUCTO); } catch (e) { /* nada */ }
    global.fetch("/api/cuenta", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accion: "salir" }) }).catch(function () {});
    global.location.href = "/acceso";
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
      global.location.replace("/acceso?destino=" + encodeURIComponent(rolRequerido));
      return null;
    }
    if (usuario.rol !== rolRequerido) {
      global.location.replace(usuario.inicio + "?bloqueado=" + encodeURIComponent(rolRequerido));
      return null;
    }
    return usuario;
  }

  function etiquetaRol(idRol) {
    var r = ROLES[idRol];
    return r ? r.etiqueta : idRol;
  }

  /** Cabecera común de las tres vistas. */
  function pintarBarra(usuario, opciones) {
    var barra = document.getElementById("appBar");
    if (!barra) return;
    opciones = opciones || {};

    barra.innerHTML =
      '<a class="app__brand" href="/" title="Volver a la página principal">' +
        '<svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">' +
          '<rect width="32" height="32" rx="7" fill="#FFB627"></rect>' +
          '<path d="M4 18h5l3-8 4 14 3-9 2 3h7" fill="none" stroke="#06080B" stroke-width="2.4" ' +
                'stroke-linecap="round" stroke-linejoin="round"></path>' +
        '</svg>' +
        '<span class="wordmark">Downtime<span class="hl">CO</span></span>' +
      '</a>' +
      '<span class="app__planta mono" id="appContexto"></span>' +
      '<span class="app__sim mono" id="appOrigen" title="Datos protegidos de la planta">Cargando datos de planta…</span>' +
      // Dirección trae su propio filtro de rango junto al título, más rico que
      // este selector: tener los dos sería dar dos mandos al mismo dato.
      (opciones.sinSelectorTurno ? "" :
        '<label class="turno-sel" title="Simulación de turno para demostraciones">' +
          '<span class="mono">Turno</span>' +
          '<select id="selTurno" class="input mono"></select>' +
        '</label>') +
      '<div class="app__user">' +
        '<a class="app__volver" href="/" title="Volver a la página principal de DowntimeOS">' +
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

  /**
   * De dónde vienen los datos que se están viendo. Importa decirlo en pantalla:
   * en una demostración a dirección, la diferencia entre "esto se guarda de
   * verdad" y "esto vive en tu navegador" es justo lo que se está enseñando.
   */
  function marcarOrigen(modo) {
    var el = document.getElementById("appOrigen");
    if (!el) return;

    if (modo === "nube") {
      el.textContent = "Supabase · datos de planta";
      el.className = "app__sim app__sim--nube mono";
      el.title = "Persistido en PostgreSQL: solo lo ven los perfiles autorizados de esta planta.";
    } else if (modo === "degradado") {
      el.textContent = "Sin conexión · consulta no disponible";
      el.className = "app__sim app__sim--degradado mono";
      el.title = "Se perdió la conexión con el servidor; no se mostrarán datos locales de otra planta.";
    } else {
      el.textContent = "Sesión requerida";
      el.className = "app__sim mono";
      el.title = "Inicia sesión para consultar los datos de tu planta.";
    }
  }

  /** Contexto de la barra superior (p. ej. la línea activa del operador). */
  function contexto(texto) {
    var el = document.getElementById("appContexto");
    if (el) el.textContent = texto;
  }

  /** Notificación no bloqueante, coherente con la interfaz de DowntimeOS. */
  function notificar(titulo, texto, tono) {
    var pila = document.getElementById("toastStack");
    if (!pila) {
      pila = document.createElement("div");
      pila.id = "toastStack";
      pila.className = "toast-stack";
      pila.setAttribute("aria-live", "polite");
      document.body.appendChild(pila);
    }
    var tipo = ["ok", "error", "warn"].indexOf(tono) >= 0 ? tono : "info";
    var icono = tipo === "ok" ? "✓" : tipo === "error" ? "!" : tipo === "warn" ? "▲" : "i";
    var toast = document.createElement("article");
    toast.className = "toast toast--" + tipo;
    toast.innerHTML = '<span class="toast__icon" aria-hidden="true">' + icono + '</span>' +
      '<div><strong class="toast__title"></strong><span class="toast__text"></span></div>' +
      '<button type="button" class="toast__close" aria-label="Cerrar notificación">×</button>';
    toast.querySelector(".toast__title").textContent = titulo;
    toast.querySelector(".toast__text").textContent = texto || "";
    var cerrar = function () {
      if (!toast.parentNode) return;
      toast.classList.add("toast--sale");
      global.setTimeout(function () { if (toast.parentNode) toast.remove(); }, 180);
    };
    toast.querySelector(".toast__close").addEventListener("click", cerrar);
    pila.appendChild(toast);
    global.setTimeout(cerrar, tipo === "error" ? 8000 : 5000);
  }

  /** Arranque común: valida el rol, pinta la barra y avisa bloqueos. */
  function iniciarVista(rolRequerido, opciones) {
    var usuario = exigir(rolRequerido);
    if (!usuario) return null;
    pintarBarra(usuario, opciones);
    avisarBloqueo(usuario);
    return usuario;
  }

  /**
   * Etiqueta del modelo de IA a partir de lo que respondió el servidor: el
   * nombre del modelo (fila de `planta_analisis_ia` o `uso.modelo`), su
   * empresa y el nivel de razonamiento. Nunca supone un modelo: si el panel de
   * Administración cambia de Gemini a Claude, la etiqueta cambia con él.
   */
  function etiquetaModeloIa(analisis) {
    var uso = (analisis && analisis.uso) || {};
    var crudo = (analisis && analisis.modelo) || uso.modelo || "";
    var nombre = crudo
      ? crudo.replace(/-/g, " ").replace(/\b\w/g, function (l) { return l.toUpperCase(); })
      : "Modelo de IA";
    var empresa = uso.proveedor === "anthropic" ? "Anthropic" : uso.proveedor === "gemini" ? "Google AI" : "";
    return { modelo: nombre, empresa: empresa, nivel: uso.nivel_razonamiento || "" };
  }

  global.Sesion = {
    etiquetaModeloIa: etiquetaModeloIa,
    actual: actual,
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
    notificar: notificar,
    marcarOrigen: marcarOrigen,
    iniciarVista: iniciarVista
  };
})(window);
