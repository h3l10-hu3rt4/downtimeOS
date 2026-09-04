/* ==========================================================================
   Vista de Operaciones y Mantenimiento — gerente@downtimeco.com
   Ve el impacto económico de cada paro para poder priorizar, pero NO la tabla
   de tarifas hora-máquina: esa columna es exclusiva de Dirección.
   ========================================================================== */
(function () {
  "use strict";

  var cuenta = Sesion.iniciarVista("operaciones");
  if (!cuenta) return;

  var $ = function (s) { return document.querySelector(s); };
  var D = window.DowntimeCO;
  var Fmt = window.DowntimeCalc;

  var dinero = function (v) { return Fmt.dinero(v, "MXN", 0); };
  var numero = function (v, dec) { return Fmt.numero(v, dec); };

  var eventos = D.eventos();
  var resumen = D.resumen(eventos);

  function dosDigitos(n) { return n < 10 ? "0" + n : String(n); }
  function hhmm(min) { return dosDigitos(Math.floor(min / 60)) + ":" + dosDigitos(min % 60); }

  /* --------------------------------------------------------------- KPIs */
  function pintarKpis() {
    var estados = D.estados();
    var detenidos = D.ACTIVOS.filter(function (a) { return estados[a.id] && estados[a.id].estado === "STOP"; });
    var cuelloParado = detenidos.some(function (a) { return a.cuelloBotella; });

    $("#kpis").innerHTML = "";
    [
      {
        lbl: "Activos detenidos ahora", val: String(detenidos.length),
        clase: detenidos.length ? "kpi__val--red" : "kpi__val--green",
        pie: cuelloParado ? "Incluye el cuello de botella C-01" : "Cuello de botella operando"
      },
      { lbl: "MTTR del periodo", val: numero(resumen.mttrMin) + " min", clase: "",
        pie: "Media de " + resumen.eventos + " intervenciones" },
      { lbl: "MTBF del periodo", val: numero(resumen.mtbfHoras, 1) + " h", clase: "kpi__val--cyan",
        pie: "Entre fallas, sobre horas programadas" },
      { lbl: "Impacto del periodo", val: dinero(resumen.costoTotal), clase: "kpi__val--red",
        pie: numero(resumen.horasParo, 1) + " h de paro acumuladas" }
    ].forEach(function (k) {
      var div = document.createElement("div");
      div.className = "kpi";
      div.innerHTML =
        '<div class="kpi__lbl">' + k.lbl + "</div>" +
        '<div class="kpi__val ' + k.clase + '">' + k.val + "</div>" +
        '<div class="kpi__pie">' + k.pie + "</div>";
      $("#kpis").appendChild(div);
    });
  }

  /* ----------------------------------------------------- estado del piso */
  var ETIQUETA_ESTADO = { RUN: "Operando", SETUP: "Setup / SMED", STOP: "Paro" };

  function pintarMosaico() {
    var estados = D.estados();
    var caja = $("#mosaico");
    caja.innerHTML = "";

    // El cuello de botella primero, y luego los detenidos: el tablero ordena
    // por urgencia real, no por identificador.
    var orden = D.ACTIVOS.slice().sort(function (a, b) {
      var ea = estados[a.id] || { estado: "RUN" };
      var eb = estados[b.id] || { estado: "RUN" };
      var peso = { STOP: 0, SETUP: 1, RUN: 2 };
      if (peso[ea.estado] !== peso[eb.estado]) return peso[ea.estado] - peso[eb.estado];
      if (a.cuelloBotella !== b.cuelloBotella) return a.cuelloBotella ? -1 : 1;
      return a.id.localeCompare(b.id);
    });

    orden.forEach(function (a) {
      var e = estados[a.id] || { estado: "RUN", desde: new Date().toISOString() };
      var min = D.minutosEn(e);
      var clase = e.estado === "STOP" ? " activo-card--stop" : (e.estado === "SETUP" ? " activo-card--setup" : "");
      var costoActual = e.estado === "STOP" ? (min / 60) * D.tarifaAplicable(a.id) : 0;

      var div = document.createElement("div");
      div.className = "activo-card" + clase;
      div.innerHTML =
        '<div class="activo-card__id">' + a.id + "</div>" +
        '<div class="activo-card__nom">' + a.nombre + "</div>" +
        '<span class="pill-estado pill-estado--' + e.estado.toLowerCase() + '">' +
          '<i aria-hidden="true"></i>' + ETIQUETA_ESTADO[e.estado] + "</span>" +
        '<div class="activo-card__pie">' + hhmm(min) + " en este estado" +
          (e.causa ? " · " + D.causa(e.causa).etiqueta : "") + "</div>" +
        (e.estado === "STOP"
          ? '<div class="activo-card__pie" style="color:var(--accent-red)">Acumulado: ' + dinero(costoActual) + "</div>"
          : "") +
        (a.cuelloBotella ? '<span class="activo-card__cuello">Cuello de botella</span>' : "");
      caja.appendChild(div);
    });

    $("#relojEstado").textContent = "Actualizado " + new Date().toLocaleTimeString("es-MX");
  }

  /* ------------------------------------------------------------ bitácora */
  $("#conteoEventos").textContent = eventos.length + " registros";
  eventos.slice(0, 40).forEach(function (ev) {
    var tr = document.createElement("tr");
    if (ev.origen === "demo") tr.className = "es-demo";
    tr.innerHTML =
      "<td class='mono'>" + ev.id + "</td>" +
      "<td class='mono apagado'>" + ev.fecha.toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) + "</td>" +
      "<td class='mono'>" + ev.turno + "</td>" +
      "<td class='mono'>" + ev.activo + "</td>" +
      "<td>" + D.causa(ev.causa).etiqueta + "</td>" +
      '<td class="num">' + numero(ev.minutos) + "</td>" +
      '<td class="dinero">' + dinero(ev.costo) + "</td>";
    $("#tablaEventos").appendChild(tr);
  });

  /* -------------------------------------------------- turnos (MTTR) ---- */
  var turnos = D.porTurno(eventos).filter(function (t) { return t.eventos > 0; });
  var peorMttr = turnos.reduce(function (m, t) { return Math.max(m, t.mttrMin); }, 1);

  turnos.forEach(function (t, i) {
    var fila = document.createElement("div");
    fila.className = "turno-fila";
    fila.innerHTML =
      '<div class="turno-fila__id' + (i === 0 ? " turno-fila__id--top" : "") + '">' + t.turno + "</div>" +
      '<div class="turno-fila__barra"><i style="width:' + ((t.mttrMin / peorMttr) * 100).toFixed(1) + '%"></i></div>' +
      '<div class="turno-fila__val">' + numero(t.mttrMin) + " min</div>" +
      '<div class="turno-fila__meta">' + t.eventos + " eventos · " + numero(t.minutos) +
        " min de paro · " + dinero(t.costo) + "</div>";
    $("#turnos").appendChild(fila);
  });

  if (turnos.length) {
    $("#turnosNota").textContent =
      "El turno " + turnos[0].turno + " resuelve en " + numero(turnos[0].mttrMin) +
      " min de media, el mejor de los " + turnos.length + " con actividad registrada.";
  }

  /* ---------------------------------------------------------- despacho */
  $("#btnDespacho").addEventListener("click", function () {
    var estados = D.estados();
    var detenidos = D.ACTIVOS.filter(function (a) { return estados[a.id] && estados[a.id].estado === "STOP"; });

    if (!detenidos.length) {
      alert("No hay activos detenidos. No hay nada que despachar.");
      return;
    }
    // Se prioriza el cuello de botella: es lo que distingue al producto de una
    // lista de tickets por orden de llegada.
    var critico = detenidos.filter(function (a) { return a.cuelloBotella; })[0] || detenidos[0];
    var min = D.minutosEn(estados[critico.id]);

    alert(
      "Simulación de WhatsApp Cloud API\n\n" +
      "Para: Brigada de Mantenimiento · Línea 02\n\n" +
      "🔴 " + critico.id + " — " + critico.nombre + "\n" +
      "Estado: PARO NO PROGRAMADO (" + hhmm(min) + ")\n" +
      (estados[critico.id].causa ? "Causa: " + D.causa(estados[critico.id].causa).etiqueta + "\n" : "") +
      (critico.cuelloBotella ? "⚠ Cuello de botella: detiene la línea completa.\n" : "") +
      "\nAtender con prioridad 1."
    );
  });

  pintarKpis();
  pintarMosaico();
  // El piso cambia mientras el tablero está abierto: el operador puede estar
  // capturando en su tableta ahora mismo.
  setInterval(function () { pintarKpis(); pintarMosaico(); }, 20000);
})();
