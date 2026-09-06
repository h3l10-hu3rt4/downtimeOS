/* ==========================================================================
   DowntimeCO — Planta de simulación de la demo
   --------------------------------------------------------------------------
   FUENTE ÚNICA DE VERDAD. Las tres vistas por rol leen de aquí; ninguna
   escribe cifras a mano.

   DOS LÍNEAS DE PRODUCCIÓN
   - Línea 01 · Estructural: ocho activos en cuatro etapas. Cuello: sierra C-01.
   - Línea 02 · Ensamble ligero: cuatro activos. Cuello: banco de pruebas R-01.

   MODELO DE COSTO — REGLA DEL CUELLO DE BOTELLA
   La planta se modela por etapas en serie. Los equipos de una misma etapa son
   paralelos y equivalentes: con N equipos, el paro de uno reduce N^-1 de la
   capacidad. Una etapa con un solo equipo es cuello de botella y deja la línea
   en 0%. El costo usa esa misma proporción de la tarifa completa de la línea.

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
  var LS_CANCELACIONES = "downtimeco_demo_cancelaciones";

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
    { id: "M-01", linea: "L-01", tipo: "CM", nombre: "Centro de maquinado 01",     etapa: "Maquinado", tarifa: 2450, cuelloBotella: false },
    { id: "M-02", linea: "L-01", tipo: "CM", nombre: "Centro de maquinado 02",     etapa: "Maquinado", tarifa: 2450, cuelloBotella: false },
    { id: "C-01", linea: "L-01", tipo: "SR", nombre: "Sierra de corte automatizado", etapa: "Corte",   tarifa: 3900, cuelloBotella: true  },
    { id: "H-01", linea: "L-01", tipo: "HR", nombre: "Horno de curado 01",         etapa: "Curado",    tarifa: 1850, cuelloBotella: false },
    { id: "H-02", linea: "L-01", tipo: "HR", nombre: "Horno de curado 02",         etapa: "Curado",    tarifa: 1850, cuelloBotella: false },
    { id: "H-03", linea: "L-01", tipo: "HR", nombre: "Horno de curado 03",         etapa: "Curado",    tarifa: 1850, cuelloBotella: false },
    { id: "P-01", linea: "L-01", tipo: "CP", nombre: "Cabina de pintura 01",       etapa: "Pintura",   tarifa: 2700, cuelloBotella: false },
    { id: "P-02", linea: "L-01", tipo: "CP", nombre: "Cabina de pintura 02",       etapa: "Pintura",   tarifa: 2700, cuelloBotella: false },

    // --- Línea 02 · cuatro activos ----------------------------------------
    { id: "E-01", linea: "L-02", tipo: "ES", nombre: "Estación de ensamble 01",    etapa: "Ensamble",  tarifa: 1650, cuelloBotella: false },
    { id: "E-02", linea: "L-02", tipo: "ES", nombre: "Estación de ensamble 02",    etapa: "Ensamble",  tarifa: 1650, cuelloBotella: false },
    { id: "R-01", linea: "L-02", tipo: "BP", nombre: "Banco de pruebas funcional", etapa: "Pruebas",   tarifa: 2100, cuelloBotella: true  },
    { id: "K-01", linea: "L-02", tipo: "EM", nombre: "Empaque y etiquetado",       etapa: "Empaque",   tarifa: 1200, cuelloBotella: false }
  ];

  /* -------------------------------------------------------------- causas ---
     Catálogo cerrado: es lo que hace posible el Pareto. Texto libre no agrupa. */
  var CAUSAS = [
    { id: "ruptura-herramental", etiqueta: "Ruptura de herramental" },
    { id: "espera-material",     etiqueta: "Espera de material" },
    { id: "cambio-modelo",       etiqueta: "Cambio de modelo sin SMED" },
    { id: "ajuste-calidad",      etiqueta: "Ajuste de calidad / calibración" },
    { id: "falla-electrica",     etiqueta: "Falla eléctrica menor" },
    { id: "falta-operador",      etiqueta: "Falta de operador" },
    // Va al final a propósito: es la válvula de escape del catálogo cerrado.
    // Obliga a escribir el motivo, así que sigue siendo agrupable a posteriori
    // en vez de convertirse en un cajón de sastre vacío.
    { id: "otros",               etiqueta: "Otros (especificar)", libre: true }
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

    // Turno 3 (22:00–06:00) en Línea 01. Sin estos registros las gráficas por
    // turno del tablero de dirección salían en cero para T3.
    { dias: 20, hora: "23:15", activo: "C-01", causa: "ruptura-herramental", minutos: 110 },
    { dias: 13, hora: "02:40", activo: "H-02", causa: "espera-material",     minutos: 95 },
    { dias:  8, hora: "23:50", activo: "M-01", causa: "falta-operador",      minutos: 65 },
    { dias:  5, hora: "01:25", activo: "P-02", causa: "ajuste-calidad",      minutos: 55 },

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
    { dias:  1, hora: "15:25", activo: "E-01", causa: "cambio-modelo",       minutos: 80 },

    // Turno 3 en Línea 02.
    { dias: 16, hora: "22:35", activo: "R-01", causa: "ajuste-calidad",      minutos: 70 },
    { dias:  7, hora: "03:20", activo: "E-02", causa: "falla-electrica",     minutos: 50 },
    { dias:  3, hora: "22:10", activo: "K-01", causa: "espera-material",     minutos: 85 }
  ];

  /* -------------------------------------------------------------- estado ---
     Estado operativo actual del piso. El operador lo cambia desde su tableta y
     el gerente lo ve en su tablero: es el mismo dato, no dos pantallas. */
  var ESTADOS_INICIALES = {
    "M-01": { estado: "RUN",   desdeMin: 212 },
    "M-02": { estado: "RUN",  desdeMin: 24 },
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
  // Los paros ya reportados al arrancar la demo llegan PRE-APROBADOS: se
  // supone que Mantenimiento ya los revisó en turnos anteriores. Lo que el
  // operador capture durante la sesión entra como PENDIENTE, que es el estado
  // sobre el que el gerente actúa en vivo.
  var SOLICITUDES_INICIALES = [
    { activo: "C-01", causa: "ruptura-herramental", desdeMin: 74, reportadoPor: "Helio Huerta" },
    { activo: "R-01", causa: "ajuste-calidad",      desdeMin: 31, reportadoPor: "Helio Huerta" }
  ];

  /* Estados de una solicitud:
       preaprobada · sembrada, ya revisada en un turno anterior
       pendiente   · reportada en esta sesión, esperando a Mantenimiento
       aprobada    · Mantenimiento confirmó la causa
       rechazada   · Mantenimiento la descartó (falso positivo, doble captura)  */
  var ESTADOS_SOLICITUD = {
    preaprobada: { etiqueta: "Pre-aprobado", tono: "ok",       resuelta: true },
    pendiente:   { etiqueta: "Pendiente de validación", tono: "alerta", resuelta: false },
    aprobada:    { etiqueta: "Validado",     tono: "ok",       resuelta: true },
    rechazada:   { etiqueta: "Rechazado",    tono: "neutro",   resuelta: true }
  };

  /* ======================================================================
     PUENTE CON SUPABASE
     ----------------------------------------------------------------------
     La demo tiene dos modos y elige solo:

       · "nube"  — hay API (/api/planta). Es la fuente de verdad: catálogo,
                   bitácora, estado del piso y bandeja salen de Postgres y
                   todo lo que se captura se persiste ahí. Lo que registre un
                   operador lo ve cualquier otro dispositivo.
       · "local" — no hay API (se abrió sin red, o el backend no responde).
                   Cae a la semilla de este archivo + localStorage, que es
                   como funcionaba antes. La demo NUNCA se queda en blanco.

     Por qué el fallback no sobra: la demo se presenta en vivo y a veces sin
     internet. Un tablero que depende de la red para pintar algo es un tablero
     que se cae delante del cliente.

     ESCRITURAS OPTIMISTAS
     Las tres vistas son síncronas: piden datos y pintan. Para no reescribirlas
     en async, las escrituras actualizan la caché en memoria al instante y
     mandan la petición en segundo plano. Si la petición falla, se marca el
     modo como degradado y se avisa por consola; la pantalla ya reflejó el
     cambio, que es lo que el operador necesita ver.
     ====================================================================== */

  var API = "/api/planta";
  var nube = null;          // catálogo y datos de Postgres, o null en modo local
  var modoActual = "local";
  var erroresNube = 0;

  function modo() { return modoActual; }

  /** Reemplaza el contenido de un arreglo SIN cambiar su referencia. */
  function reemplazar(arreglo, nuevos) {
    arreglo.length = 0;
    for (var i = 0; i < nuevos.length; i++) arreglo.push(nuevos[i]);
    return arreglo;
  }

  /** Traduce una fila de Postgres a la forma que ya consumen las vistas. */
  function deFilaActivo(f) {
    return {
      id: f.id, linea: f.linea_id, tipo: f.tipo, nombre: f.nombre,
      etapa: f.etapa, tarifa: Number(f.tarifa_hora), cuelloBotella: !!f.cuello_botella
    };
  }

  function deFilaEvento(f) {
    return normalizar({
      id: f.folio,
      activo: f.activo_id,
      causa: f.causa_id,
      causaLibre: f.causa_libre,
      minutos: Number(f.minutos),
      inicio: f.inicio,
      nota: f.nota || "",
      origen: f.origen,
      retroactivo: !!f.retroactivo,
      costo: Number(f.costo_mxn)
    });
  }

  function deFilaSolicitud(f) {
    return {
      id: f.folio, activo: f.activo_id, causa: f.causa_id,
      causaLibre: f.causa_libre, desde: f.desde,
      reportadoPor: f.reportado_por, estado: f.estado,
      causaValidada: f.causa_validada_id, validadaEn: f.validada_en,
      cerrada: !!f.cerrada
    };
  }

  /**
   * Arranque. Devuelve una promesa que SIEMPRE resuelve: si la API falla, la
   * demo sigue en modo local. Las vistas la esperan una vez y luego trabajan
   * contra la caché de forma síncrona.
   */
  function cargar() {
    if (typeof global.fetch !== "function") {
      modoActual = "local";
      return Promise.resolve(modoActual);
    }

    return global.fetch(API, { headers: { Accept: "application/json" } })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (j) {
        if (!j || !j.ok || !j.activos || !j.activos.length) throw new Error("respuesta incompleta");

        reemplazar(LINEAS, j.lineas.map(function (l) {
          return { id: l.id, nombre: l.nombre, descripcion: l.descripcion || "" };
        }));
        reemplazar(ACTIVOS, j.activos.map(deFilaActivo));
        aplicarModeloCapacidad();
        reemplazar(CAUSAS, j.causas.map(function (c) {
          return { id: c.id, etiqueta: c.etiqueta, libre: !!c.requiere_texto };
        }));

        var estados = {};
        j.estados.forEach(function (e) {
          estados[e.activo_id] = {
            estado: e.estado, desde: e.desde,
            causa: e.causa_id, causaLibre: e.causa_libre
          };
        });
        // Un activo sin fila de estado se asume operando: es el caso normal
        // en una planta recién dada de alta.
        ACTIVOS.forEach(function (a) {
          if (!estados[a.id]) estados[a.id] = { estado: "RUN", desde: new Date().toISOString(), causa: null };
        });

        nube = {
          eventos: j.eventos.map(deFilaEvento),
          estados: estados,
          solicitudes: j.solicitudes.map(deFilaSolicitud)
        };
        modoActual = "nube";
        return modoActual;
      })
      .catch(function (e) {
        if (global.console) {
          console.info("[DowntimeCO] sin API de planta (" + e.message + "): modo local con datos simulados.");
        }
        nube = null;
        modoActual = "local";
        return modoActual;
      });
  }

  /** Envío en segundo plano. Un fallo degrada el modo, no rompe la pantalla. */
  function enviar(ruta, opciones) {
    if (modoActual !== "nube" || typeof global.fetch !== "function") return Promise.resolve(null);
    return global.fetch(API + ruta, Object.assign({
      headers: { "Content-Type": "application/json" }
    }, opciones))
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .catch(function (e) {
        erroresNube++;
        modoActual = "degradado";
        if (global.console) console.error("[DowntimeCO] no se pudo guardar en la nube:", e.message);
        return null;
      });
  }

  function cuerpo(metodo, datos) {
    return { method: metodo, body: JSON.stringify(datos) };
  }

  /* ==================== MIGRACIÓN DE FOLIOS HEREDADOS ===================
     Las sesiones anteriores dejaron en el navegador registros con el formato
     viejo (EV-D156376, SOL-001). Conviven mal con el estandarizado: no ordenan
     cronológicamente y ensucian la bitácora. Se purgan una sola vez.
     ===================================================================== */
  var RE_FOLIO = /^L\d{2}-[A-Z]{2}-[A-Z]\d{2}-\d{8}-\d{4}-[0-9A-Z]{2}$/;

  function migrarFoliosHeredados() {
    try {
      ["downtimeco_demo_eventos", "downtimeco_demo_solicitudes"].forEach(function (clave) {
        var crudo = global.localStorage.getItem(clave);
        if (!crudo) return;
        var lista = JSON.parse(crudo);
        if (!Array.isArray(lista)) return;
        var limpia = lista.filter(function (r) { return r && RE_FOLIO.test(r.id); });
        if (limpia.length !== lista.length) {
          global.localStorage.setItem(clave, JSON.stringify(limpia));
        }
      });
    } catch (e) { /* sin almacenamiento no hay nada que migrar */ }
  }

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

  /** Equipos equivalentes que cubren la misma etapa de una línea. */
  function equiposDeEtapa(a) {
    return ACTIVOS.filter(function (otro) {
      return otro.linea === a.linea && otro.etapa === a.etapa;
    });
  }

  /** Normaliza la cobertura a partir del catálogo, no de etiquetas manuales. */
  function aplicarModeloCapacidad() {
    ACTIVOS.forEach(function (a) {
      var cantidad = equiposDeEtapa(a).length || 1;
      a.equiposParalelos = cantidad;
      a.impactoCapacidad = 1 / cantidad;
      // La regla se deriva de la topología: C-01, R-01 y K-01 son únicos.
      a.cuelloBotella = cantidad === 1;
    });
  }

  /** Capacidad productiva actual de una línea (mínimo de sus etapas en serie). */
  function capacidadDisponibleDeLinea(idLinea, mapaEstados) {
    var estadosActuales = mapaEstados || estados();
    var porEtapa = {};
    activosDeLinea(idLinea).forEach(function (a) {
      if (!porEtapa[a.etapa]) porEtapa[a.etapa] = { total: 0, operando: 0 };
      porEtapa[a.etapa].total++;
      if (!estadosActuales[a.id] || estadosActuales[a.id].estado === "RUN") porEtapa[a.etapa].operando++;
    });
    var capacidad = 1;
    Object.keys(porEtapa).forEach(function (etapa) {
      var grupo = porEtapa[etapa];
      capacidad = Math.min(capacidad, grupo.total ? grupo.operando / grupo.total : 1);
    });
    return capacidad;
  }

  function causa(id) {
    for (var i = 0; i < CAUSAS.length; i++) if (CAUSAS[i].id === id) return CAUSAS[i];
    return { id: id, etiqueta: id };
  }

  /** Requiere texto libre esta causa. */
  function causaEsLibre(id) {
    var c = causa(id);
    return !!c.libre;
  }

  /** Etiqueta a mostrar: para «Otros» se antepone lo que escribió el usuario. */
  function etiquetaCausa(id, textoLibre) {
    var c = causa(id);
    return c.libre && textoLibre ? textoLibre + " (otros)" : c.etiqueta;
  }

  /** Suma de las tarifas de una línea: lo que cuesta esa línea detenida una hora. */
  function tarifaLinea(idLinea) {
    return activosDeLinea(idLinea).reduce(function (t, a) { return t + a.tarifa; }, 0);
  }

  /** Tarifa aplicable: tarifa completa de la línea × capacidad perdida de la etapa. */
  function tarifaAplicable(idActivo) {
    var a = activo(idActivo);
    if (!a) return 0;
    return tarifaLinea(a.linea) * (a.impactoCapacidad || 1);
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

  /* ============================== FOLIOS ================================
     Formato estandarizado, alfanumérico y ordenable cronológicamente con un
     sort de texto plano —sin parsear fechas—:

         [LINEA]-[TIPO]-[NUM]-[YYYYMMDD]-[HHMM]-[HASH2]
         L01-SR-C01-20260904-1425-A1

     La fecha va en YYYYMMDD y la hora en HHMM justamente para que el orden
     lexicográfico coincida con el cronológico dentro de cada activo.
     El hash de dos caracteres desempata dos eventos del mismo activo en el
     mismo minuto; se deriva del contenido, así que es estable entre recargas.
     ===================================================================== */
  var ALFABETO_HASH = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ";   // sin I ni O

  function hash2(semilla) {
    var h = 0;
    var texto = String(semilla);
    for (var i = 0; i < texto.length; i++) {
      h = (h * 31 + texto.charCodeAt(i)) % 1156;   // 34 x 34 combinaciones
    }
    return ALFABETO_HASH[Math.floor(h / 34)] + ALFABETO_HASH[h % 34];
  }

  function dosDig(n) { return n < 10 ? "0" + n : String(n); }

  function folio(idActivo, fecha, semillaHash) {
    var a = activo(idActivo);
    if (!a) return "SIN-FOLIO";
    var f = new Date(fecha);
    var ymd = f.getFullYear() + dosDig(f.getMonth() + 1) + dosDig(f.getDate());
    var hm = dosDig(f.getHours()) + dosDig(f.getMinutes());
    return [
      a.linea.replace("-", ""),          // L-01 -> L01
      a.tipo,                            // SR, CM, HR...
      a.id.replace("-", ""),             // C-01 -> C01
      ymd,
      hm,
      hash2(semillaHash === undefined ? idActivo + ymd + hm : semillaHash)
    ].join("-");
  }

  /* ============= JORNADA PRODUCTIVA Y ORDINAL DE TURNO ==================
     El turno 3 va de 22:00 a 06:00, así que cruza la medianoche: un paro de
     las 02:00 del día 5 pertenece a la JORNADA del día 4. Sin esta corrección
     un filtro por fechas partiría cada turno nocturno en dos.

     `ordinalTurno` convierte (jornada, turno) en un entero comparable, que es
     lo que permite filtrar por un rango [fecha+turno inicial, fecha+turno
     final] con dos comparaciones y sin casos especiales.
     ===================================================================== */
  function jornadaDe(fecha) {
    var d = new Date(fecha);
    if (d.getHours() < 6) d.setDate(d.getDate() - 1);   // madrugada = jornada anterior
    return d.getFullYear() + "-" + dosDig(d.getMonth() + 1) + "-" + dosDig(d.getDate());
  }

  var INDICE_TURNO = { T1: 1, T2: 2, T3: 3 };

  function ordinalTurno(jornada, turno) {
    return Number(String(jornada).replace(/-/g, "")) * 10 + (INDICE_TURNO[turno] || 0);
  }

  function ordinalDeFecha(fecha) {
    return ordinalTurno(jornadaDe(fecha), turnoDeFecha(new Date(fecha)));
  }

  /**
   * Filtra por un rango compuesto de fecha y turno.
   * Los extremos son inclusivos, así que «del 5-sep T1 al 5-sep T1» devuelve
   * ese turno y no una lista vacía.
   */
  function enRango(evento, desdeJornada, desdeTurno, hastaJornada, hastaTurno) {
    var o = ordinalDeFecha(evento.fecha || evento.inicio);
    return o >= ordinalTurno(desdeJornada, desdeTurno) &&
           o <= ordinalTurno(hastaJornada, hastaTurno);
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
      causaLibre: evento.causaLibre || null,
      etiquetaCausa: etiquetaCausa(evento.causa, evento.causaLibre),
      minutos: Number(evento.minutos),
      inicio: evento.inicio,
      fecha: fecha,
      turno: evento.turno || turnoDeFecha(fecha),
      jornada: jornadaDe(fecha),
      nota: evento.nota || "",
      origen: evento.origen || "historico",
      retroactivo: !!evento.retroactivo,
      // El servidor congela el costo de todo evento histórico. Solo las
      // capturas locales sin costo todavía usan la regla vigente para estimar.
      costo: Number.isFinite(Number(evento.costo)) ? Number(evento.costo) : costo(evento)
    };
  }

  /** Histórico sembrado + lo capturado en la tableta, más reciente primero. */
  function eventos(filtroLinea) {
    if (nube) {
      var deNube = nube.eventos.slice().sort(function (a, b) { return b.fecha - a.fecha; });
      return filtroLinea ? deNube.filter(function (e) { return e.linea === filtroLinea; }) : deNube;
    }

    var base = SEMILLA.map(function (reg, i) {
      var fecha = fechaDesdeSemilla(reg);
      return normalizar({
        id: folio(reg.activo, fecha, reg.activo + reg.causa + reg.minutos + reg.dias),
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
    var inicioEvento = datos.inicio || new Date().toISOString();
    var evento = {
      id: folio(datos.activo, inicioEvento, datos.activo + Date.now()),
      activo: datos.activo,
      causa: datos.causa,
      causaLibre: datos.causaLibre || null,
      minutos: Number(datos.minutos) || 0,
      inicio: inicioEvento,
      nota: datos.nota || "",
      origen: "demo",
      retroactivo: !!datos.retroactivo
    };
    var normalizado = normalizar(evento);

    if (nube) {
      // Optimista: la pantalla ya refleja el registro; la nube confirma después
      // y sustituye el folio provisional por el que asigna el servidor.
      nube.eventos.push(normalizado);
      enviar("/eventos", cuerpo("POST", {
        activo_id: evento.activo, causa_id: evento.causa, causa_libre: evento.causaLibre,
        minutos: evento.minutos, inicio: evento.inicio, retroactivo: evento.retroactivo,
        nota: evento.nota, origen: "demo", registrado_por: datos.registradoPor || ""
      })).then(function (r) {
        if (r && r.evento) normalizado.id = r.evento.folio;
      });
      return normalizado;
    }

    capturados.push(evento);
    escribirLS(LS_EVENTOS, capturados);
    return normalizado;
  }

  /** Corrige un evento ya capturado (panel de edición de Mantenimiento). */
  function editar(id, cambios) {
    if (nube) {
      for (var n = 0; n < nube.eventos.length; n++) {
        if (nube.eventos[n].id !== id) continue;
        var ev = nube.eventos[n];
        if (cambios.causa !== undefined) ev.causa = cambios.causa;
        if (cambios.causaLibre !== undefined) ev.causaLibre = cambios.causaLibre;
        if (cambios.minutos !== undefined) ev.minutos = Number(cambios.minutos) || 0;
        ev.etiquetaCausa = etiquetaCausa(ev.causa, ev.causaLibre);
        ev.costo = costo(ev);
        enviar("/eventos?folio=" + encodeURIComponent(id), cuerpo("PATCH", {
          causa_id: cambios.causa, causa_libre: cambios.causaLibre, minutos: cambios.minutos
        }));
        return ev;
      }
      return null;
    }

    var capturados = leerLS(LS_EVENTOS, []);
    for (var i = 0; i < capturados.length; i++) {
      if (capturados[i].id !== id) continue;
      if (cambios.causa !== undefined) capturados[i].causa = cambios.causa;
      if (cambios.causaLibre !== undefined) capturados[i].causaLibre = cambios.causaLibre;
      if (cambios.minutos !== undefined) capturados[i].minutos = Number(cambios.minutos) || 0;
      if (cambios.nota !== undefined) capturados[i].nota = cambios.nota;
      escribirLS(LS_EVENTOS, capturados);
      return normalizar(capturados[i]);
    }
    return null;   // los eventos de la semilla no se editan
  }

  /**
   * Borra un evento capturado en la sesión. Es la corrección de un error de
   * captura, así que sale de la base general y desaparece de TODAS las vistas,
   * no solo de la lista del operador. El histórico sembrado no se borra.
   */
  function eliminar(id, motivo) {
    if (nube) {
      var antes = nube.eventos.length;
      nube.eventos = nube.eventos.filter(function (e) { return e.id !== id; });
      if (nube.eventos.length === antes) return false;
      enviar("/eventos?folio=" + encodeURIComponent(id),
        cuerpo("DELETE", { motivo: motivo || "Eliminado desde el historial de sesión" }));
      return true;
    }

    var capturados = leerLS(LS_EVENTOS, []);
    var borrado = null;
    var quedan = capturados.filter(function (ev) {
      if (ev.id === id) { borrado = ev; return false; }
      return true;
    });
    if (!borrado) return false;

    escribirLS(LS_EVENTOS, quedan);
    // Soft delete: el registro sale de la operación pero queda su rastro. Una
    // cancelación sin huella es indistinguible de un dato que nunca existió.
    registrarCancelacion(borrado, motivo || "Eliminado desde el historial de sesión");
    return true;
  }

  function registrarCancelacion(registro, motivo) {
    var log = leerLS(LS_CANCELACIONES, []);
    log.push({
      id: registro.id,
      activo: registro.activo,
      causa: registro.causa,
      minutos: registro.minutos,
      inicio: registro.inicio,
      canceladoEn: new Date().toISOString(),
      motivo: motivo
    });
    escribirLS(LS_CANCELACIONES, log);
  }

  function cancelaciones() {
    return leerLS(LS_CANCELACIONES, []).slice().reverse();
  }

  function eventosCapturados(filtroLinea) {
    // Lo capturado en esta sesión: en la nube son los eventos que no vienen del
    // histórico sembrado; en local, los del almacenamiento del navegador.
    var lista = nube
      ? nube.eventos.filter(function (e) { return e.origen !== "historico"; })
      : leerLS(LS_EVENTOS, []).map(normalizar);
    lista = lista.slice().sort(function (a, b) { return b.fecha - a.fecha; });
    return filtroLinea ? lista.filter(function (e) { return e.linea === filtroLinea; }) : lista;
  }

  // ---------------------------------------------------- estado del piso ---
  function estados() {
    if (nube) return nube.estados;

    var guardados = leerLS(LS_ESTADOS, null);
    if (guardados) {
      // Las sesiones viejas guardaron activos en "SETUP", que ya no es un
      // estado válido. Se normaliza al leer para que un navegador con datos
      // previos no siga mostrando un estado que el producto no tiene.
      var sucio = false;
      Object.keys(guardados).forEach(function (id) {
        if (guardados[id].estado !== "RUN" && guardados[id].estado !== "STOP") {
          guardados[id] = { estado: "RUN", desde: guardados[id].desde, causa: null };
          sucio = true;
        }
      });
      if (sucio) escribirLS(LS_ESTADOS, guardados);
      return guardados;
    }

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

  /**
   * Estados posibles de un activo: RUN o STOP. "Setup" NO es un estado —es la
   * acción de capturar un paro que ya terminó— así que si llega, se normaliza.
   */
  function cambiarEstado(idActivo, nuevoEstado, causaId, opciones) {
    if (nuevoEstado !== "STOP") { nuevoEstado = "RUN"; causaId = null; }
    opciones = opciones || {};
    // En modo nube, `estados()` devuelve el objeto en memoria: se muta ese, y
    // `escribirLS` de abajo simplemente no tiene efecto sobre él.
    var actuales = estados();
    actuales[idActivo] = {
      estado: nuevoEstado,
      // `desde` explícito permite revertir un cierre sin reiniciar el reloj:
      // al deshacer, el paro original reanuda con su marca de tiempo real.
      desde: opciones.desde || new Date().toISOString(),
      causa: causaId || null,
      causaLibre: opciones.causaLibre || null
    };
    escribirLS(LS_ESTADOS, actuales);

    if (nube) {
      enviar("/estados", cuerpo("POST", {
        activo_id: idActivo, estado: nuevoEstado, causa_id: causaId,
        causa_libre: opciones.causaLibre || null, desde: actuales[idActivo].desde
      }));
    }
    return actuales[idActivo];
  }

  /**
   * Reporte de paro desde piso. En nube se confirma en una sola respuesta
   * antes de pintar éxito; así Operador y Supervisión comparten la misma verdad.
   */
  function reportarParo(datos) {
    var desde = datos.desde || new Date().toISOString();
    if (nube && modoActual === "nube") {
      return enviar("/reportes", cuerpo("POST", {
        activo_id: datos.activo,
        causa_id: datos.causa,
        causa_libre: datos.causaLibre || null,
        desde: desde,
        reportado_por: datos.reportadoPor || "Operador de piso"
      })).then(function (r) {
        if (!r || !r.estado || !r.solicitud) throw new Error("Supabase no confirmó el reporte.");
        nube.estados[r.estado.activo_id] = {
          estado: r.estado.estado, desde: r.estado.desde,
          causa: r.estado.causa_id, causaLibre: r.estado.causa_libre
        };
        var solicitud = deFilaSolicitud(r.solicitud);
        nube.solicitudes.push(solicitud);
        return solicitud;
      });
    }

    cambiarEstado(datos.activo, "STOP", datos.causa, { causaLibre: datos.causaLibre || null, desde: desde });
    return Promise.resolve(crearSolicitud({
      activo: datos.activo, causa: datos.causa, causaLibre: datos.causaLibre || null,
      desde: desde, reportadoPor: datos.reportadoPor || "Operador de piso"
    }));
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
    if (nube) return nube.solicitudes;

    var guardadas = leerLS(LS_SOLICITUDES, null);
    if (guardadas) return guardadas;

    var ahora = Date.now();
    guardadas = SOLICITUDES_INICIALES.map(function (s) {
      var desde = new Date(ahora - s.desdeMin * 60000);
      return {
        id: folio(s.activo, desde, s.activo + "seed"),
        activo: s.activo,
        causa: s.causa,
        desde: desde.toISOString(),
        reportadoPor: s.reportadoPor,
        estado: "preaprobada",
        causaValidada: s.causa,
        validadaEn: desde.toISOString(),
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
      var estado = s.estado || "pendiente";
      return {
        id: s.id,
        activo: s.activo,
        linea: a ? a.linea : null,
        causa: s.causa,
        causaLibre: s.causaLibre || null,
        etiquetaCausa: etiquetaCausa(s.causa, s.causaLibre),
        causaValidada: s.causaValidada,
        desde: s.desde,
        fecha: new Date(s.desde),
        reportadoPor: s.reportadoPor,
        estado: estado,
        etiquetaEstado: ESTADOS_SOLICITUD[estado].etiqueta,
        tonoEstado: ESTADOS_SOLICITUD[estado].tono,
        resuelta: ESTADOS_SOLICITUD[estado].resuelta,
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
    var desde = datos.desde || new Date().toISOString();
    var solicitud = {
      id: folio(datos.activo, desde, datos.activo + Date.now()),
      activo: datos.activo,
      causa: datos.causa,
      causaLibre: datos.causaLibre || null,
      desde: desde,
      reportadoPor: datos.reportadoPor || "Operador de piso",
      estado: "pendiente",       // lo capturado en sesión espera a Mantenimiento
      causaValidada: null,
      validadaEn: null,
      cerrada: false
    };
    guardadas.push(solicitud);
    if (nube) {
      enviar("/solicitudes", cuerpo("POST", {
        activo_id: solicitud.activo, causa_id: solicitud.causa,
        causa_libre: solicitud.causaLibre, desde: solicitud.desde,
        reportado_por: solicitud.reportadoPor
      })).then(function (r) {
        if (r && r.solicitud) solicitud.id = r.solicitud.folio;
      });
    } else {
      escribirLS(LS_SOLICITUDES, guardadas);
    }
    return solicitud;
  }

  /**
   * Mantenimiento resuelve una solicitud pendiente.
   *   resolucion "aprobada"  → confirma el evento (opcionalmente con otra causa)
   *   resolucion "rechazada" → lo descarta (falso positivo o doble captura)
   * NO toca `desde` en ningún caso: el reloj y la pérdida no se reinician.
   */
  function resolverSolicitud(id, resolucion, causaRaiz) {
    var guardadas = solicitudesCrudas();
    for (var i = 0; i < guardadas.length; i++) {
      if (guardadas[i].id !== id) continue;
      guardadas[i].estado = resolucion === "rechazada" ? "rechazada" : "aprobada";
      guardadas[i].causaValidada = causaRaiz || guardadas[i].causa;
      guardadas[i].validadaEn = new Date().toISOString();
      if (nube) {
        enviar("/solicitudes?folio=" + encodeURIComponent(id), cuerpo("PATCH", {
          accion: "resolver",
          resolucion: guardadas[i].estado,
          causa_id: guardadas[i].causaValidada,
          causa_libre: guardadas[i].causaLibre
        }));
      } else {
        escribirLS(LS_SOLICITUDES, guardadas);
      }
      return guardadas[i];
    }
    return null;
  }

  /** Reclasifica la causa raíz sin resolver la solicitud todavía. */
  function cambiarCausaSolicitud(id, causaRaiz, textoLibre) {
    var guardadas = solicitudesCrudas();
    for (var i = 0; i < guardadas.length; i++) {
      if (guardadas[i].id !== id) continue;
      guardadas[i].causa = causaRaiz;
      guardadas[i].causaLibre = textoLibre || null;
      if (nube) {
        enviar("/solicitudes?folio=" + encodeURIComponent(id), cuerpo("PATCH", {
          accion: "reclasificar", causa_id: causaRaiz, causa_libre: textoLibre || null
        }));
      } else {
        escribirLS(LS_SOLICITUDES, guardadas);
      }
      return guardadas[i];
    }
    return null;
  }

  /** Borra una solicitud: es el deshacer de un reporte mal capturado. */
  function eliminarSolicitud(id) {
    var guardadas = solicitudesCrudas();
    var quedan = guardadas.filter(function (s) { return s.id !== id; });
    if (quedan.length === guardadas.length) return false;

    if (nube) {
      nube.solicitudes = quedan;
      enviar("/solicitudes?folio=" + encodeURIComponent(id), { method: "DELETE" });
    } else {
      escribirLS(LS_SOLICITUDES, quedan);
    }
    return true;
  }

  function cerrarSolicitud(idActivo) {
    var guardadas = solicitudesCrudas();
    var cambio = false;
    guardadas.forEach(function (s) {
      if (s.activo === idActivo && !s.cerrada) { s.cerrada = true; cambio = true; }
    });
    if (!cambio) return false;
    if (nube) {
      enviar("/solicitudes", cuerpo("PATCH", { accion: "cerrar", activo_id: idActivo }));
    } else {
      escribirLS(LS_SOLICITUDES, guardadas);
    }
    return cambio;
  }

  /** Reinicia la demo a su punto de partida (útil entre presentaciones). */
  function reiniciar() {
    try {
      global.localStorage.removeItem(LS_EVENTOS);
      global.localStorage.removeItem(LS_ESTADOS);
      global.localStorage.removeItem(LS_SOLICITUDES);
      global.localStorage.removeItem(LS_CANCELACIONES);
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

  aplicarModeloCapacidad();
  migrarFoliosHeredados();

  global.DowntimeCO = {
    cargar: cargar,
    modo: modo,
    TIPO_CAMBIO_USD: TIPO_CAMBIO_USD,
    DIAS_HISTORIAL: DIAS_HISTORIAL,
    LINEAS: LINEAS,
    ACTIVOS: ACTIVOS,
    CAUSAS: CAUSAS,
    activo: activo,
    linea: linea,
    activosDeLinea: activosDeLinea,
    equiposDeEtapa: equiposDeEtapa,
    capacidadDisponibleDeLinea: capacidadDisponibleDeLinea,
    causa: causa,
    causaEsLibre: causaEsLibre,
    etiquetaCausa: etiquetaCausa,
    tarifaLinea: tarifaLinea,
    folio: folio,
    jornadaDe: jornadaDe,
    ordinalTurno: ordinalTurno,
    ordinalDeFecha: ordinalDeFecha,
    enRango: enRango,
    tarifaAplicable: tarifaAplicable,
    eventos: eventos,
    eventosCapturados: eventosCapturados,
    registrar: registrar,
    editar: editar,
    eliminar: eliminar,
    cancelaciones: cancelaciones,
    estados: estados,
    cambiarEstado: cambiarEstado,
    reportarParo: reportarParo,
    minutosEn: minutosEn,
    solicitudes: solicitudes,
    crearSolicitud: crearSolicitud,
    ESTADOS_SOLICITUD: ESTADOS_SOLICITUD,
    resolverSolicitud: resolverSolicitud,
    cambiarCausaSolicitud: cambiarCausaSolicitud,
    cerrarSolicitud: cerrarSolicitud,
    eliminarSolicitud: eliminarSolicitud,
    reiniciar: reiniciar,
    paretoPorCausa: paretoPorCausa,
    porActivo: porActivo,
    porTurno: porTurno,
    porTurnoYLinea: porTurnoYLinea,
    porLinea: porLinea,
    resumen: resumen
  };
})(window);
