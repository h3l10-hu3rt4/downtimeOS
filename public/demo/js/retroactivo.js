/* ==========================================================================
   DowntimeCO — Modal de registro retroactivo
   --------------------------------------------------------------------------
   Compartido por la tableta de piso y por el panel de Mantenimiento: es el
   mismo flujo (hora de inicio, hora de fin, causa) y debe comportarse igual
   en los dos sitios, incluido el manejo del cruce de medianoche del turno 3.

   "Setup" NO es un estado de la máquina: es la captura de un paro que ya
   terminó. Por eso este modal no toca `cambiarEstado`, solo escribe el evento.

   Se piden FECHA Y HORA, no solo la hora: un paro del turno 3 puede empezar el
   día 4 a las 23:40 y terminar el 5 a las 00:25. Con la hora suelta habría que
   adivinar de qué día habla cada extremo.
   ========================================================================== */
(function (global) {
  "use strict";

  function dosDig(n) { return n < 10 ? "0" + n : String(n); }
  function hhmm(min) { return dosDig(Math.floor(min / 60)) + ":" + dosDig(min % 60); }

  /**
   * Engancha el modal presente en la página.
   * @param {object} opciones
   * @param {function} opciones.alGuardar  recibe (evento, minutos)
   */
  function iniciar(opciones) {
    var modal = document.getElementById("modalRetro");
    if (!modal) return null;

    var D = global.DowntimeCO;
    var $ = function (s) { return document.querySelector(s); };
    var activoActual = null;

    /** Minutos entre las dos marcas de tiempo completas. */
    function minutos() {
      var i = $("#retroInicio").value;
      var f = $("#retroFin").value;
      if (!i || !f) return null;
      var ini = new Date(i);
      var fin = new Date(f);
      if (isNaN(ini) || isNaN(fin)) return null;
      return Math.round((fin - ini) / 60000);
    }

    function calcular() {
      var dur = minutos();
      $("#retroDuracion").textContent = (dur === null || dur === 0) ? "—" : hhmm(dur) + " (" + dur + " min)";
      return dur;
    }

    function abrir(idActivo) {
      activoActual = idActivo;
      $("#retroCausa").innerHTML = D.CAUSAS.map(function (c) {
        return '<option value="' + c.id + '">' + c.etiqueta + "</option>";
      }).join("");
      $("#retroActivo").textContent = idActivo;
      $("#retroErr").classList.remove("is-visible");
      alternarLibre();

      // Propuesta razonable: los últimos 20 minutos.
      var ahora = new Date();
      var antes = new Date(ahora.getTime() - 20 * 60000);
      $("#retroInicio").value = comoInputLocal(antes);
      $("#retroFin").value = comoInputLocal(ahora);
      calcular();

      modal.classList.add("is-open");
      document.body.style.overflow = "hidden";
      setTimeout(function () { $("#retroInicio").focus(); }, 60);
    }

    function cerrar() {
      modal.classList.remove("is-open");
      document.body.style.overflow = "";
      if (opciones.alCerrar) opciones.alCerrar();
    }

    /** `datetime-local` espera hora local sin zona: YYYY-MM-DDTHH:MM. */
    function comoInputLocal(d) {
      return d.getFullYear() + "-" + dosDig(d.getMonth() + 1) + "-" + dosDig(d.getDate()) +
        "T" + dosDig(d.getHours()) + ":" + dosDig(d.getMinutes());
    }

    /** El campo de texto solo aparece cuando la causa elegida lo exige. */
    function alternarLibre() {
      var grupo = $("#grupoRetroLibre");
      if (!grupo) return;
      grupo.hidden = !D.causaEsLibre($("#retroCausa").value);
    }

    $("#retroInicio").addEventListener("input", calcular);
    $("#retroFin").addEventListener("input", calcular);
    $("#retroCausa").addEventListener("change", alternarLibre);
    document.querySelectorAll("[data-cerrar-retro]").forEach(function (b) {
      b.addEventListener("click", cerrar);
    });
    modal.addEventListener("mousedown", function (e) { if (e.target === modal) cerrar(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && modal.classList.contains("is-open")) cerrar();
    });

    $("#formRetro").addEventListener("submit", function (e) {
      e.preventDefault();
      var dur = calcular();
      var err = $("#retroErr");

      if (dur === null || dur <= 0) {
        err.textContent = "Revisa las horas: la de fin debe ser posterior a la de inicio.";
        err.classList.add("is-visible");
        return;
      }
      if (dur > 12 * 60) {
        err.textContent = "Un paro de más de 12 horas no se captura desde aquí. Escálalo a Mantenimiento.";
        err.classList.add("is-visible");
        return;
      }

      var causaId = $("#retroCausa").value;
      var libre = $("#retroLibre") ? $("#retroLibre").value.trim() : "";
      if (D.causaEsLibre(causaId) && libre.length < 3) {
        err.textContent = "Describe la causa: «Otros» necesita el motivo específico.";
        err.classList.add("is-visible");
        $("#retroLibre").focus();
        return;
      }

      var evento = D.registrar({
        activo: activoActual,
        causa: causaId,
        causaLibre: libre || null,
        minutos: dur,
        inicio: new Date($("#retroInicio").value).toISOString(),
        nota: opciones.nota || "Registro retroactivo.",
        retroactivo: true
      });

      modal.classList.remove("is-open");
      document.body.style.overflow = "";
      opciones.alGuardar(evento, dur);
    });

    return { abrir: abrir, cerrar: cerrar, hhmm: hhmm };
  }

  global.Retroactivo = { iniciar: iniciar, hhmm: hhmm };
})(window);
