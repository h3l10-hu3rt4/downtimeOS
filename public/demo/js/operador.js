/* ==========================================================================
   Tableta de piso — perfil HH (Helio Huerta)
   --------------------------------------------------------------------------
   Regla de blindaje: CERO cifras de dinero en esta pantalla. Este archivo no
   importa ningún formateador de moneda ni lee `tarifa` en ninguna parte; no
   tiene forma de mostrar un peso aunque alguien lo intentara.

   FLUJO SECUENCIAL
     Paso 1 · Línea  →  Paso 2 · Máquina  →  Paso 3 · Estado  →  (causa)

   RESETEO INTELIGENTE
   Al terminar un registro se vuelve al Paso 2 CON LA MISMA LÍNEA, porque los
   eventos llegan en ráfaga sobre la misma línea y volver al selector de línea
   cada vez costaría un toque de más en cada reporte. Solo "Empezar de nuevo"
   regresa al Paso 1.

   AISLAMIENTO POR LÍNEA
   El panel de estado y la bitácora muestran únicamente la línea seleccionada.
   ========================================================================== */
(function () {
  "use strict";

  var cuenta = Sesion.iniciarVista("operador");
  if (!cuenta) return;

  var $ = function (s) { return document.querySelector(s); };
  var D = window.DowntimeCO;

  var ETIQUETA_ESTADO = { RUN: "Operando", SETUP: "Setup / SMED", STOP: "Paro" };

  var seleccion = { linea: null, activo: null, estado: null };
  var inicioCaptura = null;   // para medir cuánto tardó el registro

  function dosDigitos(n) { return n < 10 ? "0" + n : String(n); }
  function hhmm(min) { return dosDigitos(Math.floor(min / 60)) + ":" + dosDigitos(min % 60); }

  /* ===================== HISTORIAL DE LA SESIÓN =========================
     Cada reporte se acumula como un renglón con el color de lo que se capturó
     —rojo un paro, verde una vuelta a producción, ámbar un retroactivo— y con
     una X para deshacerlo. La lista vive en memoria: al salir de la vista se
     limpia, pero lo que no se borró sigue en la base y lo ven los otros roles.
     ===================================================================== */
  var sesionLog = [];

  function confirmar(tono, html, deshacer) {
    sesionLog.unshift({
      tono: tono,
      html: html,
      hora: new Date(),
      deshacer: deshacer || null
    });
    pintarSesionLog();
  }

  function pintarSesionLog() {
    var caja = $("#sesionLog");
    $("#conteoMios").textContent = sesionLog.length +
      (sesionLog.length === 1 ? " reporte" : " reportes");

    if (!sesionLog.length) {
      caja.innerHTML = '<p class="calc__note" style="margin:0">' +
        "Aquí se irán acumulando tus reportes de este turno. Cada uno se puede deshacer." +
        "</p>";
      return;
    }

    caja.innerHTML = "";
    sesionLog.forEach(function (entrada, indice) {
      var fila = document.createElement("div");
      fila.className = "log__fila log__fila--" + entrada.tono;
      fila.innerHTML =
        '<span class="log__hora mono">' +
          entrada.hora.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }) + "</span>" +
        '<div class="log__txt">' + entrada.html + "</div>";

      var x = document.createElement("button");
      x.type = "button";
      x.className = "log__x";
      x.title = "Deshacer este reporte";
      x.setAttribute("aria-label", "Deshacer este reporte");
      x.textContent = "✕";
      x.addEventListener("click", function () {
        if (entrada.deshacer) entrada.deshacer();
        sesionLog.splice(indice, 1);
        pintarSesionLog();
        pintarEstadoActual();
        if (seleccion.linea) pasoMaquina();
      });

      fila.appendChild(x);
      caja.appendChild(fila);
    });
  }

  /* ---------------------------------------------------- barra de pasos --- */
  function marcarPaso(n) {
    document.querySelectorAll(".paso").forEach(function (p) {
      var i = Number(p.dataset.paso);
      p.classList.toggle("is-activo", i === n);
      p.classList.toggle("is-hecho", i < n);
    });
  }

  /* ------------------------------------------------- panel de la máquina --- */
  var temporizador = null;

  function pintarEstadoActual() {
    var caja = $("#opEstado");

    if (!seleccion.activo) {
      caja.innerHTML =
        '<div class="op-estado__id">' + (seleccion.linea ? D.linea(seleccion.linea).nombre.split(" · ")[0] : "—") + "</div>" +
        '<div class="op-estado__crono mono">--:--</div>' +
        '<div class="op-estado__causa">' +
          (seleccion.linea ? "Selecciona una máquina" : "Selecciona una línea") + "</div>";
      return;
    }

    var e = D.estados()[seleccion.activo] || { estado: "RUN", desde: new Date().toISOString() };
    var min = D.minutosEn(e);

    caja.innerHTML =
      '<div class="op-estado__id">' + seleccion.activo + "</div>" +
      '<div class="op-estado__crono mono op-estado__crono--' + e.estado.toLowerCase() + '">' + hhmm(min) + "</div>" +
      '<span class="pill-estado pill-estado--' + e.estado.toLowerCase() + '">' +
        '<i aria-hidden="true"></i>' + ETIQUETA_ESTADO[e.estado] + "</span>" +
      '<div class="op-estado__causa">' +
        (e.causa ? D.causa(e.causa).etiqueta : D.activo(seleccion.activo).nombre) + "</div>";
  }

  function arrancarReloj() {
    if (temporizador) clearInterval(temporizador);
    temporizador = setInterval(pintarEstadoActual, 15000);
  }

  /* ========================= PASO 1 · LÍNEA ============================== */
  function pasoLinea() {
    seleccion = { linea: null, activo: null, estado: null };
    marcarPaso(1);
    $("#tituloPaso").textContent = "Paso 1 · ¿En qué línea estás?";
    Sesion.contexto("DowntimeCO");

    var grid = $("#opGrid");
    grid.innerHTML = "";

    D.LINEAS.forEach(function (l) {
      var activos = D.activosDeLinea(l.id);
      var estados = D.estados();
      var detenidos = activos.filter(function (a) {
        return estados[a.id] && estados[a.id].estado === "STOP";
      }).length;

      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "op-btn op-btn--linea";
      btn.innerHTML =
        "<b>" + l.id + "</b>" +
        "<span>" + l.nombre.split(" · ")[1] + "</span>" +
        '<span class="mono" style="font-size:.7rem">' + activos.length + " activos</span>" +
        (detenidos
          ? '<span class="pill-estado pill-estado--stop"><i aria-hidden="true"></i>' +
            detenidos + (detenidos === 1 ? " detenido" : " detenidos") + "</span>"
          : '<span class="pill-estado pill-estado--run"><i aria-hidden="true"></i>Sin paros</span>');
      btn.addEventListener("click", function () {
        seleccion.linea = l.id;
        Sesion.contexto("DowntimeCO · " + l.id);
        pasoMaquina();
      });
      grid.appendChild(btn);
    });

    pintarEstadoActual();
  }

  /* ========================= PASO 2 · MÁQUINA =========================== */
  function pasoMaquina() {
    seleccion.activo = null;
    seleccion.estado = null;
    marcarPaso(2);
    $("#tituloPaso").textContent = "Paso 2 · " + seleccion.linea + " · ¿Qué máquina?";

    var estados = D.estados();
    var grid = $("#opGrid");
    grid.innerHTML = "";

    D.activosDeLinea(seleccion.linea).forEach(function (a) {
      var e = estados[a.id] || { estado: "RUN" };
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "op-btn";
      btn.innerHTML =
        "<b>" + a.id + "</b>" +
        "<span>" + a.etapa + "</span>" +
        '<span class="pill-estado pill-estado--' + e.estado.toLowerCase() + '">' +
          '<i aria-hidden="true"></i>' + ETIQUETA_ESTADO[e.estado] + "</span>";
      btn.addEventListener("click", function () {
        inicioCaptura = Date.now();
        seleccion.activo = a.id;
        pintarEstadoActual();
        pasoEstado();
      });
      grid.appendChild(btn);
    });

    pintarEstadoActual();
  }

  /* ========================= PASO 3 · ESTADO ============================ */
  function pasoEstado() {
    marcarPaso(3);
    $("#tituloPaso").textContent = "Paso 3 · " + seleccion.activo + " · ¿Cómo está?";

    var grid = $("#opGrid");
    grid.innerHTML = "";

    [
      { estado: "RUN",   texto: "Operando",   clase: "op-btn--run",   color: "var(--accent-green)", pie: "Cierra el paro abierto" },
      { estado: "STOP",  texto: "Paro",       clase: "op-btn--stop",  color: "var(--accent-red)",   pie: "Avisa a Mantenimiento" },
      { estado: "RETRO", texto: "Setup",      clase: "op-btn--setup", color: "var(--accent-amber)", pie: "Registro retroactivo" }
    ].forEach(function (op) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "op-btn " + op.clase;
      btn.innerHTML =
        '<span class="op-btn__punto" style="background:' + op.color + '"></span>' +
        "<b style='color:" + op.color + "'>" + op.texto + "</b>" +
        "<span>" + op.pie + "</span>";
      btn.addEventListener("click", function () {
        seleccion.estado = op.estado;
        if (op.estado === "RUN") return confirmarVuelta();
        if (op.estado === "RETRO") return abrirModalRetro();
        pasoCausa();
      });
      grid.appendChild(btn);
    });
  }

  /* ------------------------------ causa del paro ------------------------ */
  function pasoCausa() {
    $("#tituloPaso").textContent = "Paso 3 · " + seleccion.activo + " · ¿Por qué se detuvo?";

    var grid = $("#opGrid");
    grid.innerHTML = "";

    D.CAUSAS.forEach(function (c) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "op-btn" + (c.libre ? " op-btn--otros" : "");
      btn.innerHTML = "<span style='font-size:.92rem;line-height:1.35'>" + c.etiqueta + "</span>";
      btn.addEventListener("click", function () {
        if (c.libre) return pasoCausaLibre(c);
        confirmarParo(c);
      });
      grid.appendChild(btn);
    });
  }

  /** «Otros» exige escribir el motivo: si no, el catálogo deja de agrupar. */
  function pasoCausaLibre(c) {
    $("#tituloPaso").textContent = "Paso 3 · " + seleccion.activo + " · ¿Cuál fue el motivo?";

    var grid = $("#opGrid");
    grid.innerHTML =
      '<div class="op-libre">' +
        '<label class="op-libre__lbl" for="causaLibre">Describe la causa del paro</label>' +
        '<input class="input" type="text" id="causaLibre" maxlength="120" ' +
               'placeholder="Ej. Falta de aire comprimido en la red">' +
        '<p class="login__err" id="causaLibreErr" role="alert"></p>' +
        '<div class="op-libre__acciones">' +
          '<button type="button" class="btn btn--ghost" id="causaLibreVolver">Elegir otra causa</button>' +
          '<button type="button" class="btn btn--primary" id="causaLibreOk">Registrar Paro</button>' +
        '</div>' +
      "</div>";

    var campo = $("#causaLibre");
    setTimeout(function () { campo.focus(); }, 60);

    $("#causaLibreVolver").addEventListener("click", pasoCausa);
    $("#causaLibreOk").addEventListener("click", function () {
      var texto = campo.value.trim();
      if (texto.length < 3) {
        $("#causaLibreErr").textContent = "Escribe el motivo para poder agruparlo después.";
        $("#causaLibreErr").classList.add("is-visible");
        campo.focus();
        return;
      }
      confirmarParo(c, texto);
    });
    campo.addEventListener("keydown", function (e) {
      if (e.key === "Enter") $("#causaLibreOk").click();
    });
  }

  /* ------------------------------------------------------- confirmar ---- */
  function segundosDeCaptura() {
    return inicioCaptura ? Math.max(1, Math.round((Date.now() - inicioCaptura) / 1000)) : 0;
  }

  /** Vuelve al paso 2 de la MISMA línea: los eventos llegan en ráfaga. */
  function volverAMaquinas(retrasoMs) {
    setTimeout(pasoMaquina, retrasoMs);
  }

  function confirmarParo(causa, textoLibre) {
    var activo = seleccion.activo;
    D.cambiarEstado(activo, "STOP", causa.id, { causaLibre: textoLibre || null });
    // El paro entra a la bandeja de Mantenimiento con ESTE timestamp: el
    // cronómetro y la pérdida ya empezaron a correr, sin esperar validación.
    var solicitud = D.crearSolicitud({
      activo: activo,
      causa: causa.id,
      causaLibre: textoLibre || null,
      reportadoPor: cuenta.nombre
    });
    pintarEstadoActual();

    confirmar("stop",
      "<b>" + activo + " marcada en paro.</b> Causa: " +
      D.etiquetaCausa(causa.id, textoLibre) + ". Registrado en " +
      segundosDeCaptura() + " s y enviado a Mantenimiento.",
      function () {
        // Deshacer un paro: se retira de la bandeja y la máquina vuelve a RUN.
        D.eliminarSolicitud(solicitud.id);
        D.cambiarEstado(activo, "RUN", null);
      });

    volverAMaquinas(1800);
  }

  function confirmarVuelta() {
    var activo = seleccion.activo;
    var previo = D.estados()[activo];
    var seg = segundosDeCaptura();

    if (!previo || previo.estado === "RUN") {
      D.cambiarEstado(seleccion.activo, "RUN", null);
      pintarEstadoActual();
      confirmar("run", "<b>" + seleccion.activo + " sigue operando.</b> No había ningún paro abierto que cerrar.");
      return volverAMaquinas(1500);
    }

    // Se cierra el paro abierto con su duración real y se escribe en la bitácora.
    var minutos = D.minutosEn(previo);
    var evento = D.registrar({
      activo: activo,
      causa: previo.causa || "espera-material",
      minutos: minutos,
      inicio: previo.desde,
      nota: "Cerrado por " + cuenta.nombre + " desde la tableta de piso."
    });

    D.cambiarEstado(activo, "RUN", null);
    D.cerrarSolicitud(activo);
    pintarEstadoActual();

    confirmar("run",
      "<b>" + activo + " de vuelta en producción.</b> Paro de " + hhmm(minutos) +
      " por «" + evento.etiquetaCausa + "» guardado en " + seg + " s.<br>" +
      "<span class='mono log__folio'>" + evento.id + "</span>",
      function () {
        // Deshacer el cierre devuelve la máquina al paro que tenía Y reanuda su
        // cronómetro desde la marca original: si se reiniciara en cero, el paro
        // aparecería más corto de lo que realmente fue.
        D.eliminar(evento.id, "Cierre deshecho por " + cuenta.nombre + " desde el historial de sesión");
        D.cambiarEstado(activo, "STOP", previo.causa, {
          desde: previo.desde,
          causaLibre: previo.causaLibre
        });
      });

    volverAMaquinas(1800);
  }

  /* --------- Registro retroactivo (modal compartido con Mantenimiento) --- */
  var retro = Retroactivo.iniciar({
    nota: "Registro retroactivo capturado por " + cuenta.nombre + ".",
    alCerrar: function () { pasoMaquina(); },
    alGuardar: function (evento, minutos) {
      confirmar("retro",
        "<b>Registro retroactivo guardado.</b> " + evento.activo + " · " + hhmm(minutos) +
        " por «" + evento.etiquetaCausa + "». La máquina conserva su estado.<br>" +
        "<span class='mono log__folio'>" + evento.id + "</span>",
        function () {
          D.eliminar(evento.id, "Registro retroactivo deshecho por " + cuenta.nombre);
        });
      volverAMaquinas(1800);
    }
  });

  function abrirModalRetro() { retro.abrir(seleccion.activo); }

  /* ------------------------------------------------------------ arranque */
  $("#btnReiniciarCaptura").addEventListener("click", pasoLinea);
  $("#cronoSesion").textContent = "Turno en curso · " +
    new Date().toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });

  pasoLinea();
  pintarSesionLog();
  arrancarReloj();
})();
