/* ==========================================================================
   DowntimeCO — Planta de simulación de la demo
   --------------------------------------------------------------------------
   FUENTE ÚNICA DE VERDAD. Las tres vistas por rol leen de aquí; ninguna
   escribe cifras a mano.

   DOS LÍNEAS DE PRODUCCIÓN
   - Línea 01 · Estructural: ocho activos en cuatro etapas. Cuello: sierra C-01.
   - Línea 02 · Ensamble ligero: cuatro activos. Cuello: banco de pruebas R-01.

   MODELO DE COSTO — REGLA DEL CUELLO DE BOTELLA
   Cada activo tiene su tarifa hora-máquina. El activo marcado `cuelloBotella`
   NO tiene equipo redundante en su etapa: cuando se detiene, se detiene su
   línea completa, así que su paro se valora a la SUMA de las tarifas de esa
   línea, no a la suya. Los demás se absorben con su gemelo y cuestan lo suyo.

   Esa regla es la que hace que el Registro #01 dé los $4,796 USD del PRD:
       255 min / 60 × $19,750 MXN (tarifa de Línea 01) ÷ 17.50 = $4,796 USD

   TRACKING TEMPORAL DESACOPLADO (regla de negocio)
   El cronómetro y la pérdida de un paro corren desde el instante en que el
   OPERADOR lo registró, no desde que Mantenimiento lo valida. Validar solo
   oficializa la causa raíz técnica; si el reloj esperara a la validación, la
   planta perdería tiempo auditable justo en los paros peor atendidos, que son
   los que más importa medir.

   PERSISTENCIA
   Lo que se captura en la demo va a localStorage, no a la API: esto es una
   simulación y no debe ensuciar Supabase ni leads.json.
   ========================================================================== */
