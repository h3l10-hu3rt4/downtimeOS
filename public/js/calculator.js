/* ==========================================================================
   DowntimeOS - Calculadora de Margen Oculto (RF-02 / RF-04)
   --------------------------------------------------------------------------
   Formula normativa (PRD v1.0.0 seccion 3):
     Minutos_Paro_Dia  = Maquinas x Turnos x Minutos_Paro_Turno
     Perdida_Diaria    = (Minutos_Paro_Dia / 60) x Tarifa_Horaria
     Perdida_Mensual   = Perdida_Diaria x 25 dias operativos
     Perdida_Anual     = Perdida_Mensual x 12 meses  (= 300 dias habiles)
     Recuperacion_Anual = Perdida_Anual x 0.20  (reduccion de MTTR)
     Mano_Obra_Absorbida = Perdida_Anual x Proporcion_Mano_Obra
     Margen_No_Generado  = Perdida_Anual x (1 - Proporcion_Mano_Obra)

   El PRD expresa el horizonte anual como "300 dias habiles". 25 dias x 12
   meses = 300: la constante es la misma, solo cambia como se enuncia. Se
   conservan los dos escalones porque el esquema SQL valida anual = mensual x 12.

   Estas constantes son un espejo exacto de server/calculo.py. Si cambias una,
   cambia la otra: el servidor SIEMPRE recalcula el payload recibido y sus
   cifras son las que se persisten.

   El recalculo es sincrono y sin red: se mide con performance.now() y se
   reporta en el badge de latencia para evidenciar el criterio "< 50ms".
   ========================================================================== */
