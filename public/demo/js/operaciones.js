/* ==========================================================================
   Operaciones y Mantenimiento — perfil HH (Helio Huerta)
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
  var TAMANO_PAGINA_BITACORA = 10;
  var paginaBitacora = 0;

  Sesion.alCambiarTurno(function (valor) { filtroTurno = valor; refrescar(); });

  var ETIQUETA_ESTADO = { RUN: "Operando", SETUP: "Setup / SMED", STOP: "Paro" };

  function dosDigitos(n) { return n < 10 ? "0" + n : String(n); }
  function hhmm(min) { return dosDigitos(Math.floor(min / 60)) + ":" + dosDigitos(min % 60); }


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
          D.descartarSolicitud(s.id);
          var sigueParada = (D.estados()[s.activo] || {}).estado === "STOP";
          Sesion.notificar("Reporte descartado", sigueParada
            ? s.activo + " sigue en paro por otro reporte vigente."
            : s.activo + " vuelve a producción; el paro no se registra ni suma costo.", "ok");
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

  /* ------------------------------------------------ mapa fijo de líneas --
     Un prisma por activo, encadenado dentro de su línea. Color por estado
     real (nunca se inventa un tercer estado): RUN verde, STOP amarillo, y
     STOP + cuelloBotella rojo — la misma distinción que ya usa la alerta de
     "⚠ Etapa única" en pintarLineas(). */
  // Geometría del mapa. Es la única fuente: se pasa al CSS como variables para
  // que el ancho de las cajas y las líneas SVG que las unen nunca diverjan.
  var MAPA = { ancho: 76, separacion: 28, altoConector: 44 };
  var SVG_NS = "http://www.w3.org/2000/svg";


  /** Centros horizontales de `n` cajas centradas, relativos al eje (x = 0). */
  function centrosDeNivel(n) {
    var total = n * MAPA.ancho + (n - 1) * MAPA.separacion;
    var centros = [];
    for (var i = 0; i < n; i++) centros.push(-total / 2 + MAPA.ancho / 2 + i * (MAPA.ancho + MAPA.separacion));
    return centros;
  }

  /**
   * Une un nivel con el siguiente: cada caja de arriba baja a una barra común
   * y de la barra sale un tramo a cada caja de abajo. Así se dibujan la
   * convergencia (2 → 1), la ramificación (1 → 3) y el paso directo (1 → 1).
   */
  function conectorEntre(arriba, abajo, cascada) {
    var xArriba = centrosDeNivel(arriba.length);
    var xAbajo = centrosDeNivel(abajo.length);
    var todos = xArriba.concat(xAbajo);
    var mitadAncho = Math.max.apply(null, todos.map(Math.abs)) + MAPA.ancho / 2;
    var ancho = mitadAncho * 2;
    var alto = MAPA.altoConector;
    var medio = alto / 2;

    var svg = nodoSvg("svg", {
      "class": "mapa-conector", width: ancho, height: alto,
      viewBox: "0 0 " + ancho + " " + alto, "aria-hidden": "true"
    });
    var vias = nodoSvg("g", { "class": "mapa-conector__via" });
    var flujo = nodoSvg("g", { "class": "mapa-conector__flujo" });
    svg.appendChild(vias);
    svg.appendChild(flujo);

    // Una máquina "entrega" material solo si opera Y le llega flujo: aguas
    // abajo de un corte, aunque esté encendida, sus flechas quedan quietas.
    function enMarcha(a) { return !!(cascada[a.id] && cascada[a.id].produce); }
    function algunoEnMarcha(lista) { return lista.some(enMarcha); }

    /** Dibuja un tramo en el sentido del flujo: la vía blanca y sus flechas. */
    function tramo(x1, y1, x2, y2, activo) {
      vias.appendChild(nodoSvg("line", { x1: x1 + mitadAncho, y1: y1, x2: x2 + mitadAncho, y2: y2 }));
      flujo.appendChild(flechasEnTramo(x1 + mitadAncho, y1, x2 + mitadAncho, y2, activo));
    }

    // Puntos de la barra horizontal: dónde baja una máquina de origen y dónde
    // sale una hacia la de destino. Una misma x puede ser ambas (C-01 sobre H-02).
    var porX = {};
    function punto(x) {
      var clave = x.toFixed(2);
      if (!porX[clave]) porX[clave] = { x: x, fuentes: [], destino: false };
      return porX[clave];
    }
    arriba.forEach(function (a, i) { punto(xArriba[i]).fuentes.push(a); });
    xAbajo.forEach(function (x) { punto(x).destino = true; });
    var puntos = Object.keys(porX).map(function (k) { return porX[k]; })
      .sort(function (a, b) { return a.x - b.x; });

    // 1 · Bajada de salida: EXCLUSIVA de su máquina. Se mueve solo si esa
    //     máquina está activa; si está en paro, sus flechas quedan quietas.
    arriba.forEach(function (a, i) { tramo(xArriba[i], 0, xArriba[i], medio, enMarcha(a)); });

    // 2 · Barra compartida, partida en sub-tramos entre puntos consecutivos.
    //     Cada sub-tramo corre hacia su salida y lo alimentan las máquinas que
    //     quedan aguas arriba en ese mismo sentido. Se mueve si AL MENOS UNA
    //     de ellas está activa: M-02 en paro no detiene lo que M-01 sigue
    //     mandando a C-01.
    var sentido = [];
    var alimentan = [];
    for (var i = 0; i < puntos.length - 1; i++) sentido.push(sentidoEntre(puntos[i], puntos[i + 1]));
    for (i = 0; i < sentido.length; i++) {
      if (sentido[i] === 1) {
        alimentan[i] = puntos[i].fuentes.concat(i > 0 && sentido[i - 1] === 1 ? alimentan[i - 1] : []);
      }
    }
    for (i = sentido.length - 1; i >= 0; i--) {
      if (sentido[i] === -1) {
        alimentan[i] = puntos[i + 1].fuentes.concat(i + 1 < sentido.length && sentido[i + 1] === -1 ? alimentan[i + 1] : []);
      }
    }
    sentido.forEach(function (s, i) {
      var desde = s === 1 ? puntos[i].x : puntos[i + 1].x;
      var hasta = s === 1 ? puntos[i + 1].x : puntos[i].x;
      tramo(desde, medio, hasta, medio, algunoEnMarcha(alimentan[i]));
    });

    // 3 · Llegada a cada máquina de abajo: recibe lo que baja justo encima de
    //     ella más lo que le traen los sub-tramos de la barra que desembocan ahí.
    xAbajo.forEach(function (x) {
      var k = puntos.indexOf(porX[x.toFixed(2)]);
      var origenes = puntos[k].fuentes
        .concat(k > 0 && sentido[k - 1] === 1 ? alimentan[k - 1] : [])
        .concat(k < sentido.length && sentido[k] === -1 ? alimentan[k] : []);
      tramo(x, medio, x, alto, algunoEnMarcha(origenes));
    });

    return svg;
  }

  /**
   * Sentido del flujo en la barra entre dos puntos vecinos (+1 derecha,
   * -1 izquierda): hacia el punto que solo es salida; si no se distingue así,
   * alejándose del punto donde baja una máquina de origen.
   */
  function sentidoEntre(a, b) {
    var soloSalida = function (p) { return p.destino && !p.fuentes.length; };
    if (soloSalida(b) && !soloSalida(a)) return 1;
    if (soloSalida(a) && !soloSalida(b)) return -1;
    if (a.fuentes.length && !b.fuentes.length) return 1;
    if (b.fuentes.length && !a.fuentes.length) return -1;
    return (a.x + b.x) / 2 < 0 ? -1 : 1;
  }

  // Flechas del flujo: un "tren" de chevrones recortado al largo del tramo que
  // se desliza un paso completo y se repite. Como el patrón es periódico, el
  // ciclo no tiene salto. CSS mueve solo `transform`, que es lo más barato.
  var FLUJO = { paso: 30, periodoMs: 2250 };
  var idsRecorte = 0;

  function nodoSvg(tipo, atributos) {
    var n = document.createElementNS(SVG_NS, tipo);
    Object.keys(atributos || {}).forEach(function (k) { n.setAttribute(k, atributos[k]); });
    return n;
  }

  function flechasEnTramo(x1, y1, x2, y2, activo) {
    var largo = Math.sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1));
    var grupo = nodoSvg("g", { transform: "translate(" + x1 + " " + y1 + ") rotate(" + (Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI) + ")" });
    if (largo < 4) return grupo;

    // El recorte vive en las coordenadas ya rotadas: el tramo siempre va de
    // (0,0) a (largo,0), sin importar si en pantalla es vertical u horizontal.
    var id = "mapaRecorte" + (++idsRecorte);
    var recorte = nodoSvg("clipPath", { id: id });
    recorte.appendChild(nodoSvg("rect", { x: 0, y: -6, width: largo, height: 12 }));
    grupo.appendChild(recorte);

    var ventana = nodoSvg("g", { "clip-path": "url(#" + id + ")" });
    var tren = nodoSvg("g", { "class": "mapa-flecha-tren" + (activo ? " is-activo" : "") });
    for (var x = -FLUJO.paso; x < largo + FLUJO.paso; x += FLUJO.paso) {
      tren.appendChild(nodoSvg("path", { d: "M" + (x - 2.5) + " -3.5 L" + (x + 1.5) + " 0 L" + (x - 2.5) + " 3.5" }));
    }
    // El mapa se repinta con cada sincronización (cada 10 s). Anclar la fase
    // al reloj hace que las flechas continúen donde iban, sin saltar.
    if (activo) tren.style.animationDelay = -(Date.now() % FLUJO.periodoMs) + "ms";
    ventana.appendChild(tren);
    grupo.appendChild(ventana);
    return grupo;
  }

  /* ------------------------------------------------ mapa fijo de líneas --
     Flujo vertical: cada línea baja nivel por nivel (etapa por etapa); los
     equipos de una misma etapa van lado a lado. El color sale de la CASCADA
     de `D.cascadaDeLinea()`: verde operando, amarillo paro con respaldo en
     paralelo, rojo cuando la etapa entera cae (cuello de botella) y gris
     («a la espera») en lo funcional que queda aguas abajo de ese corte. */
  function pintarMapaLineas() {
    var estados = D.estados();
    var caja = $("#mapaLineas");
    if (!caja) return;
    caja.innerHTML = "";
    // En una tableta o celular angosto las líneas se apilan y cada columna
    // ocupa todo el ancho; si no alcanza para tres cajas lado a lado con la
    // separación normal, se juntan un poco en vez de encoger las cajas.
    var anchoColumna = caja.clientWidth >= 644 ? (caja.clientWidth - 24) / 2 : caja.clientWidth;
    MAPA.separacion = anchoColumna < 340 ? 14 : 28;
    caja.style.setProperty("--prisma-ancho", MAPA.ancho + "px");
    caja.style.setProperty("--prisma-separacion", MAPA.separacion + "px");

    D.LINEAS.forEach(function (l) {
      var columna = document.createElement("div");
      columna.className = "mapa-linea";

      var etiqueta = document.createElement("div");
      etiqueta.className = "mapa-linea__id";
      etiqueta.innerHTML = '<b class="mono">' + l.id + "</b> " + (l.nombre.split(" · ")[1] || "");
      columna.appendChild(etiqueta);

      var niveles = D.etapasDeLinea(l.id);
      var cascada = D.cascadaDeLinea(l.id, estados).activos;
      niveles.forEach(function (activos, i) {
        if (i > 0) columna.appendChild(conectorEntre(niveles[i - 1], activos, cascada));

        var nivel = document.createElement("div");
        nivel.className = "mapa-nivel";
        activos.forEach(function (a) {
          var e = estados[a.id] || { estado: "RUN" };
          var nodo = cascada[a.id];
          var prisma = document.createElement("span");
          prisma.className = "mapa-prisma mapa-prisma--" + nodo.tono;
          prisma.textContent = a.id;
          prisma.title = a.id + " · " + a.nombre + " · " + a.etapa + " · " +
            ETIQUETA_ESTADO[e.estado] + " · " + nodo.motivo;
          nivel.appendChild(prisma);
        });
        columna.appendChild(nivel);
      });

      caja.appendChild(columna);
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

      // Misma cascada que el mapa: lo funcional aislado por un corte superior
      // se muestra «A la espera», no como operando.
      var flujoLinea = D.cascadaDeLinea(l.id, estados);
      var cascada = flujoLinea.activos;
      var enEspera = function (a) { return cascada[a.id] && cascada[a.id].tono === "espera"; };

      // Orden por urgencia real: primero lo detenido, luego el setup y lo en espera.
      var orden = activos.slice().sort(function (a, b) {
        var peso = { STOP: 0, SETUP: 1, ESPERA: 2, RUN: 3 };
        var ea = enEspera(a) ? "ESPERA" : (estados[a.id] || { estado: "RUN" }).estado;
        var eb = enEspera(b) ? "ESPERA" : (estados[b.id] || { estado: "RUN" }).estado;
        if (peso[ea] !== peso[eb]) return peso[ea] - peso[eb];
        if (a.cuelloBotella !== b.cuelloBotella) return a.cuelloBotella ? -1 : 1;
        return a.id.localeCompare(b.id);
      });

      orden.forEach(function (a) {
        var e = estados[a.id] || { estado: "RUN", desde: new Date().toISOString() };
        var min = D.minutosEn(e);
        var espera = enEspera(a);
        var clase = e.estado === "STOP" ? " activo-card--stop"
          : (espera ? " activo-card--espera" : (e.estado === "SETUP" ? " activo-card--setup" : ""));
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
          (espera
            ? '<span class="pill-estado pill-estado--espera"><i aria-hidden="true"></i>A la espera</span>' +
              '<div class="activo-card__pie">Funcional · sin material por el paro en ' +
                flujoLinea.etapaCortada + "</div>"
            : '<span class="pill-estado pill-estado--' + e.estado.toLowerCase() + '">' +
                '<i aria-hidden="true"></i>' + ETIQUETA_ESTADO[e.estado] + "</span>" +
              '<div class="activo-card__pie">' + hhmm(min) + " en este estado" +
                (e.causa ? " · " + D.causa(e.causa).etiqueta : "") + "</div>") +
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

    var validaciones = D.solicitudes().filter(function (s) {
      return s.estado === "aprobada" || s.estado === "rechazada";
    });
    var historial = $("#historialValidaciones");
    var limiteValidaciones = 5;
    $("#conteoValidaciones").textContent = validaciones.length
      ? (validaciones.length > limiteValidaciones ? "Últimas " + limiteValidaciones + " de " : "") + validaciones.length + (validaciones.length === 1 ? " decisión" : " decisiones")
      : "Sin decisiones";
    historial.innerHTML = "";

    if (!validaciones.length) {
      historial.innerHTML = "<p class='calc__note'>Aún no hay reportes aprobados ni rechazados.</p>";
    } else {
      validaciones.slice(0, limiteValidaciones).forEach(function (s) {
        var fila = document.createElement("article");
        var aprobada = s.estado === "aprobada";
        var fecha = s.validadaEn ? new Date(s.validadaEn) : null;
        fila.className = "validacion " + (aprobada ? "validacion--aprobada" : "validacion--rechazada");
        fila.innerHTML =
          "<div><b class='mono'>" + s.id + "</b><span>" + s.activo + " · " + s.etiquetaCausa + "</span></div>" +
          "<div class='validacion__meta'><span class='badge-estado badge-estado--" + (aprobada ? "ok" : "neutro") + "'>" + (aprobada ? "Aprobada" : "Rechazada") + "</span>" +
          "<span>" + (fecha ? fecha.toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "Fecha no disponible") + "</span>" +
          "<span>Por " + (s.resueltaPor || "Operaciones") + "</span></div>";
        historial.appendChild(fila);
      });
    }

    var cuerpo = $("#tablaEventos");
    cuerpo.innerHTML = "";

    var paginas = Math.max(1, Math.ceil(lista.length / TAMANO_PAGINA_BITACORA));
    // Si otra persona borra registros mientras este tablero está abierto,
    // evitamos dejar al usuario en una página que ya no existe.
    paginaBitacora = Math.min(paginaBitacora, paginas - 1);
    var desde = paginaBitacora * TAMANO_PAGINA_BITACORA;
    var hasta = Math.min(desde + TAMANO_PAGINA_BITACORA, lista.length);
    $("#estadoPaginacionEventos").textContent = lista.length
      ? "Mostrando " + (desde + 1) + "–" + hasta + " de " + lista.length
      : "Sin registros";
    $("#bitacoraAnterior").disabled = paginaBitacora === 0;
    $("#bitacoraSiguiente").disabled = paginaBitacora >= paginas - 1;

    lista.slice(desde, hasta).forEach(function (ev) {
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

  function iniciarPaginacionBitacora() {
    $("#bitacoraAnterior").addEventListener("click", function () {
      if (paginaBitacora > 0) {
        paginaBitacora -= 1;
        pintarBitacora();
      }
    });
    $("#bitacoraSiguiente").addEventListener("click", function () {
      var total = D.eventos().length;
      if ((paginaBitacora + 1) * TAMANO_PAGINA_BITACORA < total) {
        paginaBitacora += 1;
        pintarBitacora();
      }
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
    var etiquetaIa = Sesion.etiquetaModeloIa(analisis);
    var nivel = etiquetaIa.nivel;
    var modelo = $("#iaSupervisionModelo");
    modelo.hidden = false;
    modelo.textContent = etiquetaIa.modelo + (etiquetaIa.empresa ? " · " + etiquetaIa.empresa + " " : " ");
    if (nivel) {
      var nivelEtiqueta = document.createElement("b");
      nivelEtiqueta.className = "ia__nivel";
      nivelEtiqueta.setAttribute("aria-label", "Nivel de razonamiento " + nivel);
      nivelEtiqueta.textContent = nivel;
      modelo.appendChild(nivelEtiqueta);
    }
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
    $("#iaSupervisionPie").textContent = "Generado por " + etiquetaIa.modelo + (etiquetaIa.empresa ? " · " + etiquetaIa.empresa : "") + (nivel ? " · razonamiento " + nivel : "") + " · " + analisis.advertencia;
  }

  function mostrarCargaAnalisisOperativo(mensaje) {
    var bloque = $("#iaSupervisionTexto");
    var panel = bloque.closest(".ia");
    panel.classList.add("ia--generando");
    panel.setAttribute("aria-busy", "true");
    // El acordeón que envuelve la tarjeta se ve ámbar opaco mientras carga.
    var acordeon = panel.closest(".acordeon");
    if (acordeon) acordeon.classList.add("acordeon--ia-cargando");
    $("#iaSupervisionModelo").hidden = true;
    $("#iaSupervisionPrioridad").hidden = true;
    bloque.innerHTML = '<div class="ia__cargando" role="status"><span class="ia__sparkles" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></svg><svg viewBox="0 0 24 24"><path d="m18 3-.8 2.2a1.4 1.4 0 0 1-.9.9L14 7l2.3.8a1.4 1.4 0 0 1 .9.9L18 11l.8-2.3a1.4 1.4 0 0 1 .9-.9L22 7l-2.3-.8a1.4 1.4 0 0 1-.9-.9Z"/></svg><svg viewBox="0 0 24 24"><path d="m6 14-.7 1.8a1.2 1.2 0 0 1-.8.8L3 17l1.5.5a1.2 1.2 0 0 1 .8.8L6 20l.7-1.7a1.2 1.2 0 0 1 .8-.8L9 17l-1.5-.4a1.2 1.2 0 0 1-.8-.8Z"/></svg></span><div><b>Procesando señales de planta</b><span>' + mensaje + '</span></div></div>';
    $("#iaSupervisionPie").className = "ia__pie mono ia__pie--cargando";
    $("#iaSupervisionPie").textContent = "IA en curso · evaluando riesgos operativos";
  }

  function finalizarCargaAnalisisOperativo() {
    var panel = $("#iaSupervisionTexto").closest(".ia");
    panel.classList.remove("ia--generando");
    panel.removeAttribute("aria-busy");
    var acordeon = panel.closest(".acordeon");
    if (acordeon) acordeon.classList.remove("acordeon--ia-cargando");
  }

  function generarAnalisisOperativo(esManual) {
    var boton = $("#btnAnalisisSupervision");
    if (boton.disabled) return;
    boton.disabled = true;
    boton.textContent = esManual ? "Regenerando análisis…" : "Generando análisis…";
    mostrarCargaAnalisisOperativo(esManual ? "Actualizando prioridades operativas con el estado actual." : "Preparando el análisis operativo inicial.");
    fetch("/api/ia/resumen", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enfoque: "operaciones" })
    }).then(function (respuesta) {
      if (!respuesta.ok) throw new Error("HTTP " + respuesta.status);
      return respuesta.json();
    }).then(function (respuesta) {
      pintarAnalisisSupervision(Object.assign({ modelo: respuesta.analisis.modelo }, respuesta.analisis.resultado));
    }).catch(function () {
      $("#iaSupervisionTexto").textContent = "No se pudo generar el análisis en este momento. El tablero conserva el estado vivo de producción.";
      $("#iaSupervisionPie").className = "ia__pie mono ia__pie--demo";
      $("#iaSupervisionPie").textContent = "Análisis de demostración (sin IA) · Estado actual de activos y solicitudes pendientes.";
    }).finally(function () {
      finalizarCargaAnalisisOperativo();
      boton.disabled = false;
      boton.textContent = "Regenerar análisis con IA";
    });
  }

  $("#btnAnalisisSupervision").addEventListener("click", function () { generarAnalisisOperativo(true); });

  /* ---------------------------------------------------------- despacho */
  $("#btnDespacho").addEventListener("click", function () {
    var estados = D.estados();
    var detenidos = D.ACTIVOS.filter(function (a) {
      return estados[a.id] && estados[a.id].estado === "STOP";
    });

    if (!detenidos.length) {
      Sesion.notificar("Sin paro que despachar", "No hay activos detenidos en este momento.", "warn");
      return;
    }
    var boton = $("#btnDespacho");
    var textoOriginal = boton.textContent;
    boton.disabled = true;
    boton.textContent = "Enviando alerta…";
    fetch("/api/whatsapp/alerta", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alerta: "paros" })
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (respuesta) {
        if (!r.ok) throw new Error(respuesta.error || ("HTTP " + r.status));
        return respuesta;
      });
    }).then(function (respuesta) {
      var cantidad = respuesta.mensaje?.paros_enviados;
      Sesion.notificar("Resumen enviado a Meta", (cantidad ? cantidad + " paros incluidos en el resumen para Brigada. " : "Resumen enviado a Brigada. ") + "La entrega se confirmará por webhook.", "ok");
    }).catch(function (error) {
      Sesion.notificar("No se pudo notificar a Brigada", error.message || "Meta rechazó el envío. Revisa el acceso del número.", "error");
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
          D.crearSolicitud({
            activo: idActivo, causa: causaId,
            reportadoPor: cuenta.nombre + " (Mantenimiento)", validadaPor: cuenta.nombre
          });
          ok.className = "op-ok op-ok--stop";
          ok.innerHTML = "<b>" + idActivo + " marcada en paro.</b> Causa: " +
            D.causa(causaId).etiqueta + ". Queda validada: la capturó Mantenimiento.";
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
      ["mapa de líneas", pintarMapaLineas],
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
    iniciarPaginacionBitacora();
    refrescar();
    generarAnalisisOperativo(false);
    // El piso cambia mientras el tablero está abierto: el operador puede estar
    // capturando en su tableta ahora mismo. Al volver a esta pestaña se lee de
    // inmediato; si permanece visible, también se sincroniza cada 10 segundos.
    function sincronizarPiso() {
      if (D.modo() === "nube") D.cargar().then(refrescar);
      else refrescar();
    }
    window.addEventListener("focus", sincronizarPiso);
    // Girar la tableta cambia el ancho: el mapa recalcula su separación.
    var esperaRedimension = null;
    window.addEventListener("resize", function () {
      clearTimeout(esperaRedimension);
      esperaRedimension = setTimeout(pintarMapaLineas, 150);
    });
    setInterval(function () {
      sincronizarPiso();
    }, 10000);
  });
})();
