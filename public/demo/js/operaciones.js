/* ==========================================================================
   Operaciones y Mantenimiento — perfil AG (Alondra González)
   --------------------------------------------------------------------------
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

  var filtroTurno = Sesion.turno();
  var eventos, resumen;

  Sesion.alCambiarTurno(function (valor) { filtroTurno = valor; refrescar(); });

  var ETIQUETA_ESTADO = { RUN: "Operando", SETUP: "Setup / SMED", STOP: "Paro" };

  function dosDigitos(n) { return n < 10 ? "0" + n : String(n); }
  function hhmm(min) { return dosDigitos(Math.floor(min / 60)) + ":" + dosDigitos(min % 60); }

  Sesion.contexto("DowntimeCO · 2 líneas");

  /** Eventos del turno mostrado en la barra superior. */
  function eventosDelTurno() {
    var todos = D.eventos();
    return filtroTurno === "TODOS"
      ? todos
      : todos.filter(function (e) { return e.turno === filtroTurno; });
  }

  /* --------------------------------------------------------------- KPIs */
  function pintarKpis() {
    var estados = D.estados();
    var detenidos = D.ACTIVOS.filter(function (a) {
      return estados[a.id] && estados[a.id].estado === "STOP";
    });
    var cuellosParados = detenidos.filter(function (a) { return a.cuelloBotella; });

    $("#kpis").innerHTML = "";
    [
      {
        lbl: "Activos detenidos ahora", val: String(detenidos.length),
        clase: detenidos.length ? "kpi__val--red" : "kpi__val--green",
        pie: cuellosParados.length
          ? "Incluye " + cuellosParados.length + " cuello(s) de botella: " +
            cuellosParados.map(function (a) { return a.id; }).join(", ")
          : "Ningún cuello de botella detenido"
      },
      { lbl: "MTTR del periodo", val: numero(resumen.mttrMin) + " min", clase: "",
        pie: "Media de " + resumen.eventos + " intervenciones" },
      { lbl: "MTBF del periodo", val: numero(resumen.mtbfHoras, 1) + " h", clase: "kpi__val--cyan",
        pie: "Entre fallas, sobre horas programadas" },
      { lbl: "Impacto del periodo", val: dinero(resumen.costoTotal), clase: "kpi__val--red",
        pie: numero(resumen.horasParo, 1) + " h de paro en las dos líneas" }
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

  /* ==================== BANDEJA DE SOLICITUDES DE PARO ===================
     REGLA: el cronómetro y la pérdida se calculan contra el timestamp del
     REPORTE del operador. Validar no reinicia nada; solo oficializa la causa.
     ====================================================================== */
  function pintarSolicitudes() {
    // La bandeja es EXCLUSIVAMENTE de pendientes: en cuanto Mantenimiento
    // aprueba o descarta una solicitud, sale de aquí. Un buzón que acumula lo
    // ya resuelto deja de ser una lista de trabajo.
    var lista = D.solicitudes().filter(function (s) {
      return !s.cerrada && s.estado === "pendiente";
    });
    var caja = $("#solicitudes");
    var badge = $("#badgeSolicitudes");

    badge.textContent = lista.length
      ? lista.length + (lista.length === 1 ? " abierta" : " abiertas")
      : "No hay pendientes";
    badge.classList.toggle("acordeon__badge--alerta", lista.length > 0);
    badge.classList.toggle("acordeon__badge--ok", lista.length === 0);

    caja.innerHTML = "";

    if (!lista.length) {
      caja.innerHTML = '<p class="calc__note" style="margin:0">' +
        "Sin solicitudes pendientes. Las que ya se aprobaron o descartaron salen de esta bandeja " +
        "y quedan en la bitácora.</p>";
      return;
    }

    lista.forEach(function (s) {
      var a = D.activo(s.activo);
      // El contenedor del ticket es SIEMPRE neutro. El color vive solo en la
      // insignia de estado: un tablero con cinco tarjetas verdes no comunica
      // nada, y una roja entre neutras se ve desde el otro lado del pasillo.
      var fila = document.createElement("div");
      fila.className = "solicitud";

      fila.innerHTML =
        '<div class="solicitud__id">' +
          '<b class="mono">' + s.activo + "</b>" +
          '<span class="mono">' + s.linea + "</span>" +
        "</div>" +
        '<div class="solicitud__txt">' +
          "<b>" + s.etiquetaCausa + "</b>" +
          "<span>Reportado por " + s.reportadoPor + " a las " +
            s.fecha.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }) +
            (a && a.cuelloBotella ? " · cuello de botella de " + s.linea : "") + "</span>" +
          '<span class="solicitud__folio mono">' + s.id + "</span>" +
        "</div>" +
        '<div class="solicitud__reloj">' +
          '<b class="mono">' + hhmm(s.minutosAbierta) + "</b>" +
          '<span class="mono">' + dinero(s.perdidaAcumulada) + "</span>" +
          '<span class="badge-estado badge-estado--' + s.tonoEstado + '">' + s.etiquetaEstado + "</span>" +
        "</div>" +
        '<div class="solicitud__accion"></div>';

      var accion = fila.querySelector(".solicitud__accion");

      {
        // Tres acciones explícitas sobre un pendiente.
        var si = document.createElement("button");
        si.type = "button";
        si.className = "btn-accion btn-accion--si";
        si.textContent = "Sí, aprobar";
        si.addEventListener("click", function () {
          D.resolverSolicitud(s.id, "aprobada");
          refrescar();
        });

        var no = document.createElement("button");
        no.type = "button";
        no.className = "btn-accion btn-accion--no";
        no.textContent = "No, descartar";
        no.addEventListener("click", function () {
          D.resolverSolicitud(s.id, "rechazada");
          refrescar();
        });

        var cambiar = document.createElement("button");
        cambiar.type = "button";
        cambiar.className = "btn-accion btn-accion--causa";
        cambiar.textContent = "Cambiar causa";

        var cajaCausa = document.createElement("div");
        cajaCausa.className = "solicitud__reclasif";
        cajaCausa.hidden = true;

        var sel = document.createElement("select");
        sel.className = "input mono";
        sel.innerHTML = D.CAUSAS.map(function (c) {
          return '<option value="' + c.id + '"' + (c.id === s.causa ? " selected" : "") + ">" + c.etiqueta + "</option>";
        }).join("");

        // «Otros» abre el campo de texto: sin motivo escrito no se reclasifica.
        var libre = document.createElement("input");
        libre.type = "text";
        libre.className = "input";
        libre.maxLength = 120;
        libre.placeholder = "Describe la causa específica";
        libre.value = s.causaLibre || "";
        libre.hidden = !D.causaEsLibre(s.causa);

        var aplicar = document.createElement("button");
        aplicar.type = "button";
        aplicar.className = "btn-accion btn-accion--causa";
        aplicar.textContent = "Aplicar";

        sel.addEventListener("change", function () {
          libre.hidden = !D.causaEsLibre(sel.value);
          if (!libre.hidden) libre.focus();
        });
        aplicar.addEventListener("click", function () {
          if (D.causaEsLibre(sel.value) && libre.value.trim().length < 3) {
            libre.focus();
            return;
          }
          D.cambiarCausaSolicitud(s.id, sel.value, libre.value.trim() || null);
          refrescar();
        });

        cambiar.addEventListener("click", function () {
          cajaCausa.hidden = !cajaCausa.hidden;
          if (!cajaCausa.hidden) sel.focus();
        });

        cajaCausa.appendChild(sel);
        cajaCausa.appendChild(libre);
        cajaCausa.appendChild(aplicar);

        accion.appendChild(si);
        accion.appendChild(no);
        accion.appendChild(cambiar);
        accion.appendChild(cajaCausa);
      }

      caja.appendChild(fila);
    });
  }

  /* ------------------------------------ estado del piso, por línea ----- */
  function pintarLineas() {
    var estados = D.estados();
    var caja = $("#lineas");
    caja.innerHTML = "";

    D.LINEAS.forEach(function (l) {
      var bloque = document.createElement("div");
      bloque.className = "linea-bloque";

      var activos = D.activosDeLinea(l.id);
      var detenidos = activos.filter(function (a) {
        return estados[a.id] && estados[a.id].estado === "STOP";
      }).length;
      var capacidad = Math.round(D.capacidadDisponibleDeLinea(l.id, estados) * 100);

      bloque.innerHTML =
        '<div class="linea-bloque__head">' +
          "<b>" + l.nombre + "</b>" +
          '<span class="mono">' + activos.length + " activos · " + l.descripcion + "</span>" +
          (detenidos
            ? '<span class="pill-estado pill-estado--stop"><i aria-hidden="true"></i>' +
              (capacidad ? capacidad + "% de capacidad" : "Línea detenida") + "</span>"
            : '<span class="pill-estado pill-estado--run"><i aria-hidden="true"></i>Sin paros</span>') +
        "</div>";

      var mosaico = document.createElement("div");
      mosaico.className = "mosaico";

      // Orden por urgencia real: primero lo detenido, luego el setup.
      var orden = activos.slice().sort(function (a, b) {
        var peso = { STOP: 0, SETUP: 1, RUN: 2 };
        var ea = (estados[a.id] || { estado: "RUN" }).estado;
        var eb = (estados[b.id] || { estado: "RUN" }).estado;
        if (peso[ea] !== peso[eb]) return peso[ea] - peso[eb];
        if (a.cuelloBotella !== b.cuelloBotella) return a.cuelloBotella ? -1 : 1;
        return a.id.localeCompare(b.id);
      });

      orden.forEach(function (a) {
        var e = estados[a.id] || { estado: "RUN", desde: new Date().toISOString() };
        var min = D.minutosEn(e);
        var clase = e.estado === "STOP" ? " activo-card--stop" : (e.estado === "SETUP" ? " activo-card--setup" : "");
        var costoActual = e.estado === "STOP" ? (min / 60) * D.tarifaAplicable(a.id) : 0;

        // REGLA: la etiqueta de cuello de botella es una ALERTA, no un rótulo.
        // Solo se muestra si el activo está en paro y por tanto estrangulando
        // la línea. Un cuello de botella operando no es una incidencia.
        var esAlertaCuello = a.cuelloBotella && e.estado === "STOP";

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
          (esAlertaCuello
            ? '<span class="activo-card__cuello">⚠ Etapa única · línea detenida</span>'
            : (e.estado === "STOP"
              ? '<span class="activo-card__cuello activo-card__cuello--paralelo">Capacidad de etapa: ' +
                Math.round((1 - a.impactoCapacidad) * 100) + "% restante</span>"
              : ""));
        mosaico.appendChild(div);
      });

      bloque.appendChild(mosaico);
      caja.appendChild(bloque);
    });

    $("#relojEstado").textContent = "Actualizado " + new Date().toLocaleTimeString("es-MX");
  }

  /* ------------------------------------------------------------ bitácora */
  function pintarBitacora() {
    var lista = D.eventos();
    $("#conteoEventos").textContent = lista.length + " registros";

    var cuerpo = $("#tablaEventos");
    cuerpo.innerHTML = "";

    lista.slice(0, 60).forEach(function (ev) {
      var tr = document.createElement("tr");
      if (ev.origen === "demo") tr.className = "es-demo";
      tr.innerHTML =
        "<td class='mono'>" + ev.id + "</td>" +
        "<td class='mono apagado'>" + ev.fecha.toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) + "</td>" +
        "<td class='mono'>" + ev.linea + "</td>" +
        "<td class='mono'>" + ev.turno + "</td>" +
        "<td class='mono'>" + ev.activo + "</td>" +
        "<td>" + ev.etiquetaCausa + (ev.retroactivo ? " <span class='apagado'>· retro</span>" : "") + "</td>" +
        '<td class="num">' + numero(ev.minutos) + "</td>" +
        '<td class="dinero">' + dinero(ev.costo) + "</td>";
      cuerpo.appendChild(tr);
    });
  }

  /* -------------------------------------------------- turnos (MTTR) ---- */
  function pintarTurnos() {
    // Compara SIEMPRE los tres turnos, aunque la vista esté filtrada a uno:
    // filtrar y luego agrupar por turno dejaba una sola barra, que no compara
    // nada. El valor de este bloque está justamente en el contraste.
    var turnos = D.porTurno(D.eventos()).filter(function (t) { return t.eventos > 0; });
    var peorMttr = turnos.reduce(function (m, t) { return Math.max(m, t.mttrMin); }, 1);
    var caja = $("#turnos");
    caja.innerHTML = "";

    turnos.forEach(function (t, i) {
      var fila = document.createElement("div");
      fila.className = "turno-fila";
      fila.innerHTML =
        '<div class="turno-fila__id' + (i === 0 ? " turno-fila__id--top" : "") + '">' + t.turno + "</div>" +
        '<div class="turno-fila__barra"><i style="width:' + ((t.mttrMin / peorMttr) * 100).toFixed(1) + '%"></i></div>' +
        '<div class="turno-fila__val">' + numero(t.mttrMin) + " min</div>" +
        '<div class="turno-fila__meta">' + t.eventos + " eventos · " + numero(t.minutos) +
          " min de paro · " + dinero(t.costo) + "</div>";
      caja.appendChild(fila);
    });

    if (turnos.length) {
      $("#turnosNota").textContent =
        "El turno " + turnos[0].turno + " resuelve en " + numero(turnos[0].mttrMin) +
        " min de media, el mejor de los " + turnos.length + " con actividad registrada.";
    }
  }

  /* -------------------------------- IA · supervisión actual ---------- */
  function escaparHtml(texto) {
    var nodo = document.createElement("span");
    nodo.textContent = String(texto || "");
    return nodo.innerHTML;
  }

  function grupoPrioridad(clase, titulo, elementos, vacio) {
    var lista = Array.isArray(elementos) ? elementos : [];
    var sinElementos = !lista.length;
    return '<details class="ia__grupo ' + clase + (sinElementos ? ' ia__grupo--vacio' : '') + '" open>' +
      '<summary><span>' + titulo + '</span><b>' + (sinElementos ? 'Sin pendientes' : lista.length + ' ' + (lista.length === 1 ? 'acción' : 'acciones')) + '</b></summary>' +
      '<div class="ia__grupo-contenido">' + (sinElementos ? '<p>' + escaparHtml(vacio) + '</p>' : '<ul>' + lista.map(function (item) {
        return '<li>' + escaparHtml(item) + '</li>';
      }).join('') + '</ul>') + '</div></details>';
  }

  function pintarAnalisisSupervision(analisis) {
    var prioridad = String(analisis.prioridad || "media").toLowerCase();
    var hallazgos = Array.isArray(analisis.hallazgos) ? analisis.hallazgos : [];
    var recomendaciones = Array.isArray(analisis.recomendaciones) ? analisis.recomendaciones : [];
    var criticos = Array.isArray(analisis.acciones_criticas) ? analisis.acciones_criticas : [];
    var seguimiento = Array.isArray(analisis.acciones_seguimiento) ? analisis.acciones_seguimiento : [];
    var consideraciones = Array.isArray(analisis.consideraciones) ? analisis.consideraciones : [];
    $("#iaSupervisionTexto").innerHTML = '<div class="ia__bloque ia__bloque--resumen"><p>' + escaparHtml(analisis.resumen) + '</p></div>' +
      grupoPrioridad('ia__grupo--hallazgos', 'Señales detectadas', hallazgos, 'Sin señales suficientes para clasificar.') +
      grupoPrioridad(criticos.length ? 'ia__grupo--critico' : 'ia__grupo--estable', 'Acción inmediata', criticos, 'Sin acción inmediata · operación en monitoreo preventivo.') +
      grupoPrioridad('ia__grupo--prioridad', 'Atender en este turno', recomendaciones, 'Sin acciones prioritarias pendientes.') +
      grupoPrioridad('ia__grupo--seguimiento', 'Seguimiento y validación', seguimiento.concat(consideraciones), 'Sin seguimiento adicional requerido.');
    var etiqueta = $("#iaSupervisionPrioridad");
    etiqueta.hidden = false;
    etiqueta.className = "ia__prioridad ia__prioridad--" + prioridad;
    etiqueta.textContent = "Prioridad operativa " + prioridad;
    $("#iaSupervisionPie").className = "ia__pie mono ia__pie--real";
    $("#iaSupervisionPie").textContent = "Generado por Gemini 3.1 Flash-Lite · razonamiento low · " + analisis.advertencia;
  }

  $("#btnAnalisisSupervision").addEventListener("click", function () {
    var boton = $("#btnAnalisisSupervision");
    boton.disabled = true;
      boton.textContent = "Analizando riesgos…";
    fetch("/api/ia/resumen", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enfoque: "operaciones" })
    }).then(function (respuesta) {
      if (!respuesta.ok) throw new Error("HTTP " + respuesta.status);
      return respuesta.json();
    }).then(function (respuesta) {
      pintarAnalisisSupervision(respuesta.analisis.resultado);
    }).catch(function () {
      $("#iaSupervisionTexto").textContent = "No se pudo generar el análisis en este momento. El tablero conserva el estado vivo de producción.";
      $("#iaSupervisionPie").className = "ia__pie mono ia__pie--demo";
      $("#iaSupervisionPie").textContent = "Análisis de demostración (sin IA) · Estado actual de activos y solicitudes pendientes.";
    }).finally(function () {
      boton.disabled = false;
      boton.textContent = "Analizar riesgos operativos";
    });
  });

  /* ---------------------------------------------------------- despacho */
  $("#btnDespacho").addEventListener("click", function () {
    var estados = D.estados();
    var detenidos = D.ACTIVOS.filter(function (a) {
      return estados[a.id] && estados[a.id].estado === "STOP";
    });

    if (!detenidos.length) {
      alert("No hay activos detenidos. No hay nada que despachar.");
      return;
    }
    // Se prioriza el cuello de botella: es lo que distingue al producto de una
    // lista de tickets por orden de llegada.
    var critico = detenidos.filter(function (a) { return a.cuelloBotella; })[0] || detenidos[0];
    var min = D.minutosEn(estados[critico.id]);

    var boton = $("#btnDespacho");
    var textoOriginal = boton.textContent;
    boton.disabled = true;
    boton.textContent = "Enviando alerta…";
    fetch("/api/whatsapp/alerta", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activo_id: critico.id })
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (respuesta) {
      alert("Alerta de WhatsApp enviada. Estado inicial: " + respuesta.mensaje.estado + ".");
    }).catch(function () {
      alert("No se pudo enviar la alerta. Configura Twilio y las variables del backend para activarla.");
    }).finally(function () {
      boton.disabled = false;
      boton.textContent = textoOriginal;
    });
  });

  /* ============ PANEL DE CAPTURA CON PRIVILEGIOS DE EDICIÓN =============
     Replica la tableta de piso sin filtro de línea. Mantenimiento puede
     reclasificar causas y corregir tiempos mal capturados.
     ====================================================================== */
  function iniciarPanelAdmin() {
    var modal = $("#modalAdmin");

    $("#adminActivo").innerHTML = D.LINEAS.map(function (l) {
      return '<optgroup label="' + l.nombre + '">' +
        D.activosDeLinea(l.id).map(function (a) {
          return '<option value="' + a.id + '">' + a.id + " · " + a.nombre + "</option>";
        }).join("") + "</optgroup>";
    }).join("");

    $("#adminCausa").innerHTML = D.CAUSAS.map(function (c) {
      return '<option value="' + c.id + '">' + c.etiqueta + "</option>";
    }).join("");

    function abrir() {
      pintarAdminEventos();
      $("#adminOk").hidden = true;
      modal.classList.add("is-open");
      document.body.style.overflow = "hidden";
    }
    function cerrar() {
      modal.classList.remove("is-open");
      document.body.style.overflow = "";
      refrescar();
    }

    $("#btnPanelAdmin").addEventListener("click", abrir);
    document.querySelectorAll("[data-cerrar-admin]").forEach(function (b) {
      b.addEventListener("click", cerrar);
    });
    modal.addEventListener("mousedown", function (e) { if (e.target === modal) cerrar(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && modal.classList.contains("is-open")) cerrar();
    });

    // Mismos tres botones que la tableta de piso.
    var retro = Retroactivo.iniciar({
      nota: "Registro retroactivo capturado por " + cuenta.nombre + " (Mantenimiento).",
      alGuardar: function (evento, minutos) {
        $("#adminOk").className = "op-ok op-ok--retro";
        $("#adminOk").innerHTML = "<b>Registro retroactivo guardado.</b> " + evento.activo + " · " +
          Retroactivo.hhmm(minutos) + ", folio <b class='mono'>" + evento.id + "</b>.";
        $("#adminOk").hidden = false;
        pintarAdminEventos();
      }
    });

    document.querySelectorAll("#adminSemaforo button").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var idActivo = $("#adminActivo").value;
        var accion = btn.dataset.accion;

        if (accion === "RETRO") return retro.abrir(idActivo);

        var causaId = accion === "RUN" ? null : $("#adminCausa").value;
        var previo = D.estados()[idActivo];
        var ok = $("#adminOk");

        // Cerrar un paro desde aquí escribe el evento igual que en la tableta:
        // el tiempo capturado es el que corrió desde el reporte del operador.
        if (accion === "RUN" && previo && previo.estado === "STOP") {
          var minutos = D.minutosEn(previo);
          var ev = D.registrar({
            activo: idActivo,
            causa: previo.causa || "espera-material",
            minutos: minutos,
            inicio: previo.desde,
            nota: "Cerrado por " + cuenta.nombre + " desde el panel de Mantenimiento."
          });
          D.cerrarSolicitud(idActivo);
          ok.className = "op-ok op-ok--run";
          ok.innerHTML = "<b>" + idActivo + " de vuelta en producción.</b> Paro de " +
            hhmm(minutos) + " guardado con folio <b class='mono'>" + ev.id + "</b>.";
        } else if (accion === "STOP") {
          D.crearSolicitud({ activo: idActivo, causa: causaId, reportadoPor: cuenta.nombre + " (Mantenimiento)" });
          ok.className = "op-ok op-ok--stop";
          ok.innerHTML = "<b>" + idActivo + " marcada en paro.</b> Causa: " +
            D.causa(causaId).etiqueta + ". Entra a la bandeja como pendiente.";
        } else {
          ok.className = "op-ok op-ok--run";
          ok.innerHTML = "<b>" + idActivo + " sigue operando.</b> No había ningún paro abierto que cerrar.";
        }

        D.cambiarEstado(idActivo, accion === "STOP" ? "STOP" : "RUN", causaId);
        ok.hidden = false;
        pintarAdminEventos();
      });
    });
  }

  function pintarAdminEventos() {
    var cuerpo = $("#adminEventos");
    var capturados = D.eventosCapturados();
    cuerpo.innerHTML = "";

    if (!capturados.length) {
      cuerpo.innerHTML = '<tr><td colspan="5" class="apagado" style="white-space:normal">' +
        "Todavía no hay eventos capturados en esta sesión. El histórico sembrado no es editable." +
        "</td></tr>";
      return;
    }

    capturados.forEach(function (ev) {
      var tr = document.createElement("tr");

      var sel = document.createElement("select");
      sel.className = "input mono";
      sel.style.padding = "5px 8px";
      sel.innerHTML = D.CAUSAS.map(function (c) {
        return '<option value="' + c.id + '"' + (c.id === ev.causa ? " selected" : "") + ">" + c.etiqueta + "</option>";
      }).join("");

      var libre = document.createElement("input");
      libre.type = "text";
      libre.className = "input";
      libre.maxLength = 120;
      libre.placeholder = "Causa específica";
      libre.value = ev.causaLibre || "";
      libre.style.cssText = "margin-top:6px;padding:5px 8px";
      libre.hidden = !D.causaEsLibre(ev.causa);
      sel.addEventListener("change", function () {
        libre.hidden = !D.causaEsLibre(sel.value);
      });

      var min = document.createElement("input");
      min.type = "number";
      min.className = "input mono";
      min.min = "1";
      min.max = "720";
      min.value = ev.minutos;
      min.style.cssText = "width:80px;padding:5px 8px;text-align:right";

      var guardar = document.createElement("button");
      guardar.type = "button";
      guardar.className = "btn btn--ghost";
      guardar.style.cssText = "padding:6px 14px;font-size:.8rem";
      guardar.textContent = "Guardar";
      guardar.addEventListener("click", function () {
        if (D.causaEsLibre(sel.value) && libre.value.trim().length < 3) {
          libre.focus();
          return;
        }
        D.editar(ev.id, { causa: sel.value, causaLibre: libre.value.trim() || null, minutos: min.value });
        guardar.textContent = "Guardado";
        setTimeout(function () { guardar.textContent = "Guardar"; }, 1400);
        refrescar();
      });

      var tdFolio = document.createElement("td");
      tdFolio.className = "mono";
      tdFolio.textContent = ev.id;
      var tdActivo = document.createElement("td");
      tdActivo.className = "mono";
      tdActivo.textContent = ev.activo + " · " + ev.linea;
      var tdCausa = document.createElement("td");
      tdCausa.appendChild(sel);
      tdCausa.appendChild(libre);
      var tdMin = document.createElement("td");
      tdMin.style.textAlign = "right";
      tdMin.appendChild(min);
      var tdBtn = document.createElement("td");
      tdBtn.appendChild(guardar);

      [tdFolio, tdActivo, tdCausa, tdMin, tdBtn].forEach(function (td) { tr.appendChild(td); });
      cuerpo.appendChild(tr);
    });
  }

  /* ------------------------------------------------------------ arranque */
  /**
   * Cada bloque se pinta aislado: si uno falla, los otros tres siguen. Antes
   * una excepción en la bandeja dejaba el tablero entero en blanco, que es el
   * peor modo de fallar para una pantalla de operación.
   */
  function refrescar() {
    eventos = eventosDelTurno();
    resumen = D.resumen(eventos);

    [
      ["KPIs", pintarKpis],
      ["solicitudes", pintarSolicitudes],
      ["líneas", pintarLineas],
      ["bitácora", pintarBitacora],
      ["turnos", pintarTurnos]
    ].forEach(function (par) {
      try {
        par[1]();
      } catch (e) {
        if (window.console) console.error("[operaciones] falló el bloque de " + par[0], e);
      }
    });
  }

  D.cargar().then(function () {
    Sesion.marcarOrigen(D.modo());
    iniciarPanelAdmin();
    refrescar();
    // El piso cambia mientras el tablero está abierto: el operador puede estar
    // capturando en su tableta ahora mismo. Al volver a esta pestaña se lee de
    // inmediato; si permanece visible, también se sincroniza cada 10 segundos.
    function sincronizarPiso() {
      if (D.modo() === "nube") D.cargar().then(refrescar);
      else refrescar();
    }
    window.addEventListener("focus", sincronizarPiso);
    setInterval(function () {
      sincronizarPiso();
    }, 10000);
  });
})();