(function (global) {
  "use strict";

  var LS_EVENTOS = "downtimeco_demo_eventos";
  var LS_ESTADOS = "downtimeco_demo_estados";
  var LS_SOLICITUDES = "downtimeco_demo_solicitudes";

  var TIPO_CAMBIO_USD = 17.5;
  var HORAS_TURNO = 8;
  var TURNOS_DIA = 2;
  var DIAS_HISTORIAL = 30;

  /* ------------------------------------------------------------- líneas --- */
  var LINEAS = [
    { id: "L-01", nombre: "Línea 01 · Estructural",    descripcion: "Maquinado, corte, curado y pintura" },
    { id: "L-02", nombre: "Línea 02 · Ensamble ligero", descripcion: "Ensamble, pruebas y empaque" }
  ];

  /* ------------------------------------------------------------- activos --- */
  var ACTIVOS = [
    // --- Línea 01 · ocho activos en cuatro etapas -------------------------
    { id: "M-01", linea: "L-01", nombre: "Centro de maquinado 01",    etapa: "Maquinado", tarifa: 2450, cuelloBotella: false },
    { id: "M-02", linea: "L-01", nombre: "Centro de maquinado 02",    etapa: "Maquinado", tarifa: 2450, cuelloBotella: false },
    { id: "C-01", linea: "L-01", nombre: "Sierra de corte automatizado", etapa: "Corte",  tarifa: 3900, cuelloBotella: true  },
    { id: "H-01", linea: "L-01", nombre: "Horno de curado 01",        etapa: "Curado",    tarifa: 1850, cuelloBotella: false },
    { id: "H-02", linea: "L-01", nombre: "Horno de curado 02",        etapa: "Curado",    tarifa: 1850, cuelloBotella: false },
    { id: "H-03", linea: "L-01", nombre: "Horno de curado 03",        etapa: "Curado",    tarifa: 1850, cuelloBotella: false },
    { id: "P-01", linea: "L-01", nombre: "Cabina de pintura 01",      etapa: "Pintura",   tarifa: 2700, cuelloBotella: false },
    { id: "P-02", linea: "L-01", nombre: "Cabina de pintura 02",      etapa: "Pintura",   tarifa: 2700, cuelloBotella: false },

    // --- Línea 02 · cuatro activos ----------------------------------------
    { id: "E-01", linea: "L-02", nombre: "Estación de ensamble 01",   etapa: "Ensamble",  tarifa: 1650, cuelloBotella: false },
    { id: "E-02", linea: "L-02", nombre: "Estación de ensamble 02",   etapa: "Ensamble",  tarifa: 1650, cuelloBotella: false },
    { id: "R-01", linea: "L-02", nombre: "Banco de pruebas funcional", etapa: "Pruebas",  tarifa: 2100, cuelloBotella: true  },
    { id: "K-01", linea: "L-02", nombre: "Empaque y etiquetado",      etapa: "Empaque",   tarifa: 1200, cuelloBotella: false }
  ];

  /* -------------------------------------------------------------- causas ---
     Catálogo cerrado: es lo que hace posible el Pareto. Texto libre no agrupa. */
  var CAUSAS = [
    { id: "ruptura-herramental", etiqueta: "Ruptura de herramental" },
    { id: "espera-material",     etiqueta: "Espera de material" },
    { id: "cambio-modelo",       etiqueta: "Cambio de modelo sin SMED" },
    { id: "ajuste-calidad",      etiqueta: "Ajuste de calidad / calibración" },
    { id: "falla-electrica",     etiqueta: "Falla eléctrica menor" },
    { id: "falta-operador",      etiqueta: "Falta de operador" }
  ];

  /* ----------------------------------------------------------- histórico ---
     `dias` son días hacia atrás desde hoy: la demo siempre se ve reciente. */
  var SEMILLA = [
    // Línea 01
    { dias: 27, hora: "08:20", activo: "C-01", causa: "ruptura-herramental", minutos: 255, nota: "Ruptura de sierra circular. Cambio de disco y realineación." },
    { dias: 26, hora: "10:15", activo: "M-02", causa: "cambio-modelo",       minutos: 120 },
    { dias: 25, hora: "07:30", activo: "H-01", causa: "espera-material",     minutos: 180 },
    { dias: 24, hora: "14:35", activo: "M-01", causa: "cambio-modelo",       minutos: 90 },
    { dias: 23, hora: "16:45", activo: "P-02", causa: "falla-electrica",     minutos: 85 },
    { dias: 22, hora: "19:20", activo: "H-03", causa: "espera-material",     minutos: 145 },
    { dias: 21, hora: "15:40", activo: "C-01", causa: "ruptura-herramental", minutos: 95 },
    { dias: 19, hora: "11:00", activo: "M-02", causa: "cambio-modelo",       minutos: 150 },
    { dias: 18, hora: "12:30", activo: "P-01", causa: "falla-electrica",     minutos: 70 },
    { dias: 17, hora: "21:40", activo: "M-01", causa: "falta-operador",      minutos: 55 },
    { dias: 16, hora: "09:40", activo: "H-02", causa: "falla-electrica",     minutos: 65 },
    { dias: 14, hora: "20:10", activo: "C-01", causa: "ruptura-herramental", minutos: 70 },
    { dias: 13, hora: "20:05", activo: "P-02", causa: "ajuste-calidad",      minutos: 95 },
    { dias: 12, hora: "13:20", activo: "M-02", causa: "cambio-modelo",       minutos: 110 },
    { dias: 11, hora: "21:15", activo: "H-01", causa: "espera-material",     minutos: 200 },
    { dias: 10, hora: "11:25", activo: "P-02", causa: "falla-electrica",     minutos: 110 },
    { dias:  9, hora: "08:45", activo: "M-01", causa: "ajuste-calidad",      minutos: 35 },
    { dias:  8, hora: "09:05", activo: "C-01", causa: "ajuste-calidad",      minutos: 45 },
    { dias:  7, hora: "06:50", activo: "H-03", causa: "espera-material",     minutos: 160 },
    { dias:  6, hora: "17:55", activo: "P-01", causa: "falta-operador",      minutos: 60 },
    { dias:  5, hora: "15:15", activo: "M-01", causa: "cambio-modelo",       minutos: 130 },
    { dias:  4, hora: "14:10", activo: "H-02", causa: "ajuste-calidad",      minutos: 50 },
    { dias:  3, hora: "16:30", activo: "C-01", causa: "ruptura-herramental", minutos: 60 },
    { dias:  2, hora: "13:40", activo: "P-01", causa: "falla-electrica",     minutos: 55 },
    { dias:  2, hora: "10:50", activo: "M-02", causa: "cambio-modelo",       minutos: 100 },
    { dias:  1, hora: "07:50", activo: "C-01", causa: "espera-material",     minutos: 40 },

    // Línea 02
    { dias: 28, hora: "09:10", activo: "R-01", causa: "ajuste-calidad",      minutos: 85 },
    { dias: 24, hora: "16:20", activo: "E-02", causa: "falta-operador",      minutos: 70 },
    { dias: 20, hora: "11:45", activo: "R-01", causa: "falla-electrica",     minutos: 55 },
    { dias: 18, hora: "08:30", activo: "K-01", causa: "espera-material",     minutos: 130 },
    { dias: 15, hora: "14:50", activo: "E-01", causa: "cambio-modelo",       minutos: 95 },
    { dias: 11, hora: "10:05", activo: "R-01", causa: "ajuste-calidad",      minutos: 60 },
    { dias:  9, hora: "19:30", activo: "E-02", causa: "falta-operador",      minutos: 45 },
    { dias:  6, hora: "13:15", activo: "K-01", causa: "espera-material",     minutos: 110 },
    { dias:  4, hora: "07:40", activo: "R-01", causa: "falla-electrica",     minutos: 40 },
    { dias:  1, hora: "15:25", activo: "E-01", causa: "cambio-modelo",       minutos: 80 }
  ];

  /* -------------------------------------------------------------- estado ---
     Estado operativo actual del piso. El operador lo cambia desde su tableta y
     el gerente lo ve en su tablero: es el mismo dato, no dos pantallas. */
  var ESTADOS_INICIALES = {
    "M-01": { estado: "RUN",   desdeMin: 212 },
    "M-02": { estado: "SETUP", desdeMin: 24, causa: "cambio-modelo" },
    "C-01": { estado: "STOP",  desdeMin: 74, causa: "ruptura-herramental" },
    "H-01": { estado: "RUN",   desdeMin: 340 },
    "H-02": { estado: "RUN",   desdeMin: 188 },
    "H-03": { estado: "RUN",   desdeMin: 95 },
    "P-01": { estado: "RUN",   desdeMin: 410 },
    "P-02": { estado: "RUN",   desdeMin: 156 },
    "E-01": { estado: "RUN",   desdeMin: 265 },
    "E-02": { estado: "RUN",   desdeMin: 130 },
    "R-01": { estado: "STOP",  desdeMin: 31, causa: "ajuste-calidad" },
    "K-01": { estado: "RUN",   desdeMin: 88 }
  };

  // Bandeja inicial de Mantenimiento: los dos paros abiertos ya reportados.
  var SOLICITUDES_INICIALES = [
    { activo: "C-01", causa: "ruptura-herramental", desdeMin: 74, reportadoPor: "Helio Emmanuel Huerta" },
    { activo: "R-01", causa: "ajuste-calidad",      desdeMin: 31, reportadoPor: "Helio Emmanuel Huerta" }
  ];

  // ------------------------------------------------------------- helpers ---
  function leerLS(clave, porDefecto) {
    try {
      var crudo = global.localStorage.getItem(clave);
      return crudo ? JSON.parse(crudo) : porDefecto;
    } catch (e) {
      return porDefecto;   // modo privado: la demo sigue con la semilla
    }
  }

  function escribirLS(clave, valor) {
    try {
      global.localStorage.setItem(clave, JSON.stringify(valor));
      return true;
    } catch (e) {
      return false;
    }
  }

  function activo(id) {
    for (var i = 0; i < ACTIVOS.length; i++) if (ACTIVOS[i].id === id) return ACTIVOS[i];
    return null;
  }

  function linea(id) {
    for (var i = 0; i < LINEAS.length; i++) if (LINEAS[i].id === id) return LINEAS[i];
    return { id: id, nombre: id, descripcion: "" };
  }

  function activosDeLinea(idLinea) {
    return ACTIVOS.filter(function (a) { return a.linea === idLinea; });
  }

  function causa(id) {
    for (var i = 0; i < CAUSAS.length; i++) if (CAUSAS[i].id === id) return CAUSAS[i];
    return { id: id, etiqueta: id };
  }

  /** Suma de las tarifas de una línea: lo que cuesta esa línea detenida una hora. */
  function tarifaLinea(idLinea) {
    return activosDeLinea(idLinea).reduce(function (t, a) { return t + a.tarifa; }, 0);
  }

  /** Tarifa aplicable a un paro: la de la línea si el activo es su cuello de botella. */
  function tarifaAplicable(idActivo) {
    var a = activo(idActivo);
    if (!a) return 0;
    return a.cuelloBotella ? tarifaLinea(a.linea) : a.tarifa;
  }

  function costo(evento) {
    return (evento.minutos / 60) * tarifaAplicable(evento.activo);
  }

  /** T1 06:00–14:00 · T2 14:00–22:00 · T3 22:00–06:00 */
  function turnoDeFecha(fecha) {
    var h = fecha.getHours();
    if (h >= 6 && h < 14) return "T1";
    if (h >= 14 && h < 22) return "T2";
    return "T3";
  }

  function fechaDesdeSemilla(reg) {
    var partes = reg.hora.split(":");
    var d = new Date();
    d.setDate(d.getDate() - reg.dias);
    d.setHours(Number(partes[0]), Number(partes[1]), 0, 0);
    return d;
  }

  function normalizar(evento) {
    var fecha = new Date(evento.inicio);
    var a = activo(evento.activo);
    return {
      id: evento.id,
      activo: evento.activo,
      linea: a ? a.linea : null,
      causa: evento.causa,
      minutos: Number(evento.minutos),
      inicio: evento.inicio,
      fecha: fecha,
      turno: evento.turno || turnoDeFecha(fecha),
      nota: evento.nota || "",
      origen: evento.origen || "historico",
      retroactivo: !!evento.retroactivo,
      costo: costo(evento)
    };
  }

  /** Histórico sembrado + lo capturado en la tableta, más reciente primero. */
  function eventos(filtroLinea) {
    var base = SEMILLA.map(function (reg, i) {
      var fecha = fechaDesdeSemilla(reg);
      return normalizar({
        id: "EV-" + ("000" + (SEMILLA.length - i)).slice(-4),
        activo: reg.activo,
        causa: reg.causa,
        minutos: reg.minutos,
        inicio: fecha.toISOString(),
        nota: reg.nota,
        origen: "historico"
      });
    });

    var capturados = leerLS(LS_EVENTOS, []).map(normalizar);
    var todos = base.concat(capturados).sort(function (a, b) { return b.fecha - a.fecha; });

    return filtroLinea ? todos.filter(function (e) { return e.linea === filtroLinea; }) : todos;
  }

  /**
   * Alta de un paro. `retroactivo` marca los que el operador captura después
   * del hecho con hora de inicio y fin (microparos resueltos antes de poder
   * reportarlos), para poder distinguirlos en la bitácora.
   */
  function registrar(datos) {
    var capturados = leerLS(LS_EVENTOS, []);
    var evento = {
      id: "EV-D" + String(Date.now()).slice(-6),
      activo: datos.activo,
      causa: datos.causa,
      minutos: Number(datos.minutos) || 0,
      inicio: datos.inicio || new Date().toISOString(),
      nota: datos.nota || "",
      origen: "demo",
      retroactivo: !!datos.retroactivo
    };
    capturados.push(evento);
    escribirLS(LS_EVENTOS, capturados);
    return normalizar(evento);
  }

  /** Corrige un evento ya capturado (panel de edición de Mantenimiento). */
  function editar(id, cambios) {
    var capturados = leerLS(LS_EVENTOS, []);
    for (var i = 0; i < capturados.length; i++) {
      if (capturados[i].id !== id) continue;
      if (cambios.causa !== undefined) capturados[i].causa = cambios.causa;
      if (cambios.minutos !== undefined) capturados[i].minutos = Number(cambios.minutos) || 0;
      if (cambios.nota !== undefined) capturados[i].nota = cambios.nota;
      escribirLS(LS_EVENTOS, capturados);
      return normalizar(capturados[i]);
    }
    return null;   // los eventos de la semilla no se editan
  }

  function eventosCapturados(filtroLinea) {
    var lista = leerLS(LS_EVENTOS, []).map(normalizar)
      .sort(function (a, b) { return b.fecha - a.fecha; });
    return filtroLinea ? lista.filter(function (e) { return e.linea === filtroLinea; }) : lista;
  }

  // ---------------------------------------------------- estado del piso ---
  function estados() {
    var guardados = leerLS(LS_ESTADOS, null);
    if (guardados) return guardados;

    var ahora = Date.now();
    var inicial = {};
    Object.keys(ESTADOS_INICIALES).forEach(function (id) {
      var e = ESTADOS_INICIALES[id];
      inicial[id] = {
        estado: e.estado,
        desde: new Date(ahora - e.desdeMin * 60000).toISOString(),
        causa: e.causa || null
      };
    });
    escribirLS(LS_ESTADOS, inicial);
    return inicial;
  }

  function cambiarEstado(idActivo, nuevoEstado, causaId) {
    var actuales = estados();
    actuales[idActivo] = {
      estado: nuevoEstado,
      desde: new Date().toISOString(),
      causa: causaId || null
    };
    escribirLS(LS_ESTADOS, actuales);
    return actuales[idActivo];
  }

  function minutosEn(estadoActivo) {
    return Math.max(0, Math.round((Date.now() - new Date(estadoActivo.desde).getTime()) / 60000));
  }

  /* ============================ BANDEJA DE SOLICITUDES ====================
     REGLA DE NEGOCIO — TRACKING TEMPORAL DESACOPLADO
     `desde` es el instante en que el operador reportó el paro. El cronómetro y
     la pérdida se calculan SIEMPRE contra ese timestamp, nunca contra
     `validadaEn`. Validar no arranca el reloj: solo oficializa la causa raíz.
     ====================================================================== */
  /**
   * Lista cruda de solicitudes, sembrando la inicial la primera vez.
   * TODA escritura tiene que pasar por aquí: si alguna leyera el localStorage
   * en crudo antes de que exista la semilla, escribiría sobre una lista vacía
   * y la siguiente lectura resucitaría las solicitudes ya cerradas.
   */
  function solicitudesCrudas() {
    var guardadas = leerLS(LS_SOLICITUDES, null);
    if (guardadas) return guardadas;

    var ahora = Date.now();
    guardadas = SOLICITUDES_INICIALES.map(function (s, i) {
      return {
        id: "SOL-" + ("00" + (i + 1)).slice(-3),
        activo: s.activo,
        causa: s.causa,
        desde: new Date(ahora - s.desdeMin * 60000).toISOString(),
        reportadoPor: s.reportadoPor,
        validada: false,
        causaValidada: null,
        validadaEn: null,
        cerrada: false
      };
    });
    escribirLS(LS_SOLICITUDES, guardadas);
    return guardadas;
  }

  function solicitudes(filtroLinea) {
    var lista = solicitudesCrudas().map(function (s) {
      var a = activo(s.activo);
      var min = Math.max(0, Math.round((Date.now() - new Date(s.desde).getTime()) / 60000));
      return {
        id: s.id,
        activo: s.activo,
        linea: a ? a.linea : null,
        causa: s.causa,
        causaValidada: s.causaValidada,
        desde: s.desde,
        fecha: new Date(s.desde),
        reportadoPor: s.reportadoPor,
        validada: !!s.validada,
        validadaEn: s.validadaEn,
        cerrada: !!s.cerrada,
        // Minutos y pérdida CORREN DESDE EL REPORTE, no desde la validación.
        minutosAbierta: min,
        perdidaAcumulada: (min / 60) * tarifaAplicable(s.activo)
      };
    }).sort(function (a, b) { return b.fecha - a.fecha; });   // más recientes primero

    return filtroLinea ? lista.filter(function (s) { return s.linea === filtroLinea; }) : lista;
  }

  function crearSolicitud(datos) {
    var guardadas = solicitudesCrudas();
    var solicitud = {
      id: "SOL-D" + String(Date.now()).slice(-5),
      activo: datos.activo,
      causa: datos.causa,
      desde: datos.desde || new Date().toISOString(),
      reportadoPor: datos.reportadoPor || "Operador de piso",
      validada: false,
      causaValidada: null,
      validadaEn: null,
      cerrada: false
    };
    guardadas.push(solicitud);
    escribirLS(LS_SOLICITUDES, guardadas);
    return solicitud;
  }

  /** Mantenimiento oficializa la causa raíz. NO toca `desde`: el reloj no se reinicia. */
  function validarSolicitud(id, causaRaiz) {
    var guardadas = solicitudesCrudas();
    for (var i = 0; i < guardadas.length; i++) {
      if (guardadas[i].id !== id) continue;
      guardadas[i].validada = true;
      guardadas[i].causaValidada = causaRaiz || guardadas[i].causa;
      guardadas[i].validadaEn = new Date().toISOString();
      escribirLS(LS_SOLICITUDES, guardadas);
      return guardadas[i];
    }
    return null;
  }

  function cerrarSolicitud(idActivo) {
    var guardadas = solicitudesCrudas();
    var cambio = false;
    guardadas.forEach(function (s) {
      if (s.activo === idActivo && !s.cerrada) { s.cerrada = true; cambio = true; }
    });
    if (cambio) escribirLS(LS_SOLICITUDES, guardadas);
    return cambio;
  }

  /** Reinicia la demo a su punto de partida (útil entre presentaciones). */
  function reiniciar() {
    try {
      global.localStorage.removeItem(LS_EVENTOS);
      global.localStorage.removeItem(LS_ESTADOS);
      global.localStorage.removeItem(LS_SOLICITUDES);
    } catch (e) { /* nada que limpiar */ }
  }

  // ------------------------------------------------------------ analítica ---
  /** Pareto por causa: importe, porcentaje y acumulado, de mayor a menor. */
  function paretoPorCausa(lista) {
    lista = lista || eventos();
    var porCausa = {};
    lista.forEach(function (ev) {
      if (!porCausa[ev.causa]) {
        porCausa[ev.causa] = {
          causa: ev.causa, etiqueta: causa(ev.causa).etiqueta,
          costo: 0, minutos: 0, eventos: 0, activos: {}
        };
      }
      porCausa[ev.causa].costo += ev.costo;
      porCausa[ev.causa].minutos += ev.minutos;
      porCausa[ev.causa].eventos += 1;
      porCausa[ev.causa].activos[ev.activo] = true;
    });

    var filas = Object.keys(porCausa).map(function (k) {
      var f = porCausa[k];
      f.activos = Object.keys(f.activos).sort();
      return f;
    }).sort(function (a, b) { return b.costo - a.costo; });

    var total = filas.reduce(function (t, f) { return t + f.costo; }, 0);
    var acumulado = 0;
    filas.forEach(function (f) {
      f.porcentaje = total ? (f.costo / total) * 100 : 0;
      acumulado += f.porcentaje;
      f.acumulado = acumulado;
    });
    return { filas: filas, total: total };
  }

  function porActivo(lista) {
    lista = lista || eventos();
    var mapa = {};
    lista.forEach(function (ev) {
      if (!mapa[ev.activo]) mapa[ev.activo] = { activo: ev.activo, linea: ev.linea, costo: 0, minutos: 0, eventos: 0 };
      mapa[ev.activo].costo += ev.costo;
      mapa[ev.activo].minutos += ev.minutos;
      mapa[ev.activo].eventos += 1;
    });
    return Object.keys(mapa).map(function (k) { return mapa[k]; })
      .sort(function (a, b) { return b.costo - a.costo; });
  }

  /**
   * Indicadores del periodo.
   *   MTTR = minutos de paro / número de eventos
   *   MTBF = horas operativas disponibles menos paro, entre número de eventos
   * Las horas disponibles escalan con el número de líneas presentes en la
   * lista: un resumen de una línea no puede compararse contra la planta entera.
   */
  function resumen(lista) {
    lista = lista || eventos();
    var minutos = lista.reduce(function (t, e) { return t + e.minutos; }, 0);
    var total = lista.reduce(function (t, e) { return t + e.costo; }, 0);
    var n = lista.length || 1;

    var lineasPresentes = {};
    lista.forEach(function (e) { if (e.linea) lineasPresentes[e.linea] = true; });
    var nLineas = Math.max(1, Object.keys(lineasPresentes).length);

    var horasDisponibles = DIAS_HISTORIAL * TURNOS_DIA * HORAS_TURNO * nLineas;
    var horasParo = minutos / 60;

    return {
      eventos: lista.length,
      lineas: nLineas,
      minutos: minutos,
      horasParo: horasParo,
      costoTotal: total,
      costoUsd: total / TIPO_CAMBIO_USD,
      mttrMin: minutos / n,
      mtbfHoras: Math.max(0, horasDisponibles - horasParo) / n,
      disponibilidad: horasDisponibles ? (1 - horasParo / horasDisponibles) * 100 : 0,
      horasDisponibles: horasDisponibles
    };
  }

  /** Desempeño por turno: quién resuelve más rápido (leaderboard del gerente). */
  function porTurno(lista) {
    lista = lista || eventos();
    var mapa = { T1: null, T2: null, T3: null };
    Object.keys(mapa).forEach(function (t) { mapa[t] = { turno: t, eventos: 0, minutos: 0, costo: 0 }; });
    lista.forEach(function (ev) {
      var t = mapa[ev.turno];
      if (!t) return;
      t.eventos += 1;
      t.minutos += ev.minutos;
      t.costo += ev.costo;
    });
    return Object.keys(mapa).map(function (k) {
      var t = mapa[k];
      t.mttrMin = t.eventos ? t.minutos / t.eventos : 0;
      return t;
    }).sort(function (a, b) {
      if (!a.eventos) return 1;
      if (!b.eventos) return -1;
      return a.mttrMin - b.mttrMin;
    });
  }

  /** Matriz turno × línea, para la gráfica de barras verticales de dirección. */
  function porTurnoYLinea(lista) {
    lista = lista || eventos();
    var turnos = ["T1", "T2", "T3"];
    return turnos.map(function (t) {
      var fila = { turno: t, total: 0, porLinea: {} };
      LINEAS.forEach(function (l) { fila.porLinea[l.id] = { costo: 0, minutos: 0, eventos: 0 }; });
      lista.forEach(function (ev) {
        if (ev.turno !== t || !fila.porLinea[ev.linea]) return;
        fila.porLinea[ev.linea].costo += ev.costo;
        fila.porLinea[ev.linea].minutos += ev.minutos;
        fila.porLinea[ev.linea].eventos += 1;
        fila.total += ev.costo;
      });
      return fila;
    });
  }

  function porLinea(lista) {
    lista = lista || eventos();
    return LINEAS.map(function (l) {
      var propios = lista.filter(function (e) { return e.linea === l.id; });
      var r = resumen(propios);
      return {
        linea: l.id, nombre: l.nombre,
        eventos: propios.length, costo: r.costoTotal,
        minutos: r.minutos, mttrMin: propios.length ? r.mttrMin : 0
      };
    });
  }

  global.DowntimeCO = {
    TIPO_CAMBIO_USD: TIPO_CAMBIO_USD,
    DIAS_HISTORIAL: DIAS_HISTORIAL,
    LINEAS: LINEAS,
    ACTIVOS: ACTIVOS,
    CAUSAS: CAUSAS,
    activo: activo,
    linea: linea,
    activosDeLinea: activosDeLinea,
    causa: causa,
    tarifaLinea: tarifaLinea,
    tarifaAplicable: tarifaAplicable,
    eventos: eventos,
    eventosCapturados: eventosCapturados,
    registrar: registrar,
    editar: editar,
    estados: estados,
    cambiarEstado: cambiarEstado,
    minutosEn: minutosEn,
    solicitudes: solicitudes,
    crearSolicitud: crearSolicitud,
    validarSolicitud: validarSolicitud,
    cerrarSolicitud: cerrarSolicitud,
    reiniciar: reiniciar,
    paretoPorCausa: paretoPorCausa,
    porActivo: porActivo,
    porTurno: porTurno,
    porTurnoYLinea: porTurnoYLinea,
    porLinea: porLinea,
    resumen: resumen
  };
})(window);