(function (global) {
  "use strict";

  var MODELO = {
    DIAS_OPERATIVOS: 25,
    MESES: 12,
    // 20% de reduccion del MTTR por notificacion y despacho automatizados: el
    // extremo conservador del rango. DowntimeOS acorta la DETECCION y el
    // DESPACHO, no la reparacion fisica.
    FACTOR_MITIGACION: 0.20,
    DIAS_HABILES_ANIO: 300,     // 25 x 12 dias habiles
    // Reparto por defecto de una tarifa capturada a mano. Los presets traen el
    // suyo; este es el promedio de las tres celdas de referencia.
    PROPORCION_MANO_OBRA: 0.35,
    TIPO_CAMBIO_USD: 17.50,
    HORAS_POR_TURNO: 8
  };

  var LIMITES = {
    maquinas:         { min: 1,   max: 100,    def: 5 },   // slider de la UI: 1-30
    turnos:           { min: 1,   max: 3,      def: 2 },
    tarifaHora:       { min: 100, max: 200000, def: 1200 },  // referencia MXN
    minutosParoDia:   { min: 5,   max: 120,    def: 25 }   // slider de la UI: 5-90
  };

  // La tarifa se acota SEGUN LA DIVISA: un tope pensado en pesos mutilaria
  // cualquier tarifa expresada en dolares (y viceversa).
  var LIMITES_TARIFA = {
    MXN: { min: 100, max: 200000 },
    USD: { min: 5,   max: 12000 }
  };

  function limitesTarifa(divisa) {
    return LIMITES_TARIFA[divisa === "USD" ? "USD" : "MXN"];
  }

  // Preajustes de costo hora-maquina por tipo de proceso (PRD seccion 3).
  // Cada preset trae su par MXN/USD para que el toggle de divisa no arrastre
  // un valor convertido con tipo de cambio y pierda la cifra de referencia.
  // `manoObra` es la parte de la tarifa que la planta paga aunque la maquina
  // este detenida; el resto es margen de contribucion que no se genero. Son dos
  // conversaciones distintas en el comite de direccion, por eso van separadas.
  var PRESETS_TARIFA = [
    { id: "cnc",      etiqueta: "Maquinado CNC",   MXN: 950,  USD: 55, manoObra: { MXN: 340, USD: 20 } },
    { id: "corte",    etiqueta: "Prensas / Corte", MXN: 1400, USD: 80, manoObra: { MXN: 470, USD: 27 } },
    { id: "ensamble", etiqueta: "Ensamble Manual", MXN: 500,  USD: 30, manoObra: { MXN: 230, USD: 14 } }
  ];

  /** Proporcion de mano de obra de una tarifa: la del preset que coincida, o la media. */
  function proporcionManoObra(tarifa, divisa) {
    for (var i = 0; i < PRESETS_TARIFA.length; i++) {
      var p = PRESETS_TARIFA[i];
      if (Number(tarifa) === p[divisa]) return p.manoObra[divisa] / p[divisa];
    }
    return MODELO.PROPORCION_MANO_OBRA;
  }

  // Tarifa por defecto equivalente al cambiar de divisa (PRD 4.2: default $1,200 MXN)
  var TARIFA_DEFAULT = { MXN: 1200, USD: Math.round(1200 / MODELO.TIPO_CAMBIO_USD) };

  function acotar(valor, min, max) {
    valor = Number(valor);
    if (!isFinite(valor)) return min;
    return Math.min(max, Math.max(min, valor));
  }

  // MXN se maneja en enteros; USD conserva 2 decimales para que el ida y
  // vuelta MXN -> USD -> MXN regrese al valor original.
  function redondearTarifa(valor, divisa) {
    return divisa === "USD" ? Math.round(valor * 100) / 100 : Math.round(valor);
  }

  /**
   * Calcula el bloque financiero completo.
   * @param {{maquinas:number,turnos:number,tarifaHora:number,minutosParoDia:number,divisa:string}} estado
   */
  function calcular(estado) {
    var t0 = (global.performance && performance.now) ? performance.now() : Date.now();

    var divisa = estado.divisa === "USD" ? "USD" : "MXN";
    var lt = limitesTarifa(divisa);
    var maquinas = Math.round(acotar(estado.maquinas, LIMITES.maquinas.min, LIMITES.maquinas.max));
    var turnos = Math.round(acotar(estado.turnos, LIMITES.turnos.min, LIMITES.turnos.max));
    var tarifa = acotar(estado.tarifaHora, lt.min, lt.max);
    var minutos = acotar(estado.minutosParoDia, LIMITES.minutosParoDia.min, LIMITES.minutosParoDia.max);

    // Los minutos se declaran POR TURNO y POR MAQUINA: el dia completo suma
    // los tres factores antes de convertir a horas.
    var minutosParoDia = maquinas * turnos * minutos;
    var perdidaDiaria = (minutosParoDia / 60) * tarifa;
    var perdidaMensual = perdidaDiaria * MODELO.DIAS_OPERATIVOS;
    var perdidaAnual = perdidaMensual * MODELO.MESES;
    var ahorro = perdidaAnual * MODELO.FACTOR_MITIGACION;
    var propMo = proporcionManoObra(tarifa, divisa);

    var t1 = (global.performance && performance.now) ? performance.now() : Date.now();

    return {
      maquinas: maquinas,
      turnos: turnos,
      horasOperacionDia: turnos * MODELO.HORAS_POR_TURNO,
      tarifaHora: tarifa,
      minutosParoDia: minutos,
      minutosParoFlotaDia: minutosParoDia,
      divisa: divisa,
      perdidaDiaria: perdidaDiaria,
      perdidaMensual: perdidaMensual,
      perdidaAnual: perdidaAnual,
      ahorroProyectado: ahorro,
      proporcionManoObra: propMo,
      manoObraAbsorbida: perdidaAnual * propMo,
      margenNoGenerado: perdidaAnual * (1 - propMo),
      // Costo por segundo de TODA la flota detenida: alimenta el ticker en vivo.
      costoPorMinuto: (tarifa * maquinas) / 60,
      costoPorSegundo: (tarifa * maquinas) / 3600,
      minutosParoAnual: minutosParoDia * MODELO.DIAS_HABILES_ANIO,
      latenciaMs: t1 - t0
    };
  }

  /** Convierte una tarifa entre divisas al alternar el switch MXN/USD (RF-04). */
  function convertirTarifa(valor, desde, hacia) {
    if (desde === hacia) return valor;
    var convertido = hacia === "USD"
      ? valor / MODELO.TIPO_CAMBIO_USD
      : valor * MODELO.TIPO_CAMBIO_USD;
    var lt = limitesTarifa(hacia);
    return acotar(redondearTarifa(convertido, hacia), lt.min, lt.max);
  }

  // ----------------------------------------------------------- formateadores
  var _fmt = {};
  function formateador(divisa, decimales) {
    var clave = divisa + decimales;
    if (!_fmt[clave]) {
      _fmt[clave] = new Intl.NumberFormat(divisa === "USD" ? "en-US" : "es-MX", {
        style: "currency",
        currency: divisa,
        minimumFractionDigits: decimales,
        maximumFractionDigits: decimales
      });
    }
    return _fmt[clave];
  }

  /** $1,234,567 MXN */
  function dinero(valor, divisa, decimales) {
    if (decimales === undefined) decimales = 0;
    return formateador(divisa, decimales).format(valor || 0) + " " + divisa;
  }

  /** Version compacta para etiquetas estrechas: $1.2M MXN */
  function dineroCompacto(valor, divisa) {
    valor = valor || 0;
    var abs = Math.abs(valor);
    if (abs >= 1e6) return "$" + (valor / 1e6).toFixed(1) + "M " + divisa;
    if (abs >= 1e3) return "$" + Math.round(valor / 1e3) + "k " + divisa;
    return dinero(valor, divisa);
  }

  function numero(valor, decimales) {
    return new Intl.NumberFormat("es-MX", {
      minimumFractionDigits: decimales || 0,
      maximumFractionDigits: decimales || 0
    }).format(valor || 0);
  }

  global.DowntimeCalc = {
    MODELO: MODELO,
    LIMITES: LIMITES,
    LIMITES_TARIFA: LIMITES_TARIFA,
    PRESETS_TARIFA: PRESETS_TARIFA,
    proporcionManoObra: proporcionManoObra,
    TARIFA_DEFAULT: TARIFA_DEFAULT,
    limitesTarifa: limitesTarifa,
    calcular: calcular,
    convertirTarifa: convertirTarifa,
    acotar: acotar,
    dinero: dinero,
    dineroCompacto: dineroCompacto,
    numero: numero
  };
})(window);
