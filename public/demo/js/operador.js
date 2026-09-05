/* ==========================================================================
   Tableta de piso — perfil EH (Helio Emmanuel Huerta)
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
    $("#opOk").hidden = true;
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
        pintarMisRegistros();
        pasoMaquina();
      });
      grid.appendChild(btn);
    });

    pintarEstadoActual();
    pintarMisRegistros();
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
      btn.className = "op-btn";
      btn.innerHTML = "<span style='font-size:.92rem;line-height:1.35'>" + c.etiqueta + "</span>";
      btn.addEventListener("click", function () { confirmarParo(c); });
      grid.appendChild(btn);
    });
  }

  /* ------------------------------------------------------- confirmar ---- */
  function segundosDeCaptura() {
    return inicioCaptura ? Math.max(1, Math.round((Date.now() - inicioCaptura) / 1000)) : 0;
  }

  /** Vuelve al paso 2 de la MISMA línea: los eventos llegan en ráfaga. */
  function volverAMaquinas(retrasoMs) {
    setTimeout(function () {
      pasoMaquina();
      pintarMisRegistros();
    }, retrasoMs);
  }

  function confirmarParo(causa) {
    D.cambiarEstado(seleccion.activo, "STOP", causa.id);
    // El paro entra a la bandeja de Mantenimiento con ESTE timestamp: el
    // cronómetro y la pérdida ya empezaron a correr, sin esperar validación.
    D.crearSolicitud({
      activo: seleccion.activo,
      causa: causa.id,
      reportadoPor: cuenta.nombre
    });
    pintarEstadoActual();

    $("#opOk").innerHTML =
      "<b>" + seleccion.activo + " marcada en paro.</b><br>" +
      "Causa: " + causa.etiqueta + ". Registrado en " + segundosDeCaptura() +
      " segundos y enviado a Mantenimiento. Marca <b>Operando</b> cuando la máquina " +
      "vuelva a producir.";
    $("#opOk").hidden = false;

    volverAMaquinas(2600);
  }

  function confirmarVuelta() {
    var previo = D.estados()[seleccion.activo];
    var seg = segundosDeCaptura();

    if (!previo || previo.estado === "RUN") {
      D.cambiarEstado(seleccion.activo, "RUN", null);
      pintarEstadoActual();
      $("#opOk").innerHTML = "<b>" + seleccion.activo + " sigue operando.</b> No había ningún paro abierto que cerrar.";
      $("#opOk").hidden = false;
      return volverAMaquinas(2200);
    }

    // Se cierra el paro abierto con su duración real y se escribe en la bitácora.
    var minutos = D.minutosEn(previo);
    var evento = D.registrar({
      activo: seleccion.activo,
      causa: previo.causa || "espera-material",
      minutos: minutos,
      inicio: previo.desde,
      nota: "Cerrado por " + cuenta.nombre + " desde la tableta de piso."
    });

    D.cambiarEstado(seleccion.activo, "RUN", null);
    D.cerrarSolicitud(seleccion.activo);
    pintarEstadoActual();

    $("#opOk").innerHTML =
      "<b>" + seleccion.activo + " de vuelta en producción.</b><br>" +
      "Paro de " + hhmm(minutos) + " por «" + D.causa(evento.causa).etiqueta + "» guardado " +
      "con folio <b class='mono'>" + evento.id + "</b> en " + seg + " segundos.";
    $("#opOk").hidden = false;

    volverAMaquinas(3000);
  }

  /* ================== MODAL · REGISTRO RETROACTIVO ======================
     Para microparos ya resueltos y eventos que nadie capturó a tiempo. No
     cambia el estado de la máquina: solo escribe el evento con su duración.
     ====================================================================== */
  function abrirModalRetro() {
    var modal = $("#modalRetro");
    var sel = $("#retroCausa");

    sel.innerHTML = D.CAUSAS.map(function (c) {
      return '<option value="' + c.id + '">' + c.etiqueta + "</option>";
    }).join("");

    $("#retroActivo").textContent = seleccion.activo;
    $("#retroErr").classList.remove("is-visible");
    $("#retroDuracion").textContent = "—";

    // Propuesta razonable: los últimos 20 minutos.
    var ahora = new Date();
    var antes = new Date(ahora.getTime() - 20 * 60000);
    var hhmmInput = function (d) { return dosDigitos(d.getHours()) + ":" + dosDigitos(d.getMinutes()); };
    $("#retroInicio").value = hhmmInput(antes);
    $("#retroFin").value = hhmmInput(ahora);
    calcularDuracionRetro();

    modal.classList.add("is-open");
    document.body.style.overflow = "hidden";
    setTimeout(function () { $("#retroInicio").focus(); }, 60);
  }

  function cerrarModalRetro() {
    $("#modalRetro").classList.remove("is-open");
    document.body.style.overflow = "";
    pasoMaquina();
  }

  /** Minutos entre dos horas del mismo día; si fin < inicio, cruzó medianoche. */
  function minutosRetro() {
    var i = $("#retroInicio").value;
    var f = $("#retroFin").value;
    if (!i || !f) return null;

    var pi = i.split(":").map(Number);
    var pf = f.split(":").map(Number);
    var minutosInicio = pi[0] * 60 + pi[1];
    var minutosFin = pf[0] * 60 + pf[1];
    var dur = minutosFin - minutosInicio;
    if (dur < 0) dur += 24 * 60;   // el paro cruzó la medianoche (turno T3)
    return dur;
  }

  function calcularDuracionRetro() {
    var dur = minutosRetro();
    $("#retroDuracion").textContent = (dur === null || dur === 0) ? "—" : hhmm(dur) + " (" + dur + " min)";
    return dur;
  }

  function iniciarModalRetro() {
    $("#retroInicio").addEventListener("input", calcularDuracionRetro);
    $("#retroFin").addEventListener("input", calcularDuracionRetro);

    document.querySelectorAll("[data-cerrar-retro]").forEach(function (b) {
      b.addEventListener("click", cerrarModalRetro);
    });
    $("#modalRetro").addEventListener("mousedown", function (e) {
      if (e.target === $("#modalRetro")) cerrarModalRetro();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && $("#modalRetro").classList.contains("is-open")) cerrarModalRetro();
    });

    $("#formRetro").addEventListener("submit", function (e) {
      e.preventDefault();
      var dur = calcularDuracionRetro();
      var err = $("#retroErr");

      if (dur === null || dur <= 0) {
        err.textContent = "Revisa las horas: la de fin debe ser posterior a la de inicio.";
        err.classList.add("is-visible");
        return;
      }
      if (dur > 12 * 60) {
        err.textContent = "Un paro de más de 12 horas no se captura desde la tableta. Repórtalo a Mantenimiento.";
        err.classList.add("is-visible");
        return;
      }

      // La hora capturada se ancla al día de hoy.
      var partes = $("#retroInicio").value.split(":").map(Number);
      var inicio = new Date();
      inicio.setHours(partes[0], partes[1], 0, 0);
      if (inicio.getTime() > Date.now()) inicio.setDate(inicio.getDate() - 1);  // aún no ocurre hoy: fue ayer

      var causaId = $("#retroCausa").value;
      var evento = D.registrar({
        activo: seleccion.activo,
        causa: causaId,
        minutos: dur,
        inicio: inicio.toISOString(),
        nota: "Registro retroactivo capturado por " + cuenta.nombre + ".",
        retroactivo: true
      });

      $("#modalRetro").classList.remove("is-open");
      document.body.style.overflow = "";

      $("#opOk").innerHTML =
        "<b>Registro retroactivo guardado.</b><br>" +
        seleccion.activo + " · " + hhmm(dur) + " por «" + D.causa(causaId).etiqueta +
        "», folio <b class='mono'>" + evento.id + "</b>. La máquina conserva el estado que tenía.";
      $("#opOk").hidden = false;

      volverAMaquinas(2800);
    });
  }

  /* ------------------------------------- registros de la línea activa --- */
  function pintarMisRegistros() {
    var mios = D.eventosCapturados(seleccion.linea || undefined);

    $("#tituloRegistros").textContent = seleccion.linea
      ? "Tus registros · " + seleccion.linea
      : "Tus registros";
    $("#conteoMios").textContent = mios.length + (mios.length === 1 ? " registro" : " registros");

    var cuerpo = $("#tablaMios");
    cuerpo.innerHTML = "";

    if (!mios.length) {
      cuerpo.innerHTML =
        '<tr><td colspan="4" class="apagado" style="white-space:normal">' +
        (seleccion.linea
          ? "Sin registros en esta línea todavía. Marca una máquina en <b>Paro</b> y luego en <b>Operando</b> para cerrar el evento."
          : "Selecciona una línea para ver sus registros.") +
        "</td></tr>";
      return;
    }

    mios.forEach(function (ev) {
      var tr = document.createElement("tr");
      tr.innerHTML =
        "<td class='mono apagado'>" + ev.fecha.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }) +
          (ev.retroactivo ? " <span class='apagado'>· retro</span>" : "") + "</td>" +
        "<td class='mono'>" + ev.activo + "</td>" +
        "<td>" + D.causa(ev.causa).etiqueta + "</td>" +
        '<td class="num">' + hhmm(ev.minutos) + "</td>";
      cuerpo.appendChild(tr);
    });
  }

  /* ------------------------------------------------------------ arranque */
  $("#btnReiniciarCaptura").addEventListener("click", pasoLinea);
  $("#cronoSesion").textContent = "Turno en curso · " +
    new Date().toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });

  iniciarModalRetro();
  pasoLinea();
  arrancarReloj();
})();
