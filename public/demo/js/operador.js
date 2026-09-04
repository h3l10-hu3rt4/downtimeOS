/* ==========================================================================
   Tableta de piso — operador@downtimeco.com
   --------------------------------------------------------------------------
   Regla de blindaje del PRD: CERO cifras de dinero en esta pantalla. Aquí no
   se importa ningún formateador de moneda ni se lee `tarifa`; el archivo
   entero no tiene forma de mostrar un peso aunque alguien lo intentara.

   El registro es de tres toques: máquina → estado → causa. Volver a "Operando"
   cierra el paro abierto y lo escribe con su duración real, que es lo que
   después aparece con precio en las vistas de gerencia y dirección.
   ========================================================================== */
(function () {
  "use strict";

  var cuenta = Sesion.iniciarVista("operador");
  if (!cuenta) return;

  var $ = function (s) { return document.querySelector(s); };
  var D = window.DowntimeCO;

  var ETIQUETA_ESTADO = { RUN: "Operando", SETUP: "Setup / SMED", STOP: "Paro" };

  var seleccion = { activo: null, estado: null };
  var inicioCaptura = null;   // para medir cuánto tardó el registro

  function dosDigitos(n) { return n < 10 ? "0" + n : String(n); }
  function hhmm(min) { return dosDigitos(Math.floor(min / 60)) + ":" + dosDigitos(min % 60); }

  /* ---------------------------------------------------- barra de pasos */
  function marcarPaso(n) {
    document.querySelectorAll(".paso").forEach(function (p) {
      var i = Number(p.dataset.paso);
      p.classList.toggle("is-activo", i === n);
      p.classList.toggle("is-hecho", i < n);
    });
  }

  /* ------------------------------------------------- panel de la máquina */
  var temporizador = null;

  function pintarEstadoActual() {
    var caja = $("#opEstado");
    if (!seleccion.activo) {
      caja.innerHTML =
        '<div class="op-estado__id">—</div>' +
        '<div class="op-estado__crono mono">--:--</div>' +
        '<div class="op-estado__causa">Selecciona una máquina</div>';
      return;
    }

    var estados = D.estados();
    var e = estados[seleccion.activo] || { estado: "RUN", desde: new Date().toISOString() };
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

  /* ------------------------------------------------------- paso 1: máquina */
  function pasoMaquina() {
    seleccion = { activo: null, estado: null };
    marcarPaso(1);
    $("#tituloPaso").textContent = "Paso 1 · ¿Qué máquina?";
    $("#opOk").hidden = true;

    var estados = D.estados();
    var grid = $("#opGrid");
    grid.innerHTML = "";

    D.ACTIVOS.forEach(function (a) {
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
  }

  /* -------------------------------------------------------- paso 2: estado */
  function pasoEstado() {
    marcarPaso(2);
    $("#tituloPaso").textContent = "Paso 2 · " + seleccion.activo + " · ¿Cómo está?";

    var grid = $("#opGrid");
    grid.innerHTML = "";

    [
      { estado: "RUN",   texto: "Operando", clase: "op-btn--run",   color: "var(--accent-green)" },
      { estado: "SETUP", texto: "Setup",    clase: "op-btn--setup", color: "var(--accent-amber)" },
      { estado: "STOP",  texto: "Paro",     clase: "op-btn--stop",  color: "var(--accent-red)" }
    ].forEach(function (op) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "op-btn " + op.clase;
      btn.innerHTML =
        '<span class="op-btn__punto" style="background:' + op.color + '"></span>' +
        "<b style='color:" + op.color + "'>" + op.texto + "</b>";
      btn.addEventListener("click", function () {
        seleccion.estado = op.estado;
        if (op.estado === "RUN") {
          // Volver a producir cierra el paro abierto: no hace falta un
          // tercer toque para decir por qué, ya se dijo al detenerse.
          confirmarVuelta();
        } else {
          pasoCausa();
        }
      });
      grid.appendChild(btn);
    });
  }

  /* --------------------------------------------------------- paso 3: causa */
  function pasoCausa() {
    marcarPaso(3);
    $("#tituloPaso").textContent = "Paso 3 · " + seleccion.activo + " · ¿Por qué?";

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

  /* ------------------------------------------------------------ confirmar */
  function segundosDeCaptura() {
    return inicioCaptura ? Math.max(1, Math.round((Date.now() - inicioCaptura) / 1000)) : 0;
  }

  function confirmarParo(causa) {
    D.cambiarEstado(seleccion.activo, seleccion.estado, causa.id);
    pintarEstadoActual();

    var seg = segundosDeCaptura();
    $("#opOk").innerHTML =
      "<b>" + seleccion.activo + " marcada como " + ETIQUETA_ESTADO[seleccion.estado].toLowerCase() + ".</b><br>" +
      "Causa: " + causa.etiqueta + ". Registrado en " + seg + " segundos y " +
      "notificado a Mantenimiento. Marca <b>Operando</b> cuando la máquina vuelva a producir.";
    $("#opOk").hidden = false;

    setTimeout(pasoMaquina, 2600);
  }

  function confirmarVuelta() {
    var estados = D.estados();
    var previo = estados[seleccion.activo];
    var seg = segundosDeCaptura();

    if (!previo || previo.estado === "RUN") {
      D.cambiarEstado(seleccion.activo, "RUN", null);
      pintarEstadoActual();
      $("#opOk").innerHTML = "<b>" + seleccion.activo + " sigue operando.</b> No había ningún paro abierto que cerrar.";
      $("#opOk").hidden = false;
      setTimeout(pasoMaquina, 2200);
      return;
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
    pintarEstadoActual();
    pintarMisRegistros();

    $("#opOk").innerHTML =
      "<b>" + seleccion.activo + " de vuelta en producción.</b><br>" +
      "Paro de " + hhmm(minutos) + " por «" + D.causa(evento.causa).etiqueta + "» guardado " +
      "con folio <b class='mono'>" + evento.id + "</b> en " + seg + " segundos.";
    $("#opOk").hidden = false;

    setTimeout(pasoMaquina, 3000);
  }

  /* -------------------------------------------------- registros del turno */
  function pintarMisRegistros() {
    var mios = D.eventosCapturados();
    $("#conteoMios").textContent = mios.length + (mios.length === 1 ? " registro" : " registros");

    var cuerpo = $("#tablaMios");
    cuerpo.innerHTML = "";

    if (!mios.length) {
      cuerpo.innerHTML =
        '<tr><td colspan="4" class="apagado" style="white-space:normal">' +
        "Aún no has registrado paros en esta sesión. Marca una máquina en <b>Paro</b> y " +
        "después en <b>Operando</b> para cerrar el evento." +
        "</td></tr>";
      return;
    }

    mios.forEach(function (ev) {
      var tr = document.createElement("tr");
      tr.innerHTML =
        "<td class='mono apagado'>" + ev.fecha.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }) + "</td>" +
        "<td class='mono'>" + ev.activo + "</td>" +
        "<td>" + D.causa(ev.causa).etiqueta + "</td>" +
        '<td class="num">' + hhmm(ev.minutos) + "</td>";
      cuerpo.appendChild(tr);
    });
  }

  /* ------------------------------------------------------------ arranque */
  $("#btnReiniciarCaptura").addEventListener("click", pasoMaquina);
  $("#cronoSesion").textContent = "Turno en curso · " +
    new Date().toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });

  pasoMaquina();
  pintarMisRegistros();
  pintarEstadoActual();
  arrancarReloj();
})();
