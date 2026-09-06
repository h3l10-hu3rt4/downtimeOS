/* ==========================================================================
   Dirección y Finanzas — perfil AH (Alex Huerta)
   El único de los tres roles con acceso a las tarifas hora-máquina y a la
   exportación. Todo se deriva de datos.js; aquí no hay cifras escritas a mano.

   Las tres gráficas se dibujan a mano (SVG y CSS) en vez de cargar una
   librería: la demo tiene que abrir sin red y sin build. Las mismas se
   reconstruyen en el reporte imprimible con color explícito, porque ese
   documento no hereda los tokens de la aplicación.
   ========================================================================== */
(function () {
  "use strict";

  var cuenta = Sesion.iniciarVista("direccion", { sinSelectorTurno: true });
  if (!cuenta) return;

  var $ = function (s) { return document.querySelector(s); };
  var D = window.DowntimeCO;
  var Fmt = window.DowntimeCalc;

  var dinero = function (v, dec) { return Fmt.dinero(v, "MXN", dec === undefined ? 0 : dec); };
  var numero = function (v, dec) { return Fmt.numero(v, dec); };

  /* Paleta explícita en hexadecimal, no en tokens: la ventana de impresión es
     otro documento y no hereda las variables CSS de la aplicación. */
  var COLORES = ["#FF4D4F", "#FFB627", "#35D0E8", "#34D399", "#8B7BE8", "#5D697D"];
  var COLOR_LINEA = { "L-01": "#FFB627", "L-02": "#35D0E8" };
  var analisisReal = null;

  Sesion.contexto("DowntimeCO · 2 líneas");
  $("#diasHistorial").textContent = D.DIAS_HISTORIAL;

  /* ================= FILTRO DE RANGO FECHA + TURNO ======================
     Dirección no razona por turno suelto sino por periodo: «del lunes T1 al
     miércoles T3». El rango se compara con el ordinal de jornada del evento,
     que ya resuelve el cruce de medianoche del turno 3 (datos.js).
     ===================================================================== */
  var RANGOS = Sesion.RANGOS_TURNO;
  var TURNO_VIVO = Sesion.turnoEnCurso();
  var rango = { desdeFecha: null, desdeTurno: "T1", hastaFecha: null, hastaTurno: "T3" };

  function aISO(d) {
    return d.getFullYear() + "-" + dosDig(d.getMonth() + 1) + "-" + dosDig(d.getDate());
  }
  function dosDig(n) { return n < 10 ? "0" + n : String(n); }

  function opcionesTurno(seleccionado) {
    return ["T1", "T2", "T3"].map(function (t) {
      return '<option value="' + t + '"' + (t === seleccionado ? " selected" : "") + ">" +
        t + " · " + RANGOS[t] + "</option>";
    }).join("");
  }

  function aplicarPreset(dias) {
    var hoy = new Date();
    var desde = new Date();
    if (dias === "hoy") {
      rango.desdeTurno = "T1";
      rango.hastaTurno = TURNO_VIVO;
    } else {
      desde.setDate(desde.getDate() - (Number(dias) - 1));
      rango.desdeTurno = "T1";
      rango.hastaTurno = "T3";
    }
    rango.desdeFecha = aISO(desde);
    rango.hastaFecha = aISO(hoy);
    sincronizarControles();
  }

  function sincronizarControles() {
    $("#rangoDesdeFecha").value = rango.desdeFecha;
    $("#rangoHastaFecha").value = rango.hastaFecha;
    $("#rangoDesdeTurno").innerHTML = opcionesTurno(rango.desdeTurno);
    $("#rangoHastaTurno").innerHTML = opcionesTurno(rango.hastaTurno);
  }

  function leerControles() {
    rango.desdeFecha = $("#rangoDesdeFecha").value || rango.desdeFecha;
    rango.hastaFecha = $("#rangoHastaFecha").value || rango.hastaFecha;
    rango.desdeTurno = $("#rangoDesdeTurno").value;
    rango.hastaTurno = $("#rangoHastaTurno").value;

    // Si el extremo final queda antes del inicial, se intercambian en vez de
    // rechazar la entrada: el visitante quiso decir ese periodo, en ese orden.
    var oi = D.ordinalTurno(rango.desdeFecha, rango.desdeTurno);
    var of = D.ordinalTurno(rango.hastaFecha, rango.hastaTurno);
    if (oi > of) {
      var tmpF = rango.desdeFecha, tmpT = rango.desdeTurno;
      rango.desdeFecha = rango.hastaFecha; rango.desdeTurno = rango.hastaTurno;
      rango.hastaFecha = tmpF; rango.hastaTurno = tmpT;
      sincronizarControles();
    }
  }

  function iniciarRango() {
    aplicarPreset(D.DIAS_HISTORIAL);

    ["#rangoDesdeFecha", "#rangoHastaFecha", "#rangoDesdeTurno", "#rangoHastaTurno"]
      .forEach(function (sel) {
        $(sel).addEventListener("change", function () {
          leerControles();
          recalcular();
          pintarTodo();
        });
      });

    document.querySelectorAll("#rango [data-preset]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        document.querySelectorAll("#rango [data-preset]").forEach(function (b) {
          b.classList.toggle("is-activo", b === btn);
        });
        aplicarPreset(btn.dataset.preset);
        recalcular();
        pintarTodo();
      });
    });
  }

  function formatoFecha(iso) {
    var p = String(iso).split("-");
    return new Date(p[0], p[1] - 1, p[2])
      .toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
  }

  function etiquetaPeriodo() {
    if (rango.desdeFecha === rango.hastaFecha && rango.desdeTurno === rango.hastaTurno) {
      return "el " + formatoFecha(rango.desdeFecha) + " en el turno " + rango.desdeTurno;
    }
    return "del " + formatoFecha(rango.desdeFecha) + " " + rango.desdeTurno +
      " al " + formatoFecha(rango.hastaFecha) + " " + rango.hastaTurno;
  }
  function etiquetaPeriodoDe() { return "de " + etiquetaPeriodo(); }

  /* ------------------------------------------------- estado derivado --- */
  var eventos, resumen, pareto, recuperable;

  function recalcular() {
    eventos = D.eventos().filter(function (e) {
      return D.enRango(e, rango.desdeFecha, rango.desdeTurno, rango.hastaFecha, rango.hastaTurno);
    });
    resumen = D.resumen(eventos);
    pareto = D.paretoPorCausa(eventos);
    recuperable = resumen.costoTotal * Fmt.MODELO.FACTOR_MITIGACION;
    $("#rangoResumen").textContent = eventos.length +
      (eventos.length === 1 ? " evento · " : " eventos · ") + etiquetaPeriodo();
  }

  /* --------------------------------------------------------------- KPIs */
  function pintarKpis() {
    $("#kpis").innerHTML = "";
    [
      { lbl: "Costo de paros del periodo", val: dinero(resumen.costoTotal), clase: "kpi__val--red",
        pie: numero(resumen.eventos) + " eventos · " + numero(resumen.horasParo, 1) + " h de paro" },
      { lbl: "Equivalente en USD", val: "$" + numero(resumen.costoUsd) + " USD", clase: "",
        pie: "Tipo de cambio " + D.TIPO_CAMBIO_USD + " MXN/USD" },
      { lbl: "Recuperable con DowntimeOS", val: dinero(recuperable), clase: "kpi__val--green",
        pie: "20% de reducción de MTTR" },
      { lbl: "Periodo analizado", val: numero(resumen.eventos) + " ev.", clase: "kpi__val--cyan",
        pie: etiquetaPeriodo() }
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

  /* ============ DONUT DE PARETO (SVG a mano, sin librería) ==============
     Un <circle> por causa, recortado con stroke-dasharray y desplazado con
     stroke-dashoffset. `destino` permite reusarlo en el reporte imprimible.
     ====================================================================== */
  function svgDonut(filas, opciones) {
    opciones = opciones || {};
    var R = 68, GROSOR = 26;
    var circunferencia = 2 * Math.PI * R;
    var offset = 0;
    var colorCentro = opciones.colorTexto || "var(--text-primary)";
    var colorPie = opciones.colorPie || "var(--text-muted)";

    var segmentos = filas.map(function (f, i) {
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

    return '<svg viewBox="0 0 180 180" role="img" aria-label="Distribución de la pérdida por causa raíz">' +
        '<g transform="rotate(-90 90 90)">' + segmentos + "</g>" +
        '<text x="90" y="86" text-anchor="middle" style="font-family:JetBrains Mono,Consolas,monospace;' +
          'font-size:30px;font-weight:700;fill:' + colorCentro + '">' + causasHasta80() + "</text>" +
        '<text x="90" y="104" text-anchor="middle" style="font-family:JetBrains Mono,Consolas,monospace;' +
          'font-size:9px;letter-spacing:.1em;fill:' + colorPie + '">CAUSAS = ' +
          numero(pareto.filas[causasHasta80() - 1].acumulado, 0) + "%</text>" +
      "</svg>";
  }

  /** Cuántas causas hacen falta para explicar el 80% del dinero perdido. */
  function causasHasta80() {
    var n = 0;
    for (var i = 0; i < pareto.filas.length; i++) {
      n++;
      if (pareto.filas[i].acumulado >= 80) break;
    }
    return n || 1;
  }

  function pintarDonut() {
    if (!pareto.filas.length) {
      $("#donut").innerHTML = '<p class="calc__note">Sin eventos en ' + etiquetaPeriodo() + ".</p>";
      $("#donutLeyenda").innerHTML = "";
      $("#paretoConcentracion").textContent = "—";
      return;
    }

    $("#donut").innerHTML = svgDonut(pareto.filas);
    $("#donutLeyenda").innerHTML = pareto.filas.map(function (f, i) {
      return '<div class="leyenda__fila">' +
        '<span class="leyenda__punto" style="background:' + COLORES[i % COLORES.length] + '"></span>' +
        '<span class="leyenda__txt">' + f.etiqueta + "</span>" +
        '<b class="mono">' + numero(f.porcentaje, 1) + "%</b>" +
        '<span class="mono leyenda__monto">' + dinero(f.costo) + "</span>" +
      "</div>";
    }).join("");

    $("#paretoConcentracion").textContent = causasHasta80() + " causas = " +
      numero(pareto.filas[causasHasta80() - 1].acumulado) + "%";
  }

  /* ================= RESUMEN EJECUTIVO (LLM-READY) ======================
     El texto se compone hoy en el cliente con las mismas cifras del tablero,
     así que no puede contradecirlo. El día que se conecte un modelo, lo único
     que cambia es de dónde viene el párrafo: la tarjeta ya está en su sitio.
     ====================================================================== */
  var variante = 0;

  function redactarResumen() {
    if (!pareto.filas.length) {
      return "Sin eventos registrados en " + etiquetaPeriodo() + ". No hay concentración que analizar.";
    }

    var top = pareto.filas[0];
    var n = causasHasta80();
    var acumulado = numero(pareto.filas[n - 1].acumulado, 0);
    var activos = D.porActivo(eventos);
    var peorActivo = activos[0];
    var infoPeor = D.activo(peorActivo.activo);
    var lineas = D.porLinea(eventos).slice().sort(function (a, b) { return b.costo - a.costo; });
    var peorLinea = lineas[0];
    var participacion = resumen.costoTotal ? (peorActivo.costo / resumen.costoTotal) * 100 : 0;

    var textos = [
      "Análisis automatizado: el <b>" + acumulado + "%</b> de las fugas " + etiquetaPeriodoDe() +
      " se concentra en <b>" + n + " causas</b> raíz. «" + top.etiqueta + "» encabeza con " +
      dinero(top.costo) + " en " + top.eventos + " eventos, y el activo <b>" + peorActivo.activo +
      "</b> representa el <b>" + numero(participacion, 1) + "%</b> del impacto total" +
      (infoPeor && infoPeor.cuelloBotella
        ? ", agravado por ser el cuello de botella de " + infoPeor.linea + ": su paro detiene la línea completa."
        : ".") +
      " Recomendación: atacar esa causa antes que cualquier otra iniciativa de eficiencia.",

      "Diagnóstico de planta: " + peorLinea.nombre + " acumula " + dinero(peorLinea.costo) +
      " de los " + dinero(resumen.costoTotal) + " del periodo, con un MTTR medio de " +
      numero(resumen.mttrMin) + " minutos. Con la reducción del 20% en detección y despacho, " +
      "la recuperación proyectada es de <b>" + dinero(recuperable) + "</b>. El patrón sugiere " +
      "falta de stock preventivo en los consumibles asociados a «" + top.etiqueta.toLowerCase() + "».",

      "Lectura financiera: " + numero(resumen.horasParo, 1) + " horas de paro en " +
      etiquetaPeriodo() + " equivalen a " + dinero(resumen.costoTotal) + " (" +
      "$" + numero(resumen.costoUsd) + " USD). La concentración es alta —" + n +
      " causas explican el " + acumulado + "%—, lo que hace el problema abordable con una sola " +
      "intervención dirigida a <b>" + peorActivo.activo + "</b> en lugar de un programa general."
    ];

    return textos[variante % textos.length];
  }

  function pintarResumenIa() {
    if (analisisReal) {
      var prioridad = String(analisisReal.prioridad || "media").toLowerCase();
      var hallazgos = Array.isArray(analisisReal.hallazgos) ? analisisReal.hallazgos : [];
      var recomendaciones = Array.isArray(analisisReal.recomendaciones) ? analisisReal.recomendaciones : [];
      var criticos = Array.isArray(analisisReal.acciones_criticas) ? analisisReal.acciones_criticas : [];
      var seguimiento = Array.isArray(analisisReal.acciones_seguimiento) ? analisisReal.acciones_seguimiento : [];
      var consideraciones = Array.isArray(analisisReal.consideraciones) ? analisisReal.consideraciones : [];
      var principal = D.porActivo(eventos)[0];
      var concentracion = resumen.costoTotal && principal ? Math.round((principal.costo / resumen.costoTotal) * 100) : 0;
      var etiquetaPrioridad = $("#iaPrioridad");
      etiquetaPrioridad.hidden = false;
      etiquetaPrioridad.className = "ia__prioridad ia__prioridad--" + prioridad;
      etiquetaPrioridad.textContent = "Prioridad " + prioridad;
      $("#iaTexto").innerHTML = '<div class="ia__metricas" aria-label="Métricas financieras calculadas del periodo">' +
        '<div><span>Costo del periodo</span><b>' + dinero(resumen.costoTotal) + '</b></div>' +
        '<div><span>Eventos analizados</span><b>' + resumen.eventos + '</b></div>' +
        '<div><span>Mayor concentración</span><b>' + concentracion + '%</b><small>' + (principal ? principal.activo : 'Sin datos') + '</small></div>' +
        '</div><div class="ia__bloque ia__bloque--resumen"><p>' + escaparHtml(analisisReal.resumen) + '</p></div>' +
        grupoPrioridad('ia__grupo--hallazgos', 'Señales financieras', hallazgos, 'Sin señales suficientes para clasificar.') +
        grupoPrioridad(criticos.length ? 'ia__grupo--critico' : 'ia__grupo--estable', 'Decisión inmediata', criticos, 'Sin decisión inmediata · seguimiento financiero controlado.') +
        grupoPrioridad('ia__grupo--prioridad', 'Decisiones de este periodo', recomendaciones, 'Sin decisiones prioritarias pendientes.') +
        grupoPrioridad('ia__grupo--seguimiento', 'Seguimiento y validación', seguimiento.concat(consideraciones), 'Sin seguimiento adicional requerido.');
      $("#iaPie").className = "ia__pie mono ia__pie--real";
      $("#iaPie").textContent = "Generado por " + (analisisReal.uso?.proveedor === "anthropic" ? "Claude · Anthropic" : "Gemini · Google AI") + " · razonamiento " +
        (analisisReal.uso?.nivel_razonamiento || "high") + " · " + analisisReal.advertencia;
      return;
    }
    $("#iaTexto").innerHTML = redactarResumen();
    $("#iaPrioridad").hidden = true;
    $("#iaPie").className = "ia__pie mono ia__pie--demo";
    $("#iaPie").textContent =
      "Análisis de demostración (sin IA) · " + resumen.eventos + " eventos · " + etiquetaPeriodo() +
      " · " + new Date().toLocaleString("es-MX");
  }

  function parametrosPeriodoFinanzas() {
    return {
      desde: rango.desdeFecha, hasta: rango.hastaFecha, enfoque: "finanzas",
    };
  }

  function escaparHtml(texto) {
    return String(texto || "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function grupoPrioridad(clase, titulo, elementos, vacio) {
    var lista = Array.isArray(elementos) ? elementos : [];
    var sinElementos = !lista.length;
    return '<details class="ia__grupo ' + clase + (sinElementos ? ' ia__grupo--vacio' : '') + '" open>' +
      '<summary><span>' + titulo + '</span><b>' + (sinElementos ? 'Sin pendientes' : lista.length + ' ' + (lista.length === 1 ? 'decisión' : 'decisiones')) + '</b></summary>' +
      '<div class="ia__grupo-contenido">' + (sinElementos ? '<p>' + escaparHtml(vacio) + '</p>' : '<ul>' + lista.map(function (item) {
        return '<li>' + escaparHtml(item) + '</li>';
      }).join('') + '</ul>') + '</div></details>';
  }

  /* ============ BARRAS HORIZONTALES POR ACTIVO ========================= */
  function pintarBarrasActivo() {
    var filas = D.porActivo(eventos);
    if (!filas.length) {
      $("#barrasActivo").innerHTML = '<p class="calc__note">Sin eventos en ' + etiquetaPeriodo() + ".</p>";
      return;
    }
    var mayor = filas[0].costo || 1;

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
            (esCuello ? "linear-gradient(90deg,#FF4D4F,#FFB627)" : "#35D0E8") + '"></i>' +
        "</div>" +
        '<b class="barra-h__val mono">' + dinero(a.costo) + "</b>" +
      "</div>";
    }).join("");
  }

  /* ========= BARRAS VERTICALES POR TURNO Y LÍNEA ======================= */
  function pintarBarrasTurno() {
    // Este bloque compara SIEMPRE los tres turnos: filtrar aquí lo dejaría con
    // una sola columna y perdería su razón de ser.
    var filas = D.porTurnoYLinea(D.eventos());
    var mayor = filas.reduce(function (m, f) { return Math.max(m, f.total); }, 1);

    $("#leyendaLineas").innerHTML = D.LINEAS.map(function (l) {
      return '<span class="leyenda__inline">' +
        '<span class="leyenda__punto" style="background:' + COLOR_LINEA[l.id] + '"></span>' + l.id +
      "</span>";
    }).join("");

    $("#barrasTurno").innerHTML = filas.map(function (f) {
      var columnas = D.LINEAS.map(function (l) {
        var dato = f.porLinea[l.id];
        var alto = mayor ? (dato.costo / mayor) * 100 : 0;
        return '<div class="barra-v__col" title="' + l.nombre + ": " + dinero(dato.costo) +
            " · " + dato.eventos + ' eventos">' +
          '<i style="height:' + alto.toFixed(1) + "%;background:" + COLOR_LINEA[l.id] + '"></i>' +
        "</div>";
      }).join("");

      return '<div class="barra-v">' +
        '<div class="barra-v__pista">' + columnas + "</div>" +
        '<div class="barra-v__lbl mono">' + f.turno + (f.turno === TURNO_VIVO ? " ●" : "") + "</div>" +
        '<div class="barra-v__val mono">' + dinero(f.total) + "</div>" +
      "</div>";
    }).join("");

    var peor = filas.slice().sort(function (a, b) { return b.total - a.total; })[0];
    if (peor) {
      $("#turnoNota").textContent =
        "El turno " + peor.turno + " concentra " + dinero(peor.total) + ", el mayor de los tres. " +
        "Las barras comparan las dos líneas dentro de cada turno y no se filtran por el " +
        "selector: su valor está en la comparación.";
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

  /* ================== REPORTE EJECUTIVO IMPRIMIBLE ======================
     Documento aparte, fondo blanco y tipografía de contraste alto. Las tres
     gráficas se reconstruyen con la misma paleta, en color explícito, porque
     esta ventana no hereda los tokens de la aplicación.
     ====================================================================== */
  function construirReporte() {
    var filasPareto = pareto.filas.map(function (f, i) {
      return "<tr><td><span class='punto' style='background:" + COLORES[i % COLORES.length] + "'></span>" +
        f.etiqueta + "</td><td class='n'>" + numero(f.minutos) + " min</td>" +
        "<td class='n'>" + dinero(f.costo) + "</td><td class='n'>" + numero(f.porcentaje, 1) + "%</td></tr>";
    }).join("");

    var activos = D.porActivo(eventos);
    var mayorActivo = activos.length ? activos[0].costo : 1;
    var barrasActivo = activos.map(function (a) {
      var act = D.activo(a.activo);
      return "<div class='bh'>" +
        "<div class='bh__l'><b>" + a.activo + "</b><span>" + a.linea + "</span></div>" +
        "<div class='bh__p'><i style='width:" + ((a.costo / mayorActivo) * 100).toFixed(1) + "%;background:" +
          (act && act.cuelloBotella ? "#FF4D4F" : "#35D0E8") + "'></i></div>" +
        "<b class='bh__v'>" + dinero(a.costo) + "</b>" +
      "</div>";
    }).join("");

    var turnos = D.porTurnoYLinea(D.eventos());
    var mayorTurno = turnos.reduce(function (m, f) { return Math.max(m, f.total); }, 1);
    var barrasTurno = turnos.map(function (f) {
      var cols = D.LINEAS.map(function (l) {
        var alto = (f.porLinea[l.id].costo / mayorTurno) * 100;
        return "<div class='bv__c'><i style='height:" + alto.toFixed(1) + "%;background:" +
          COLOR_LINEA[l.id] + "'></i></div>";
      }).join("");
      return "<div class='bv'><div class='bv__p'>" + cols + "</div>" +
        "<div class='bv__l'>" + f.turno + "</div><div class='bv__v'>" + dinero(f.total) + "</div></div>";
    }).join("");

    var filasLinea = D.porLinea(eventos).map(function (l) {
      return "<tr><td>" + l.nombre + "</td><td class='n'>" + l.eventos + "</td>" +
             "<td class='n'>" + numero(l.minutos) + " min</td><td class='n'>" + dinero(l.costo) + "</td></tr>";
    }).join("");

    var estilos =
      "*{box-sizing:border-box}" +
      "body{font-family:Inter,Segoe UI,system-ui,sans-serif;color:#10151C;background:#FFFFFF;margin:0;padding:40px 44px}" +
      "h1{font-size:25px;margin:0 0 4px;letter-spacing:-.02em}" +
      "h2{font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#5D697D;margin:32px 0 10px;" +
        "padding-bottom:6px;border-bottom:1px solid #D7DEE5}" +
      ".kicker{font-family:JetBrains Mono,Consolas,monospace;font-size:10px;letter-spacing:.22em;" +
        "color:#A97400;text-transform:uppercase}" +
      ".cab{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;" +
        "border-bottom:2px solid #10151C;padding-bottom:14px}" +
      ".meta{font-size:12px;color:#5D697D;text-align:right;line-height:1.6}" +
      ".kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:18px}" +
      ".kpi{border:1px solid #D7DEE5;border-radius:8px;padding:12px 14px}" +
      ".kpi span{font-size:9px;letter-spacing:.13em;text-transform:uppercase;color:#5D697D}" +
      ".kpi b{display:block;font-family:JetBrains Mono,Consolas,monospace;font-size:19px;margin-top:5px}" +
      ".rojo{color:#C4291F}.verde{color:#12734A}.cyan{color:#1C7C8C}" +
      ".fila{display:grid;grid-template-columns:210px 1fr;gap:26px;align-items:center}" +
      ".ia{border:1px solid #D7DEE5;border-left:3px solid #A97400;border-radius:8px;padding:14px 16px;" +
        "margin-top:14px;font-size:12.5px;line-height:1.65;background:#FCFAF5}" +
      ".ia .tag{font-family:JetBrains Mono,Consolas,monospace;font-size:9px;letter-spacing:.14em;" +
        "text-transform:uppercase;color:#A97400;display:block;margin-bottom:6px}" +
      "table{width:100%;border-collapse:collapse;margin-top:4px}" +
      "th{text-align:left;font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;color:#5D697D;" +
        "padding:6px 4px;border-bottom:1px solid #D7DEE5}" +
      "td{padding:7px 4px;border-bottom:1px solid #EDF1F5;font-size:12.5px}" +
      "td.n{text-align:right;font-family:JetBrains Mono,Consolas,monospace}" +
      ".punto{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:8px;vertical-align:middle}" +
      ".bh{display:grid;grid-template-columns:70px 1fr 96px;gap:10px;align-items:center;margin-bottom:7px}" +
      ".bh__l b{font-family:JetBrains Mono,Consolas,monospace;font-size:11.5px;display:block}" +
      ".bh__l span{font-size:8.5px;color:#5D697D}" +
      ".bh__p{height:11px;background:#EDF1F5;border-radius:99px;overflow:hidden}" +
      ".bh__p i{display:block;height:100%;border-radius:99px}" +
      ".bh__v{font-family:JetBrains Mono,Consolas,monospace;font-size:11.5px;text-align:right}" +
      ".bvs{display:grid;grid-template-columns:repeat(3,1fr);gap:22px;align-items:end;margin-top:6px}" +
      ".bv{display:grid;gap:5px;justify-items:center}" +
      ".bv__p{display:flex;align-items:flex-end;justify-content:center;gap:7px;height:120px;width:100%;" +
        "border-bottom:1px solid #D7DEE5}" +
      ".bv__c{flex:1 1 0;max-width:40px;height:100%;display:flex;align-items:flex-end}" +
      ".bv__c i{display:block;width:100%;border-radius:3px 3px 0 0;min-height:2px}" +
      ".bv__l{font-family:JetBrains Mono,Consolas,monospace;font-weight:700;font-size:12px}" +
      ".bv__v{font-family:JetBrains Mono,Consolas,monospace;font-size:10.5px;color:#5D697D}" +
      ".leyenda{font-size:10px;color:#5D697D;margin-top:8px;text-align:center}" +
      ".foot{margin-top:28px;font-size:9.5px;color:#5D697D;border-top:1px solid #D7DEE5;padding-top:10px;line-height:1.6}" +
      "@page{margin:14mm}" +
      "@media print{body{padding:0}h2{break-after:avoid}.fila,.bvs,table{break-inside:avoid}}";

    return "<!doctype html><html lang='es'><head><meta charset='utf-8'>" +
      "<title>Reporte Ejecutivo — DowntimeCO</title><style>" + estilos + "</style></head><body>" +

      "<div class='cab'><div>" +
        "<div class='kicker'>DowntimeOS · Reporte Ejecutivo de Disponibilidad</div>" +
        "<h1>DowntimeCO — Planta completa</h1>" +
      "</div><div class='meta'>" +
        cuenta.nombre + " · " + cuenta.puesto + "<br>" +
        "Periodo: últimos " + D.DIAS_HISTORIAL + " días · " + etiquetaPeriodo() + "<br>" +
        "Emitido " + new Date().toLocaleString("es-MX") +
      "</div></div>" +

      "<div class='kpis'>" +
        "<div class='kpi'><span>Costo de paros</span><b class='rojo'>" + dinero(resumen.costoTotal) + "</b></div>" +
        "<div class='kpi'><span>Equivalente USD</span><b>$" + numero(resumen.costoUsd) + "</b></div>" +
        "<div class='kpi'><span>Recuperable (20% MTTR)</span><b class='verde'>" + dinero(recuperable) + "</b></div>" +
        "<div class='kpi'><span>Horas de paro</span><b class='cyan'>" + numero(resumen.horasParo, 1) + " h</b></div>" +
      "</div>" +

      "<h2>Concentración por causa raíz</h2>" +
      "<div class='fila'>" +
        "<div>" + svgDonut(pareto.filas, { colorTexto: "#10151C", colorPie: "#5D697D" }) + "</div>" +
        "<table><tr><th>Causa</th><th class='n'>Paro</th><th class='n'>Costo</th><th class='n'>%</th></tr>" +
          filasPareto + "</table>" +
      "</div>" +

      "<div class='ia'><span class='tag'>✨ Análisis de Planta con IA · Gemini 3.1 Flash-Lite · Google AI</span>" +
        redactarResumen() + "</div>" +

      "<h2>Impacto acumulado por activo</h2>" + barrasActivo +

      "<h2>Pérdida por turno y línea</h2>" +
      "<div class='bvs'>" + barrasTurno + "</div>" +
      "<div class='leyenda'>" + D.LINEAS.map(function (l) {
        return "<span class='punto' style='background:" + COLOR_LINEA[l.id] + "'></span>" + l.nombre;
      }).join(" &nbsp;&nbsp; ") + "</div>" +

      "<h2>Comparativo por línea</h2>" +
      "<table><tr><th>Línea</th><th class='n'>Eventos</th><th class='n'>Paro</th><th class='n'>Costo</th></tr>" +
        filasLinea + "</table>" +

      "<div class='foot'>Modelo de costo: cada activo se valora a su tarifa hora-máquina; el cuello de botella " +
      "de cada línea se valora a la tarifa de esa línea completa (" + dinero(D.tarifaLinea("L-01")) +
      "/h en L-01, " + dinero(D.tarifaLinea("L-02")) + "/h en L-02), que es la suma de sus estaciones. " +
      "El factor de recuperación del 20% corresponde a la reducción del tiempo de detección y despacho; " +
      "no atribuye mejora alguna a la reparación física. Datos simulados de la planta de demostración " +
      "DowntimeCO.</div>" +
      "</body></html>";
  }

  function crearReporteRemoto() {
    return fetch("/api/planta/reportes", {
      method: "POST", headers: { "Content-Type": "application/json" },
        // El PDF usa su propia solicitud Gemini/low; nunca reutiliza la card.
        body: JSON.stringify(parametrosPeriodoFinanzas())
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  $("#btnReporte").addEventListener("click", function () {
    var boton = $("#btnReporte");
    var textoOriginal = boton.textContent;
    boton.disabled = true;
    boton.textContent = "Generando análisis y PDF…";
    crearReporteRemoto().then(function (respuesta) {
      window.open(respuesta.reporte.url, "_blank", "noopener");
    }).catch(function () {
      // El modo local conserva el reporte imprimible como respaldo de la demo.
      var win = window.open("", "_blank", "width=980,height=1100");
      if (!win) { Sesion.notificar("No se pudo abrir el PDF", "El navegador bloqueó la ventana del reporte local.", "error"); return; }
      win.document.write(construirReporte());
      win.document.close(); win.focus();
      setTimeout(function () { win.print(); }, 400);
    }).finally(function () {
      boton.disabled = false;
      boton.textContent = textoOriginal;
    });
  });

  $("#btnEnviarReporte").addEventListener("click", function () {
    var boton = $("#btnEnviarReporte");
    var textoOriginal = boton.textContent;
    boton.disabled = true;
    boton.textContent = "Generando análisis y PDF…";
    crearReporteRemoto().then(function (respuesta) {
      boton.textContent = "Enviando WhatsApp…";
      return fetch("/api/whatsapp/alerta", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reporte_id: respuesta.reporte.id,
          contenido: "*REPORTE EJECUTIVO · DowntimeOS*\n\nAdjunto encontrarás el análisis financiero, los hallazgos y las recomendaciones priorizadas del periodo.\n\n_Archivo disponible por 24 horas._"
        })
      });
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (respuesta) {
      Sesion.notificar("PDF enviado por WhatsApp", "Estado inicial: " + respuesta.mensaje.estado + ".", "ok");
    }).catch(function () {
      Sesion.notificar("No se pudo enviar el reporte", "Revisa Gemini, Storage y la conexión de WhatsApp en el backend.", "error");
    }).finally(function () {
      boton.disabled = false;
      boton.textContent = textoOriginal;
    });
  });

  $("#btnRegenerarIa").addEventListener("click", function () {
    var boton = $("#btnRegenerarIa");
    boton.disabled = true;
    $("#iaTexto").style.opacity = "0.35";
    fetch("/api/ia/resumen", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parametrosPeriodoFinanzas())
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (respuesta) {
      analisisReal = Object.assign({ id: respuesta.analisis.id }, respuesta.analisis.resultado);
    }).catch(function () {
      // Sin credenciales (o en el servidor Python local), permanece la demostración explicable.
      analisisReal = null;
      variante++;
    }).finally(function () {
      pintarResumenIa();
      $("#iaTexto").style.opacity = "1";
      boton.disabled = false;
    });
  });

  /* ------------------------------------------------------------ arranque */
  function pintarTodo() {
    pintarKpis();
    pintarDonut();
    pintarResumenIa();
    pintarBarrasActivo();
    pintarBarrasTurno();
    pintarTablaActivos();
    pintarTarifas();
    pintarBitacora();
  }

  D.cargar().then(function () {
    Sesion.marcarOrigen(D.modo());
    iniciarRango();
    recalcular();
    pintarTodo();
  });
})();
