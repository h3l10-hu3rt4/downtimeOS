/* ==========================================================================
   Vista de Dirección y Finanzas — ceo@downtimeco.com
   El único de los tres roles con acceso a las tarifas hora-máquina y a la
   exportación. Todo se deriva de datos.js; aquí no hay cifras escritas a mano.
   ========================================================================== */
(function () {
  "use strict";

  var cuenta = Sesion.iniciarVista("direccion");
  if (!cuenta) return;   // exigir() ya redirigió

  var $ = function (s) { return document.querySelector(s); };
  var D = window.DowntimeCO;
  var Fmt = window.DowntimeCalc;

  var dinero = function (v, dec) { return Fmt.dinero(v, "MXN", dec === undefined ? 0 : dec); };
  var numero = function (v, dec) { return Fmt.numero(v, dec); };

  var eventos = D.eventos();
  var resumen = D.resumen(eventos);
  var pareto = D.paretoPorCausa(eventos);

  $("#diasHistorial").textContent = D.DIAS_HISTORIAL;

  /* --------------------------------------------------------------- KPIs */
  // El "recuperable" usa el mismo 35% del motor de la landing: una sola
  // promesa de producto en las dos superficies.
  var recuperable = resumen.costoTotal * 0.35;

  [
    { lbl: "Costo de paros del periodo", val: dinero(resumen.costoTotal), clase: "kpi__val--red",
      pie: numero(resumen.eventos) + " eventos · " + numero(resumen.horasParo, 1) + " h de paro" },
    { lbl: "Equivalente en USD", val: "$" + numero(resumen.costoUsd) + " USD", clase: "",
      pie: "Tipo de cambio " + D.TIPO_CAMBIO_USD + " MXN/USD" },
    { lbl: "Recuperable con DowntimeOS", val: dinero(recuperable), clase: "kpi__val--green",
      pie: "35% de reducción de MTTR" },
    { lbl: "Disponibilidad de línea", val: numero(resumen.disponibilidad, 1) + "%", clase: "kpi__val--cyan",
      pie: numero(resumen.horasDisponibles) + " h programadas" }
  ].forEach(function (k) {
    var div = document.createElement("div");
    div.className = "kpi";
    div.innerHTML =
      '<div class="kpi__lbl">' + k.lbl + "</div>" +
      '<div class="kpi__val ' + k.clase + '">' + k.val + "</div>" +
      '<div class="kpi__pie">' + k.pie + "</div>";
    $("#kpis").appendChild(div);
  });

  /* ------------------------------------------------------------- Pareto */
  var mayor = pareto.filas.length ? pareto.filas[0].costo : 1;
  pareto.filas.forEach(function (f) {
    var fila = document.createElement("div");
    fila.className = "pareto__fila";
    fila.innerHTML =
      "<span>" + f.etiqueta + " · <b class='mono' style='color:var(--text-muted)'>" + f.activos.join(", ") + "</b></span>" +
      '<b class="mono">' + dinero(f.costo) + "</b>" +
      '<div class="pareto__barra"><i style="width:' + ((f.costo / mayor) * 100).toFixed(1) + '%"></i></div>';
    $("#pareto").appendChild(fila);
  });

  // ¿Cuántas causas hacen falta para explicar el 80% del dinero perdido?
  var causasHasta80 = 0;
  for (var i = 0; i < pareto.filas.length; i++) {
    causasHasta80++;
    if (pareto.filas[i].acumulado >= 80) break;
  }
  $("#paretoConcentracion").textContent = causasHasta80 + " causas = " +
    numero(pareto.filas[causasHasta80 - 1].acumulado) + "%";
  $("#paretoNota").textContent =
    "De " + pareto.filas.length + " causas registradas, " + causasHasta80 +
    " concentran el " + numero(pareto.filas[causasHasta80 - 1].acumulado) + "% de la pérdida. " +
    "Atacar «" + pareto.filas[0].etiqueta.toLowerCase() + "» vale " + dinero(pareto.filas[0].costo) +
    " al periodo.";

  /* ------------------------------------------------------ costo x activo */
  D.porActivo(eventos).forEach(function (a) {
    var activo = D.activo(a.activo);
    var tr = document.createElement("tr");
    tr.innerHTML =
      "<td><b class='mono'>" + a.activo + "</b>" +
        (activo && activo.cuelloBotella ? " <span class='apagado'>· cuello</span>" : "") + "</td>" +
      '<td class="num">' + numero(a.minutos) + " min</td>" +
      '<td class="dinero">' + dinero(a.costo) + "</td>";
    $("#tablaActivos").appendChild(tr);
  });

  /* ---------------------------------------------------------- tarifas ---
     Este bloque es el que el gerente y el operador NO reciben. */
  D.ACTIVOS.forEach(function (a) {
    var aplicable = D.tarifaAplicable(a.id);
    var tr = document.createElement("tr");
    tr.innerHTML =
      "<td><b class='mono'>" + a.id + "</b></td>" +
      "<td>" + a.etapa + "</td>" +
      '<td class="num">' + dinero(a.tarifa) + "</td>" +
      '<td class="dinero">' + dinero(aplicable) + " / h</td>" +
      '<td class="apagado">' + (a.cuelloBotella
        ? "Sin redundancia: su paro detiene la línea completa"
        : "Absorbible por los equipos gemelos de la etapa") + "</td>";
    $("#tablaTarifas").appendChild(tr);
  });

  /* ------------------------------------------------------------ bitácora */
  $("#conteoEventos").textContent = eventos.length + " registros";
  eventos.forEach(function (ev) {
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

  /* --------------------------------------------------- reporte mensual ---
     Mismo recurso que el reporte de la calculadora: se arma un documento
     imprimible y se deja que el navegador lo guarde como PDF. */
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

    var filasActivo = D.porActivo(eventos).map(function (a) {
      return "<tr><td>" + a.activo + " · " + D.activo(a.activo).nombre + "</td>" +
             "<td class='n'>" + a.eventos + "</td><td class='n'>" + numero(a.minutos) + " min</td>" +
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
      "tr:first-child td{font-weight:700}" +
      ".foot{margin-top:30px;font-size:11px;color:#5d697d;border-top:1px solid #e6ebf0;padding-top:12px}" +
      "@media print{body{padding:24px}}" +
      "</style></head><body>" +
      "<div class='kicker'>DowntimeOS · Reporte Mensual de Disponibilidad</div>" +
      "<h1>DowntimeCO — Línea 02</h1>" +
      "<div style='color:#5d697d;font-size:13px'>" + cuenta.nombre + " · " + cuenta.puesto +
      "<br>Periodo: últimos " + D.DIAS_HISTORIAL + " días · Emitido " + new Date().toLocaleString("es-MX") + "</div>" +
      "<div class='box'><div class='kicker'>Costo total de paros del periodo</div>" +
      "<div style='font-family:Consolas,monospace;font-size:32px;font-weight:800;color:#d92d20'>" + dinero(resumen.costoTotal) + "</div>" +
      "<div style='font-size:13px;color:#475467;margin-top:6px'>" + resumen.eventos + " eventos · " +
      numero(resumen.horasParo, 1) + " horas de paro · disponibilidad " + numero(resumen.disponibilidad, 1) + "%. " +
      "Una reducción del 35% en el tiempo de respuesta recuperaría <b>" + dinero(recuperable) + "</b>.</div></div>" +
      "<h2>Pareto de causas raíz</h2><table><tr><th>Causa</th><th class='n'>Paro</th><th class='n'>Costo</th><th class='n'>%</th></tr>" + filasPareto + "</table>" +
      "<h2>Concentración por activo</h2><table><tr><th>Activo</th><th class='n'>Eventos</th><th class='n'>Paro</th><th class='n'>Costo</th></tr>" + filasActivo + "</table>" +
      "<div class='foot'>Modelo de costo: cada activo se valora a su tarifa hora-máquina; la sierra C-01 es el cuello de botella " +
      "y sus paros se valoran a la tarifa de línea (" + dinero(D.tarifaLinea()) + "/h), que es la suma de las ocho estaciones. " +
      "Datos simulados de la planta de demostración DowntimeCO.</div>" +
      "</body></html>"
    );
    win.document.close();
    win.focus();
    setTimeout(function () { win.print(); }, 350);
  });
})();
