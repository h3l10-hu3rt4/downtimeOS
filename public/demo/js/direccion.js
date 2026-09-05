/* ==========================================================================
   Dirección y Finanzas — perfil AH (Alex Huerta)
   El único de los tres roles con acceso a las tarifas hora-máquina y a la
   exportación. Todo se deriva de datos.js; aquí no hay cifras escritas a mano.

   Las tres gráficas se dibujan a mano (SVG y CSS) en vez de cargar una
   librería: la demo tiene que abrir sin red y sin build.
   ========================================================================== */
(function () {
  "use strict";

  var cuenta = Sesion.iniciarVista("direccion");
  if (!cuenta) return;

  var $ = function (s) { return document.querySelector(s); };
  var D = window.DowntimeCO;
  var Fmt = window.DowntimeCalc;

  var dinero = function (v, dec) { return Fmt.dinero(v, "MXN", dec === undefined ? 0 : dec); };
  var numero = function (v, dec) { return Fmt.numero(v, dec); };

  var eventos = D.eventos();
  var resumen = D.resumen(eventos);
  var pareto = D.paretoPorCausa(eventos);

  // Paleta de las gráficas: los acentos del sistema, en orden de severidad.
  var COLORES = [
    "var(--accent-red)", "var(--accent-amber)", "var(--accent-cyan)",
    "var(--accent-green)", "#8B7BE8", "#5D697D"
  ];

  $("#diasHistorial").textContent = D.DIAS_HISTORIAL;
  Sesion.contexto("DowntimeCO · 2 líneas");

  /* --------------------------------------------------------------- KPIs */
  var recuperable = resumen.costoTotal * Fmt.MODELO.FACTOR_MITIGACION;

  [
    { lbl: "Costo de paros del periodo", val: dinero(resumen.costoTotal), clase: "kpi__val--red",
      pie: numero(resumen.eventos) + " eventos · " + numero(resumen.horasParo, 1) + " h de paro" },
    { lbl: "Equivalente en USD", val: "$" + numero(resumen.costoUsd) + " USD", clase: "",
      pie: "Tipo de cambio " + D.TIPO_CAMBIO_USD + " MXN/USD" },
    { lbl: "Recuperable con DowntimeOS", val: dinero(recuperable), clase: "kpi__val--green",
      pie: "20% de reducción de MTTR" },
    { lbl: "Disponibilidad de planta", val: numero(resumen.disponibilidad, 1) + "%", clase: "kpi__val--cyan",
      pie: numero(resumen.horasDisponibles) + " h programadas en 2 líneas" }
  ].forEach(function (k) {
    var div = document.createElement("div");
    div.className = "kpi";
    div.innerHTML =
      '<div class="kpi__lbl">' + k.lbl + "</div>" +
      '<div class="kpi__val ' + k.clase + '">' + k.val + "</div>" +
      '<div class="kpi__pie">' + k.pie + "</div>";
    $("#kpis").appendChild(div);
  });

  /* ================= GRÁFICA 1 · DONUT DE PARETO ========================
     Un solo <circle> por causa, recortado con stroke-dasharray y desplazado
     con stroke-dashoffset. Sin librería y sin un solo path calculado a mano.
     ====================================================================== */
  function pintarDonut() {
    var R = 68, GROSOR = 26;
    var circunferencia = 2 * Math.PI * R;
    var offset = 0;

    var segmentos = pareto.filas.map(function (f, i) {
      var largo = (f.porcentaje / 100) * circunferencia;
      var seg =
        '<circle class="donut__seg" cx="90" cy="90" r="' + R + '" fill="none" ' +
        'stroke="' + COLORES[i % COLORES.length] + '" stroke-width="' + GROSOR + '" ' +
        'stroke-dasharray="' + largo.toFixed(2) + " " + (circunferencia - largo).toFixed(2) + '" ' +
        'stroke-dashoffset="' + (-offset).toFixed(2) + '">' +
        "<title>" + f.etiqueta + ": " + dinero(f.costo) + " (" + numero(f.porcentaje, 1) + "%)</title>" +
        "</circle>";
      offset += largo;
      return seg;
    }).join("");

    // Cuántas causas explican el 80% del dinero: el corte del principio.
    var hasta80 = 0;
    for (var i = 0; i < pareto.filas.length; i++) {
      hasta80++;
      if (pareto.filas[i].acumulado >= 80) break;
    }

    $("#donut").innerHTML =
      '<svg viewBox="0 0 180 180" role="img" aria-label="Distribución de la pérdida por causa raíz">' +
        '<g transform="rotate(-90 90 90)">' + segmentos + "</g>" +
        '<text class="donut__cifra" x="90" y="86" text-anchor="middle">' + hasta80 + "</text>" +
        '<text class="donut__pie" x="90" y="104" text-anchor="middle">causas = ' +
          numero(pareto.filas[hasta80 - 1].acumulado, 0) + "%</text>" +
      "</svg>";

    $("#donutLeyenda").innerHTML = pareto.filas.map(function (f, i) {
      return '<div class="leyenda__fila">' +
        '<span class="leyenda__punto" style="background:' + COLORES[i % COLORES.length] + '"></span>' +
        '<span class="leyenda__txt">' + f.etiqueta + "</span>" +
        '<b class="mono">' + numero(f.porcentaje, 1) + "%</b>" +
        '<span class="mono leyenda__monto">' + dinero(f.costo) + "</span>" +
      "</div>";
    }).join("");

    $("#paretoConcentracion").textContent = hasta80 + " causas = " +
      numero(pareto.filas[hasta80 - 1].acumulado) + "%";
    $("#paretoNota").textContent =
      "De " + pareto.filas.length + " causas registradas, " + hasta80 +
      " concentran el " + numero(pareto.filas[hasta80 - 1].acumulado) + "% de la pérdida. " +
      "Atacar «" + pareto.filas[0].etiqueta.toLowerCase() + "» vale " + dinero(pareto.filas[0].costo) +
      " al periodo.";
  }

  /* ============ GRÁFICA 2 · BARRAS HORIZONTALES POR ACTIVO ============== */
  function pintarBarrasActivo() {
    var filas = D.porActivo(eventos);
    var mayor = filas.length ? filas[0].costo : 1;

    $("#barrasActivo").innerHTML = filas.map(function (a) {
      var act = D.activo(a.activo);
      var esCuello = act && act.cuelloBotella;
      return '<div class="barra-h">' +
        '<div class="barra-h__lbl">' +
          '<b class="mono">' + a.activo + "</b>" +
          '<span class="mono">' + a.linea + (esCuello ? " · cuello" : "") + "</span>" +
        "</div>" +
        '<div class="barra-h__pista">' +
          '<i style="width:' + ((a.costo / mayor) * 100).toFixed(1) + "%;background:" +
            (esCuello ? "linear-gradient(90deg,var(--accent-red),var(--accent-amber))" : "var(--accent-cyan)") +
          '"></i>' +
        "</div>" +
        '<b class="barra-h__val mono">' + dinero(a.costo) + "</b>" +
      "</div>";
    }).join("");
  }

  /* ========= GRÁFICA 3 · BARRAS VERTICALES POR TURNO Y LÍNEA ============ */
  function pintarBarrasTurno() {
    var filas = D.porTurnoYLinea(eventos);
    var mayor = filas.reduce(function (m, f) { return Math.max(m, f.total); }, 1);
    var colorLinea = { "L-01": "var(--accent-amber)", "L-02": "var(--accent-cyan)" };

    $("#leyendaLineas").innerHTML = D.LINEAS.map(function (l) {
      return '<span class="leyenda__inline">' +
        '<span class="leyenda__punto" style="background:' + colorLinea[l.id] + '"></span>' + l.id +
      "</span>";
    }).join("");

    $("#barrasTurno").innerHTML = filas.map(function (f) {
      var columnas = D.LINEAS.map(function (l) {
        var dato = f.porLinea[l.id];
        var alto = mayor ? (dato.costo / mayor) * 100 : 0;
        return '<div class="barra-v__col" title="' + l.nombre + ": " + dinero(dato.costo) +
            " · " + dato.eventos + ' eventos">' +
          '<i style="height:' + alto.toFixed(1) + "%;background:" + colorLinea[l.id] + '"></i>' +
        "</div>";
      }).join("");

      return '<div class="barra-v">' +
        '<div class="barra-v__pista">' + columnas + "</div>" +
        '<div class="barra-v__lbl mono">' + f.turno + "</div>" +
        '<div class="barra-v__val mono">' + dinero(f.total) + "</div>" +
      "</div>";
    }).join("");

    var peor = filas.slice().sort(function (a, b) { return b.total - a.total; })[0];
    if (peor) {
      $("#turnoNota").textContent =
        "El turno " + peor.turno + " concentra " + dinero(peor.total) + ", el mayor de los tres. " +
        "Las barras comparan las dos líneas dentro de cada turno.";
    }
  }

  /* ------------------------------------------------------ costo x activo */
  function pintarTablaActivos() {
    var filas = D.porActivo(eventos);
    $("#badgeActivos").textContent = filas.length + " activos con paros";

    $("#tablaActivos").innerHTML = filas.map(function (a) {
      var act = D.activo(a.activo);
      return "<tr>" +
        "<td><b class='mono'>" + a.activo + "</b>" +
          (act && act.cuelloBotella ? " <span class='apagado'>· cuello</span>" : "") + "</td>" +
        "<td class='mono'>" + a.linea + "</td>" +
        '<td class="num">' + a.eventos + "</td>" +
        '<td class="num">' + numero(a.minutos) + " min</td>" +
        '<td class="dinero">' + dinero(a.costo) + "</td>" +
      "</tr>";
    }).join("");
  }

  /* ---------------------------------------------------------- tarifas ---
     Este bloque es el que el gerente y el operador NO reciben. */
  function pintarTarifas() {
    $("#tablaTarifas").innerHTML = D.ACTIVOS.map(function (a) {
      return "<tr>" +
        "<td><b class='mono'>" + a.id + "</b></td>" +
        "<td class='mono'>" + a.linea + "</td>" +
        "<td>" + a.etapa + "</td>" +
        '<td class="num">' + dinero(a.tarifa) + "</td>" +
        '<td class="dinero">' + dinero(D.tarifaAplicable(a.id)) + " / h</td>" +
        '<td class="apagado">' + (a.cuelloBotella
          ? "Sin redundancia: su paro detiene " + a.linea + " completa"
          : "Absorbible por los equipos gemelos de la etapa") + "</td>" +
      "</tr>";
    }).join("");
  }

  /* ------------------------------------------------------------ bitácora */
  function pintarBitacora() {
    $("#conteoEventos").textContent = eventos.length + " registros";
    $("#tablaEventos").innerHTML = eventos.map(function (ev) {
      return '<tr' + (ev.origen === "demo" ? ' class="es-demo"' : "") + ">" +
        "<td class='mono'>" + ev.id + "</td>" +
        "<td class='mono apagado'>" + ev.fecha.toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) + "</td>" +
        "<td class='mono'>" + ev.linea + "</td>" +
        "<td class='mono'>" + ev.turno + "</td>" +
        "<td class='mono'>" + ev.activo + "</td>" +
        "<td>" + D.causa(ev.causa).etiqueta + "</td>" +
        '<td class="num">' + numero(ev.minutos) + "</td>" +
        '<td class="dinero">' + dinero(ev.costo) + "</td>" +
      "</tr>";
    }).join("");
  }

  /* --------------------------------------------------- reporte mensual ---
     Se arma un documento imprimible y el navegador lo guarda como PDF. */
  $("#btnReporte").addEventListener("click", function () {
    var win = window.open("", "_blank", "width=900,height=1000");
    if (!win) {
      alert("El navegador bloqueó la ventana emergente del reporte.");
      return;
    }

    var filasPareto = pareto.filas.map(function (f) {
      return "<tr><td>" + f.etiqueta + "</td><td class='n'>" + numero(f.minutos) + " min</td>" +
             "<td class='n'>" + dinero(f.costo) + "</td><td class='n'>" + numero(f.porcentaje, 1) + "%</td></tr>";
    }).join("");

    var filasLinea = D.porLinea(eventos).map(function (l) {
      return "<tr><td>" + l.nombre + "</td><td class='n'>" + l.eventos + "</td>" +
             "<td class='n'>" + numero(l.minutos) + " min</td><td class='n'>" + dinero(l.costo) + "</td></tr>";
    }).join("");

    var filasActivo = D.porActivo(eventos).map(function (a) {
      return "<tr><td>" + a.activo + " · " + D.activo(a.activo).nombre + "</td>" +
             "<td class='n'>" + a.linea + "</td><td class='n'>" + numero(a.minutos) + " min</td>" +
             "<td class='n'>" + dinero(a.costo) + "</td></tr>";
    }).join("");

    win.document.write(
      "<!doctype html><html lang='es'><head><meta charset='utf-8'>" +
      "<title>Reporte Mensual — DowntimeCO</title><style>" +
      "*{box-sizing:border-box}body{font-family:Segoe UI,Inter,system-ui,sans-serif;color:#10151c;margin:0;padding:44px}" +
      "h1{font-size:24px;margin:0 0 4px}h2{font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#5d697d;margin:30px 0 8px}" +
      ".kicker{font-family:Consolas,monospace;font-size:11px;letter-spacing:.2em;color:#a97400;text-transform:uppercase}" +
      ".box{border:1px solid #d7dee5;border-radius:10px;padding:18px 20px;margin-top:14px}" +
      "table{width:100%;border-collapse:collapse;margin-top:6px}" +
      "th{text-align:left;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#5d697d;padding:6px 4px;border-bottom:1px solid #d7dee5}" +
      "td{padding:8px 4px;border-bottom:1px solid #e6ebf0;font-size:13.5px}" +
      "td.n{text-align:right;font-family:Consolas,monospace}" +
      ".foot{margin-top:30px;font-size:11px;color:#5d697d;border-top:1px solid #e6ebf0;padding-top:12px}" +
      "@media print{body{padding:24px}}" +
      "</style></head><body>" +
      "<div class='kicker'>DowntimeOS · Reporte Mensual de Disponibilidad</div>" +
      "<h1>DowntimeCO — Planta completa</h1>" +
      "<div style='color:#5d697d;font-size:13px'>" + cuenta.nombre + " · " + cuenta.puesto +
      "<br>Periodo: últimos " + D.DIAS_HISTORIAL + " días · Emitido " + new Date().toLocaleString("es-MX") + "</div>" +
      "<div class='box'><div class='kicker'>Costo total de paros del periodo</div>" +
      "<div style='font-family:Consolas,monospace;font-size:32px;font-weight:800;color:#d92d20'>" + dinero(resumen.costoTotal) + "</div>" +
      "<div style='font-size:13px;color:#475467;margin-top:6px'>" + resumen.eventos + " eventos · " +
      numero(resumen.horasParo, 1) + " horas de paro · disponibilidad " + numero(resumen.disponibilidad, 1) + "%. " +
      "Una reducción del 20% en el tiempo de detección y despacho recuperaría <b>" + dinero(recuperable) + "</b>.</div></div>" +
      "<h2>Pareto de causas raíz</h2><table><tr><th>Causa</th><th class='n'>Paro</th><th class='n'>Costo</th><th class='n'>%</th></tr>" + filasPareto + "</table>" +
      "<h2>Comparativo por línea</h2><table><tr><th>Línea</th><th class='n'>Eventos</th><th class='n'>Paro</th><th class='n'>Costo</th></tr>" + filasLinea + "</table>" +
      "<h2>Concentración por activo</h2><table><tr><th>Activo</th><th class='n'>Línea</th><th class='n'>Paro</th><th class='n'>Costo</th></tr>" + filasActivo + "</table>" +
      "<div class='foot'>Modelo de costo: cada activo se valora a su tarifa hora-máquina; el cuello de botella de cada línea " +
      "se valora a la tarifa de esa línea completa (" + dinero(D.tarifaLinea("L-01")) + "/h en L-01, " +
      dinero(D.tarifaLinea("L-02")) + "/h en L-02), que es la suma de sus estaciones. " +
      "Datos simulados de la planta de demostración DowntimeCO.</div>" +
      "</body></html>"
    );
    win.document.close();
    win.focus();
    setTimeout(function () { win.print(); }, 350);
  });

  pintarDonut();
  pintarBarrasActivo();
  pintarBarrasTurno();
  pintarTablaActivos();
  pintarTarifas();
  pintarBitacora();
})();
