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
    var elementoAbridor = null;

    function elementosEnfocables() {
      return Array.from(modal.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
        .filter(function (elemento) { return !elemento.hidden && elemento.getClientRects().length > 0; });
    }
    function esModalSuperior() {
      var abiertos = Array.from(document.querySelectorAll('.modal.is-open'));
      return abiertos[abiertos.length - 1] === modal;
    }

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
      elementoAbridor = document.activeElement;
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
      if (elementoAbridor && elementoAbridor.isConnected) elementoAbridor.focus();
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
      if (!modal.classList.contains("is-open") || !esModalSuperior()) return;
      if (e.key === "Escape") { cerrar(); return; }
      if (e.key !== "Tab") return;
      var enfocables = elementosEnfocables();
      if (!enfocables.length) { e.preventDefault(); return; }
      var primero = enfocables[0];
      var ultimo = enfocables[enfocables.length - 1];
      if (e.shiftKey && (document.activeElement === primero || !modal.contains(document.activeElement))) {
        e.preventDefault(); ultimo.focus();
      } else if (!e.shiftKey && (document.activeElement === ultimo || !modal.contains(document.activeElement))) {
        e.preventDefault(); primero.focus();
      }
    });

    $("#formRetro").addEventListener("submit", function (e) {
      e.preventDefault();
      var dur = calcular();
      var err = $("#retroErr");
      var guardar = e.submitter || $("#formRetro button[type='submit']");

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

      guardar.disabled = true;
      D.registrarConfirmado({
        activo: activoActual,
        causa: causaId,
        causaLibre: libre || null,
        minutos: dur,
        inicio: new Date($("#retroInicio").value).toISOString(),
        nota: opciones.nota || "Registro retroactivo.",
        registradoPor: opciones.registradoPor || "",
        retroactivo: true
      }).then(function (evento) {
        err.textContent = "";
        err.classList.remove("is-visible");
        modal.classList.remove("is-open");
        document.body.style.overflow = "";
        if (elementoAbridor && elementoAbridor.isConnected) elementoAbridor.focus();
        opciones.alGuardar(evento, dur);
      }).catch(function (error) {
        err.textContent = "No se guardó el registro. " + (error && error.message ? error.message : "Revisa la conexión e inténtalo de nuevo.");
        err.classList.add("is-visible");
      }).finally(function () { guardar.disabled = false; });
    });

    return { abrir: abrir, cerrar: cerrar, hhmm: hhmm };
  }

  global.Retroactivo = { iniciar: iniciar, hhmm: hhmm };
})(window);
