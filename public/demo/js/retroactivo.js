/* ==========================================================================
   DowntimeCO — Modal de registro retroactivo
   --------------------------------------------------------------------------
   Compartido por la tableta de piso y por el panel de Mantenimiento: es el
   mismo flujo (hora de inicio, hora de fin, causa) y debe comportarse igual
   en los dos sitios, incluido el manejo del cruce de medianoche del turno 3.

   "Setup" NO es un estado de la máquina: es la captura de un paro que ya
   terminó. Por eso este modal no toca `cambiarEstado`, solo escribe el evento.
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

    /** Minutos entre dos horas; si fin < inicio, el paro cruzó la medianoche. */
    function minutos() {
      var i = $("#retroInicio").value;
      var f = $("#retroFin").value;
      if (!i || !f) return null;
      var pi = i.split(":").map(Number);
      var pf = f.split(":").map(Number);
      var dur = (pf[0] * 60 + pf[1]) - (pi[0] * 60 + pi[1]);
      if (dur < 0) dur += 24 * 60;   // turno T3
      return dur;
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

      // Propuesta razonable: los últimos 20 minutos.
      var ahora = new Date();
      var antes = new Date(ahora.getTime() - 20 * 60000);
      var comoInput = function (d) { return dosDig(d.getHours()) + ":" + dosDig(d.getMinutes()); };
      $("#retroInicio").value = comoInput(antes);
      $("#retroFin").value = comoInput(ahora);
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

    $("#retroInicio").addEventListener("input", calcular);
    $("#retroFin").addEventListener("input", calcular);
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

      // La hora capturada se ancla al día de hoy; si aún no ha ocurrido, fue ayer.
      var partes = $("#retroInicio").value.split(":").map(Number);
      var inicio = new Date();
      inicio.setHours(partes[0], partes[1], 0, 0);
      if (inicio.getTime() > Date.now()) inicio.setDate(inicio.getDate() - 1);

      var evento = D.registrar({
        activo: activoActual,
        causa: $("#retroCausa").value,
        minutos: dur,
        inicio: inicio.toISOString(),
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
