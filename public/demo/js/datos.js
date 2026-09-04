/* ==========================================================================
   DowntimeCO — Planta de simulación de la demo
   --------------------------------------------------------------------------
   FUENTE ÚNICA DE VERDAD de la demo. Las tres vistas por rol (dirección,
   operaciones y operador) leen de aquí; ninguna escribe cifras a mano.

   MODELO DE COSTO
   Cada activo tiene su tarifa hora-máquina. La sierra C-01 es el cuello de
   botella: no tiene equipo redundante, así que un paro suyo detiene la línea
   completa y cuesta la SUMA de las ocho tarifas ($19,750 MXN/hr), no la suya.
   Ese es el modelo que hace que el Registro #01 (255 min en C-01) dé los
   $4,800 USD que cita el PRD:

       255 min / 60 x $19,750 MXN = $83,937.50 MXN / 17.50 = $4,796 USD

   PERSISTENCIA
   Los paros que el operador registra durante la demo van a localStorage, no a
   la API: esto es una simulación y no debe ensuciar Supabase ni leads.json.
   Por eso un paro capturado en la tableta aparece segundos después en el
   tablero del gerente y en el Pareto de dirección — mismo navegador.
   ========================================================================== */
(function (global) {
  "use strict";

  var LS_EVENTOS = "downtimeco_demo_eventos";
  var LS_ESTADOS = "downtimeco_demo_estados";

  var TIPO_CAMBIO_USD = 17.5;
  var HORAS_TURNO = 8;
  var TURNOS_DIA = 2;          // DowntimeCO opera T1 y T2
  var DIAS_HISTORIAL = 30;

  /* ----------------------------------------------------------- activos ---
     Cuatro etapas de manufactura, ocho activos. `cuelloBotella` marca al
     único sin redundancia. */
  var ACTIVOS = [
    { id: "M-01", nombre: "Centro de maquinado 01", etapa: "Maquinado", tarifa: 2450, cuelloBotella: false },
    { id: "M-02", nombre: "Centro de maquinado 02", etapa: "Maquinado", tarifa: 2450, cuelloBotella: false },
    { id: "C-01", nombre: "Sierra de corte automatizado", etapa: "Corte", tarifa: 3900, cuelloBotella: true },
    { id: "H-01", nombre: "Horno de curado 01", etapa: "Curado", tarifa: 1850, cuelloBotella: false },
    { id: "H-02", nombre: "Horno de curado 02", etapa: "Curado", tarifa: 1850, cuelloBotella: false },
    { id: "H-03", nombre: "Horno de curado 03", etapa: "Curado", tarifa: 1850, cuelloBotella: false },
    { id: "P-01", nombre: "Cabina de pintura 01", etapa: "Pintura", tarifa: 2700, cuelloBotella: false },
    { id: "P-02", nombre: "Cabina de pintura 02", etapa: "Pintura", tarifa: 2700, cuelloBotella: false }
  ];

  /* ------------------------------------------------------------ causas ---
     Las mismas seis que ve el operador en su tableta: el catálogo cerrado es
     lo que hace posible el Pareto. Texto libre no se agrupa. */
  var CAUSAS = [
    { id: "ruptura-herramental", etiqueta: "Ruptura de herramental" },
    { id: "espera-material",     etiqueta: "Espera de material" },
    { id: "cambio-modelo",       etiqueta: "Cambio de modelo sin SMED" },
    { id: "ajuste-calidad",      etiqueta: "Ajuste de calidad / calibración" },
    { id: "falla-electrica",     etiqueta: "Falla eléctrica menor" },
    { id: "falta-operador",      etiqueta: "Falta de operador" }
  ];

  /* --------------------------------------------------------- histórico ---
     30 días de paros. `dias` son días hacia atrás desde hoy, así que la demo
     siempre se ve reciente sin tocar el archivo. */
  var SEMILLA = [
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
    { dias:  1, hora: "07:50", activo: "C-01", causa: "espera-material",     minutos: 40 }
  ];

  /* ------------------------------------------------------------ estado ---
     Estado operativo actual del piso. El operador lo cambia desde su tableta
     y el gerente lo ve en su tablero: es el mismo dato, no dos pantallas. */
  var ESTADOS_INICIALES = {
    "M-01": { estado: "RUN",   desdeMin: 212 },
    "M-02": { estado: "SETUP", desdeMin: 24, causa: "cambio-modelo" },
    "C-01": { estado: "STOP",  desdeMin: 74, causa: "ruptura-herramental" },
    "H-01": { estado: "RUN",   desdeMin: 340 },
    "H-02": { estado: "RUN",   desdeMin: 188 },
    "H-03": { estado: "RUN",   desdeMin: 95 },
    "P-01": { estado: "RUN",   desdeMin: 410 },
    "P-02": { estado: "RUN",   desdeMin: 156 }
  };

  // ------------------------------------------------------------- helpers
  function leerLS(clave, porDefecto) {
    try {
      var crudo = global.localStorage.getItem(clave);
      return crudo ? JSON.parse(crudo) : porDefecto;
    } catch (e) {
      // Modo privado o almacenamiento bloqueado: la demo sigue con la semilla.
      return porDefecto;
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

  function causa(id) {
    for (var i = 0; i < CAUSAS.length; i++) if (CAUSAS[i].id === id) return CAUSAS[i];
    return { id: id, etiqueta: id };
  }

  /** Suma de las ocho tarifas: lo que cuesta un minuto de línea detenida. */
  function tarifaLinea() {
    return ACTIVOS.reduce(function (t, a) { return t + a.tarifa; }, 0);
  }

  /** Tarifa aplicable a un paro: la de línea si el activo es cuello de botella. */
  function tarifaAplicable(idActivo) {
    var a = activo(idActivo);
    if (!a) return 0;
    return a.cuelloBotella ? tarifaLinea() : a.tarifa;
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
    return {
      id: evento.id,
      activo: evento.activo,
      causa: evento.causa,
      minutos: Number(evento.minutos),
      inicio: evento.inicio,
      fecha: fecha,
      turno: evento.turno || turnoDeFecha(fecha),
      nota: evento.nota || "",
      origen: evento.origen || "historico",
      costo: costo(evento)
    };
  }

  /** Histórico sembrado + lo que se haya capturado en la tableta, más reciente primero. */
  function eventos() {
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

    var capturados = leerLS(LS_EVENTOS, []).map(function (ev) {
      return normalizar(ev);
    });

    return base.concat(capturados).sort(function (a, b) { return b.fecha - a.fecha; });
  }

  /** Alta de un paro desde la tableta del operador. */
  function registrar(datos) {
    var capturados = leerLS(LS_EVENTOS, []);
    var evento = {
      id: "EV-D" + String(Date.now()).slice(-6),
      activo: datos.activo,
      causa: datos.causa,
      minutos: Number(datos.minutos) || 0,
      inicio: datos.inicio || new Date().toISOString(),
      nota: datos.nota || "",
      origen: "demo"
    };
    capturados.push(evento);
    escribirLS(LS_EVENTOS, capturados);
    return normalizar(evento);
  }

  function eventosCapturados() {
    return leerLS(LS_EVENTOS, []).map(normalizar).sort(function (a, b) { return b.fecha - a.fecha; });
  }

  // ------------------------------------------------------ estado del piso
  function estados() {
    var guardados = leerLS(LS_ESTADOS, null);
    if (guardados) return guardados;

    // Primera visita: se materializan los `desdeMin` en marcas de tiempo reales.
    var ahora = Date.now();
    var inicial = {};
    Object.keys(ESTADOS_INICIALES).forEach(function (id) {
      var e = ESTADOS_INICIALES[id];
      inicial[id] = { estado: e.estado, desde: new Date(ahora - e.desdeMin * 60000).toISOString(), causa: e.causa || null };
    });
    escribirLS(LS_ESTADOS, inicial);
    return inicial;
  }

  function cambiarEstado(idActivo, nuevoEstado, causaId) {
    var actuales = estados();
    actuales[idActivo] = { estado: nuevoEstado, desde: new Date().toISOString(), causa: causaId || null };
    escribirLS(LS_ESTADOS, actuales);
    return actuales[idActivo];
  }

  function minutosEn(estadoActivo) {
    return Math.max(0, Math.round((Date.now() - new Date(estadoActivo.desde).getTime()) / 60000));
  }

  /** Reinicia la demo a su punto de partida (útil entre presentaciones). */
  function reiniciar() {
    try {
      global.localStorage.removeItem(LS_EVENTOS);
      global.localStorage.removeItem(LS_ESTADOS);
    } catch (e) { /* nada que limpiar */ }
  }

  // ---------------------------------------------------------- analítica
  /** Pareto por causa: importe, porcentaje y acumulado, de mayor a menor. */
  function paretoPorCausa(lista) {
    lista = lista || eventos();
    var porCausa = {};
    lista.forEach(function (ev) {
      if (!porCausa[ev.causa]) porCausa[ev.causa] = { causa: ev.causa, etiqueta: causa(ev.causa).etiqueta, costo: 0, minutos: 0, eventos: 0, activos: {} };
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
      if (!mapa[ev.activo]) mapa[ev.activo] = { activo: ev.activo, costo: 0, minutos: 0, eventos: 0 };
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
   */
  function resumen(lista) {
    lista = lista || eventos();
    var minutos = lista.reduce(function (t, e) { return t + e.minutos; }, 0);
    var total = lista.reduce(function (t, e) { return t + e.costo; }, 0);
    var n = lista.length || 1;

    var horasDisponibles = DIAS_HISTORIAL * TURNOS_DIA * HORAS_TURNO;
    var horasParo = minutos / 60;

    return {
      eventos: lista.length,
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

  global.DowntimeCO = {
    TIPO_CAMBIO_USD: TIPO_CAMBIO_USD,
    DIAS_HISTORIAL: DIAS_HISTORIAL,
    ACTIVOS: ACTIVOS,
    CAUSAS: CAUSAS,
    activo: activo,
    causa: causa,
    tarifaLinea: tarifaLinea,
    tarifaAplicable: tarifaAplicable,
    eventos: eventos,
    eventosCapturados: eventosCapturados,
    registrar: registrar,
    estados: estados,
    cambiarEstado: cambiarEstado,
    minutosEn: minutosEn,
    reiniciar: reiniciar,
    paretoPorCausa: paretoPorCausa,
    porActivo: porActivo,
    porTurno: porTurno,
    resumen: resumen
  };
})(window);
