/* ==========================================================================
   DowntimeOS - Capa 1 / Cliente
   Ticker del hero, estado de la calculadora, modales, validacion B2B,
   llamadas fetch a la Capa 2 y telemetria (Data Layer).
   ========================================================================== */
(function () {
  "use strict";

  var Calc = window.DowntimeCalc;
  var API = "";  // mismo origen: el servidor de la Capa 2 sirve estos estaticos

  var $ = function (sel, ctx) { return (ctx || document).querySelector(sel); };
  var $$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); };

  /* ---------------------------------------------------------- telemetria */
  // PRD 4.1: eventos del Data Layer. En local se imprimen en consola;
  // en produccion aqui se engancharia PostHog / GTM.
  window.dataLayer = window.dataLayer || [];
  function track(evento, props) {
    var payload = Object.assign({ event: evento, ts: new Date().toISOString() }, props || {});
    window.dataLayer.push(payload);
    if (window.console && console.debug) console.debug("[track]", evento, props || {});
  }

  function debounce(fn, ms) {
    var t;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  function utmActuales() {
    var q = new URLSearchParams(location.search);
    return {
      utm_source: q.get("utm_source") || "directo",
      utm_medium: q.get("utm_medium") || "landing",
      utm_campaign: q.get("utm_campaign") || "margen-oculto-2026"
    };
  }

  /* -------------------------------------------------------------- toast */
  var toastTimer;
  function toast(titulo, mensaje, tipo) {
    var el = $("#toast");
    if (!el) return;
    $("#toastTitle").textContent = titulo;
    $("#toastMsg").textContent = mensaje;
    el.classList.toggle("toast--error", tipo === "error");
    el.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("is-visible"); }, 5200);
  }

  /* ============================== HERO TICKER (RF-01) =====================
     Contador monetario que acumula en vivo con requestAnimationFrame: no
     bloquea el hilo principal y se pausa cuando la pestana no esta visible.
     ====================================================================== */
  function iniciarTicker() {
    var elDinero = $("#tickerValor");
    var elCrono = $("#tickerCrono");
    var elTasa = $("#tickerTasa");
    if (!elDinero) return;

    var TARIFA_HR = 4650;                 // PRD: tarifa asignada de la Celda CNC 04
    var POR_SEGUNDO = TARIFA_HR / 3600;   // $/segundo
    var acumulado = 1840.50;              // arranca en la cifra del PRD
    var segundos = 23 * 60 + 45;          // cronometro 00:23:45
    var ultimo = performance.now();

    elTasa.textContent = Calc.dinero(TARIFA_HR, "MXN") + "/hr  ·  " +
      Calc.dinero(POR_SEGUNDO, "MXN", 2) + "/seg";

    function dosDigitos(n) { return n < 10 ? "0" + n : String(n); }

    function pintar() {
      elDinero.textContent = "-" + Calc.dinero(acumulado, "MXN", 2);
      var h = Math.floor(segundos / 3600);
      var m = Math.floor((segundos % 3600) / 60);
      var s = Math.floor(segundos % 60);
      elCrono.textContent = dosDigitos(h) + ":" + dosDigitos(m) + ":" + dosDigitos(s);
    }

    function frame(ahora) {
      if (!document.hidden) {
        var delta = (ahora - ultimo) / 1000;
        if (delta > 0 && delta < 2) {           // ignora saltos por pestana inactiva
          acumulado += POR_SEGUNDO * delta;
          segundos += delta;
          pintar();
        }
      }
      ultimo = ahora;
      requestAnimationFrame(frame);
    }

    pintar();
    requestAnimationFrame(frame);
  }

  /* ============================ CALCULADORA (RF-02 / RF-04) ============== */
  var estado = {
    maquinas: Calc.LIMITES.maquinas.def,
    turnos: Calc.LIMITES.turnos.def,
    tarifaHora: Calc.LIMITES.tarifaHora.def,
    minutosParoDia: Calc.LIMITES.minutosParoDia.def,
    divisa: "MXN"
  };
  var resultado = Calc.calcular(estado);

  var trackCalculadora = debounce(function () {
    track("interact_calculator", {
      maquinas: estado.maquinas, turnos: estado.turnos,
      tarifa_hora: estado.tarifaHora, minutos_paro_dia: estado.minutosParoDia,
      divisa: estado.divisa, perdida_anual: Math.round(resultado.perdidaAnual)
    });
  }, 300);

  function pintarResultados() {
    resultado = Calc.calcular(estado);
    var d = estado.divisa;

    var big = $("#resAnual");
    big.textContent = Calc.dinero(resultado.perdidaAnual, d);
    big.classList.add("is-updating");
    setTimeout(function () { big.classList.remove("is-updating"); }, 140);

    $("#resDiaria").textContent = Calc.dinero(resultado.perdidaDiaria, d);
    $("#resMensual").textContent = Calc.dinero(resultado.perdidaMensual, d);
    $("#resPorMinuto").textContent = Calc.dinero(resultado.costoPorMinuto, d, 2);
    $("#resHorasAnual").textContent = Calc.numero(resultado.minutosParoAnual / 60) + " hrs";
    $("#resAhorro").textContent = Calc.dinero(resultado.ahorroProyectado, d);
    $("#resRoiTexto").textContent =
      "Una reducción del 35% en tu tiempo de respuesta recuperaría " +
      Calc.dinero(resultado.ahorroProyectado, d) + " al año.";

    $("#resLatencia").textContent = resultado.latenciaMs < 0.01
      ? "< 0.01 ms"
      : resultado.latenciaMs.toFixed(2) + " ms";
    $("#modalResumenCifra").textContent = Calc.dinero(resultado.perdidaAnual, d);

    // etiquetas de los controles
    $("#valMaquinas").textContent = estado.maquinas;
    $("#valMinutos").textContent = estado.minutosParoDia + " min";
    $("#valHoras").textContent = resultado.horasOperacionDia + " h/día";
    trackCalculadora();
  }

  function sincronizarControles() {
    $("#inMaquinas").value = estado.maquinas;
    $("#inMaquinasNum").value = estado.maquinas;
    $("#inMinutos").value = estado.minutosParoDia;
    $("#inTarifa").value = estado.tarifaHora;
    $$("#segTurnos .seg__btn").forEach(function (b) {
      b.classList.toggle("is-active", Number(b.dataset.turnos) === estado.turnos);
    });
    $$(".currency button").forEach(function (b) {
      b.classList.toggle("is-active", b.dataset.divisa === estado.divisa);
    });
    $$(".js-divisa-label").forEach(function (el) { el.textContent = estado.divisa; });
  }

  function iniciarCalculadora() {
    if (!$("#inMaquinas")) return;

    $("#inMaquinas").addEventListener("input", function (e) {
      estado.maquinas = Number(e.target.value);
      $("#inMaquinasNum").value = estado.maquinas;
      pintarResultados();
    });

    $("#inMaquinasNum").addEventListener("input", function (e) {
      estado.maquinas = Math.round(Calc.acotar(e.target.value, Calc.LIMITES.maquinas.min, Calc.LIMITES.maquinas.max));
      $("#inMaquinas").value = estado.maquinas;
      pintarResultados();
    });
    $("#inMaquinasNum").addEventListener("blur", function (e) { e.target.value = estado.maquinas; });

    $("#inMinutos").addEventListener("input", function (e) {
      estado.minutosParoDia = Number(e.target.value);
      pintarResultados();
    });

    $("#inTarifa").addEventListener("input", function (e) {
      var crudo = String(e.target.value).replace(/[^\d.]/g, "");
      estado.tarifaHora = crudo === "" ? 0 : Number(crudo);
      pintarResultados();
    });
    $("#inTarifa").addEventListener("blur", function (e) {
      var lt = Calc.limitesTarifa(estado.divisa);
      estado.tarifaHora = Calc.acotar(estado.tarifaHora, lt.min, lt.max);
      e.target.value = estado.tarifaHora;
      pintarResultados();
    });

    $$("#segTurnos .seg__btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        estado.turnos = Number(btn.dataset.turnos);
        sincronizarControles();
        pintarResultados();
      });
    });

    $$(".currency button").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var nueva = btn.dataset.divisa;
        if (nueva === estado.divisa) return;
        estado.tarifaHora = Calc.convertirTarifa(estado.tarifaHora, estado.divisa, nueva);
        estado.divisa = nueva;
        sincronizarControles();
        pintarResultados();
        track("currency_switched", { divisa: nueva, tarifa_hora: estado.tarifaHora });
      });
    });

    sincronizarControles();
    pintarResultados();
  }

  /* ================================ MODALES ============================== */
  var ultimoFoco = null;

  function abrirModal(id) {
    var m = document.getElementById(id);
    if (!m) return;
    ultimoFoco = document.activeElement;
    m.classList.add("is-open");
    document.body.style.overflow = "hidden";
    var primero = m.querySelector("input, textarea, button");
    if (primero) setTimeout(function () { primero.focus(); }, 60);
  }

  function cerrarModal(m) {
    m = m || $(".modal.is-open");
    if (!m) return;
    m.classList.remove("is-open");
    document.body.style.overflow = "";
    if (ultimoFoco) ultimoFoco.focus();
  }

  function iniciarModales() {
    $$("[data-modal]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var destino = btn.dataset.modal;
        if (destino === "modalLead") {
          $("#modalResumenCifra").textContent = Calc.dinero(resultado.perdidaAnual, estado.divisa);
          track("request_report_click", { perdida_anual: Math.round(resultado.perdidaAnual) });
        }
        if (destino === "modalVideo") track("video_modal_open", {});
        abrirModal(destino);
      });
    });

    $$("[data-cerrar]").forEach(function (btn) {
      btn.addEventListener("click", function () { cerrarModal(btn.closest(".modal")); });
    });

    $$(".modal").forEach(function (m) {
      m.addEventListener("mousedown", function (e) { if (e.target === m) cerrarModal(m); });
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") cerrarModal();
    });
  }

  /* ============================ VALIDACION CLIENTE ======================= */
  // Espejo de server/validacion.py (RF-03). El servidor revalida siempre.
  var DOMINIOS_GENERICOS = [
    "gmail.com", "googlemail.com", "hotmail.com", "hotmail.es", "hotmail.mx",
    "outlook.com", "outlook.es", "live.com", "live.com.mx", "msn.com",
    "yahoo.com", "yahoo.com.mx", "yahoo.es", "icloud.com", "me.com",
    "aol.com", "protonmail.com", "proton.me", "gmx.com", "mail.com",
    "zoho.com", "yandex.com", "tutanota.com", "example.com"
  ];
  var RE_EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

  // Espejo de validacion.normalizar_telefono: tolera espacios, guiones,
  // parentesis y la lada de pais (+52 / +52 1) antes de exigir 10 digitos.
  function normalizarTelefono(valor) {
    var d = String(valor || "").replace(/\D/g, "");
    if (d.length === 12 && d.indexOf("52") === 0) d = d.slice(2);
    if (d.length === 13 && d.indexOf("521") === 0) d = d.slice(3);
    return d;
  }

  function validarFormulario(form) {
    var errores = {};
    var datos = {};

    $$("[name]", form).forEach(function (campo) {
      datos[campo.name] = campo.value.trim();
    });

    if (!datos.nombre || datos.nombre.length < 3) errores.nombre = "Escribe tu nombre completo.";
    if (!datos.empresa || datos.empresa.length < 2) errores.empresa = "Indica el nombre de la empresa.";

    var email = (datos.email || "").toLowerCase();
    if (!email) {
      errores.email = "El correo corporativo es obligatorio.";
    } else if (!RE_EMAIL.test(email)) {
      errores.email = "El formato del correo no es válido.";
    } else if (DOMINIOS_GENERICOS.indexOf(email.split("@")[1]) !== -1) {
      errores.email = "Usa tu correo corporativo (no @gmail, @hotmail, @outlook).";
    }

    var tel = normalizarTelefono(datos.telefono);
    if (!tel) {
      errores.telefono = "El teléfono / WhatsApp es obligatorio.";
    } else if (tel.length !== 10) {
      errores.telefono = "El WhatsApp debe tener 10 dígitos (se acepta +52).";
    }
    datos.telefono = tel;

    if (form.dataset.origen === "AUDITORIA" && !datos.ciudad) {
      errores.ciudad = "Indica la ciudad o parque industrial.";
    }
    return { errores: errores, datos: datos };
  }

  function pintarErrores(form, errores) {
    $$("[name]", form).forEach(function (campo) {
      var caja = campo.closest(".input-group");
      var msg = caja ? $(".err", caja) : null;
      var tiene = Object.prototype.hasOwnProperty.call(errores, campo.name);
      campo.classList.toggle("is-error", tiene);
      if (msg) {
        msg.textContent = tiene ? errores[campo.name] : "";
        msg.classList.toggle("is-visible", tiene);
      }
    });
    var primero = Object.keys(errores)[0];
    if (primero) {
      var campo = form.querySelector('[name="' + primero + '"]');
      if (campo) campo.focus();
    }
  }

  /* ============================ ENVIO A LA CAPA 2 ======================== */
  function enviarLead(form) {
    var revision = validarFormulario(form);
    pintarErrores(form, revision.errores);
    if (Object.keys(revision.errores).length) {
      toast("Revisa el formulario", "Hay campos que necesitan corrección.", "error");
      return Promise.resolve(null);
    }

    var origen = form.dataset.origen || "CALCULADORA";
    // Base: el estado vigente de la calculadora. Encima, los campos que el
    // propio formulario declare (p. ej. "Numero de equipos" en la auditoria).
    var payload = Object.assign({
      maquinas: estado.maquinas,
      turnos: estado.turnos,
      tarifa_hora: estado.tarifaHora,
      minutos_paro_dia: estado.minutosParoDia
    }, revision.datos, {
      origen: origen,
      divisa: estado.divisa,
      utm: utmActuales()
    });

    var boton = $("button[type=submit]", form);
    var textoOriginal = boton.textContent;
    boton.disabled = true;
    boton.textContent = "Enviando...";
    var t0 = performance.now();

    return fetch(API + "/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
      .then(function (res) {
        var ms = Math.round(performance.now() - t0);
        if (!res.ok) {
          pintarErrores(form, res.body.errores || {});
          toast("No se pudo registrar", res.body.error || "Error de validación.", "error");
          return null;
        }
        var lead = res.body.lead;
        track(origen === "AUDITORIA" ? "request_audit_submit" : "submit_lead_magnet", {
          lead_id: lead.id, empresa: lead.empresa, latencia_ms: ms
        });
        form.reset();
        pintarErrores(form, {});
        return lead;
      })
      .catch(function (err) {
        toast("Servidor no disponible", "Verifica que la Capa 2 esté corriendo: " + err.message, "error");
        return null;
      })
      .finally(function () {
        boton.disabled = false;
        boton.textContent = textoOriginal;
      });
  }

  /* ==================== REPORTE PDF EN CLIENTE (RF-06) ====================
     Sin librerias externas: se arma un documento imprimible y se dispara el
     dialogo de impresion del navegador ("Guardar como PDF").
     ====================================================================== */
  function generarReporte(lead) {
    var d = lead.divisa;
    var f = function (v, dec) { return Calc.dinero(v, d, dec || 0); };
    var win = window.open("", "_blank", "width=880,height=980");
    if (!win) {
      toast("Permite las ventanas emergentes", "El navegador bloqueó la ventana del reporte.", "error");
      return;
    }
    var filas = [
      ["Máquinas críticas", lead.maquinas],
      ["Turnos por día", lead.turnos + " (" + lead.horas_operacion_dia + " h/dia)"],
      ["Tarifa horaria de máquina", f(lead.tarifa_hora, 2)],
      ["Paro diario estimado por máquina", lead.minutos_paro_dia + " min"],
      ["Pérdida diaria", f(lead.perdida_diaria)],
      ["Pérdida mensual (25 días)", f(lead.perdida_mensual)],
      ["PÉRDIDA ANUAL OCULTA", f(lead.perdida_anual)],
      ["Ahorro proyectado con DowntimeOS (35%)", f(lead.ahorro_proyectado)]
    ].map(function (r) {
      return "<tr><td>" + r[0] + "</td><td class='n'>" + r[1] + "</td></tr>";
    }).join("");

    win.document.write(
      "<!doctype html><html lang='es'><head><meta charset='utf-8'>" +
      "<title>Plan de Mitigación — " + lead.empresa + "</title><style>" +
      "*{box-sizing:border-box}body{font-family:Segoe UI,Inter,system-ui,sans-serif;color:#10151c;margin:0;padding:44px}" +
      "h1{font-size:24px;margin:0 0 4px}h2{font-size:14px;letter-spacing:.14em;text-transform:uppercase;color:#7d8d9c;margin:34px 0 10px}" +
      ".kicker{font-family:Consolas,monospace;font-size:11px;letter-spacing:.2em;color:#c77f00;text-transform:uppercase}" +
      ".box{border:1px solid #d7dee5;border-radius:10px;padding:18px 20px;margin-top:14px}" +
      "table{width:100%;border-collapse:collapse;margin-top:8px}" +
      "td{padding:9px 4px;border-bottom:1px solid #e6ebf0;font-size:14px}" +
      "td.n{text-align:right;font-family:Consolas,monospace;font-weight:600}" +
      "tr:nth-last-child(2) td{background:#fff6e3;font-weight:700}" +
      "tr:last-child td{background:#effaf3;font-weight:700;color:#12734a}" +
      ".foot{margin-top:34px;font-size:11px;color:#7d8d9c;border-top:1px solid #e6ebf0;padding-top:12px}" +
      "@media print{body{padding:24px}}" +
      "</style></head><body>" +
      "<div class='kicker'>DowntimeOS · Plan de Mitigación de Paros</div>" +
      "<h1>" + lead.empresa + "</h1>" +
      "<div style='color:#7d8d9c;font-size:13px'>" + lead.nombre + " · " + lead.puesto +
      " · " + lead.email + "<br>Folio " + lead.id + " · " + new Date(lead.created_at).toLocaleString("es-MX") + "</div>" +
      "<div class='box'><div class='kicker'>Pérdida anual oculta estimada</div>" +
      "<div style='font-family:Consolas,monospace;font-size:34px;font-weight:800;color:#d92d20'>" + f(lead.perdida_anual) + "</div>" +
      "<div style='font-size:13px;color:#475467;margin-top:6px'>Una reducción del 35% en el tiempo de respuesta recuperaría <b>" +
      f(lead.ahorro_proyectado) + "</b> al año.</div></div>" +
      "<h2>Parámetros y resultados</h2><table>" + filas + "</table>" +
      "<h2>Plan de mitigación sugerido (30 días)</h2><div class='box' style='font-size:13.5px;line-height:1.7'>" +
      "<b>Día 1-2 · Despliegue flash.</b> Alta de " + lead.maquinas +
      " activos críticos y tarifas horarias. Tabletas en piso, sin cableado ni intervención de TI.<br>" +
      "<b>Día 3-10 · Captura y línea base.</b> Registro de paros en menos de 10 segundos por evento; " +
      "primer Pareto de causas raíz y MTTR real por activo.<br>" +
      "<b>Día 11-20 · Alertas por umbral.</b> Notificación a mantenimiento vía WhatsApp al superar el umbral crítico.<br>" +
      "<b>Día 21-30 · Cierre financiero.</b> Comparativo contra la línea base y validación del ahorro de " +
      f(lead.ahorro_proyectado) + " anualizado.</div>" +
      "<div class='foot'>Modelo: Pérdida_Diaria = Máquinas × (Minutos_Paro / 60) × Tarifa_Horaria; " +
      "Mensual = Diaria × 25 días; Anual = Mensual × 12; Ahorro = Anual × 0.35. " +
      "Documento generado localmente por el prototipo DowntimeOS. Cifras estimadas para fines de diagnóstico.</div>" +
      "</body></html>"
    );
    win.document.close();
    win.focus();
    setTimeout(function () { win.print(); }, 350);
  }

  /* ============================== FORMULARIOS ============================ */
  function iniciarFormularios() {
    var formLead = $("#formLead");
    if (formLead) {
      formLead.addEventListener("submit", function (e) {
        e.preventDefault();
        enviarLead(formLead).then(function (lead) {
          if (!lead) return;
          cerrarModal($("#modalLead"));
          toast("Reporte listo · " + lead.id, "Lead guardado en data/leads.json. Abriendo tu plan de mitigación.");
          generarReporte(lead);
        });
      });
    }

    var formAuditoria = $("#formAuditoria");
    if (formAuditoria) {
      formAuditoria.addEventListener("submit", function (e) {
        e.preventDefault();
        enviarLead(formAuditoria).then(function (lead) {
          if (!lead) return;
          $("#auditoriaOk").style.display = "block";
          $("#auditoriaFolio").textContent = lead.id;
          toast("Auditoría solicitada · " + lead.id, "Estatus AUDITORIA_SOLICITADA registrado en la Capa 3.");
          refrescarContador();
        });
      });
    }

    // Limpia el error del campo al corregirlo.
    $$("form .input").forEach(function (campo) {
      campo.addEventListener("input", function () {
        campo.classList.remove("is-error");
        var caja = campo.closest(".input-group");
        var msg = caja ? $(".err", caja) : null;
        if (msg) msg.classList.remove("is-visible");
      });
    });
  }

  /* ================================ FAQ ================================== */
  function iniciarFaq() {
    $$(".faq__q").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var item = btn.closest(".faq__item");
        var panel = $(".faq__a", item);
        var abierto = item.classList.contains("is-open");
        $$(".faq__item").forEach(function (otro) {
          otro.classList.remove("is-open");
          $(".faq__a", otro).style.maxHeight = null;
        });
        if (!abierto) {
          item.classList.add("is-open");
          panel.style.maxHeight = panel.scrollHeight + "px";
        }
      });
    });
  }

  /* ================== NAV MOVIL, REVEAL Y SCROLL MILESTONES ============== */
  function iniciarNav() {
    var burger = $("#navBurger");
    var menu = $("#navMobile");
    if (burger && menu) {
      burger.addEventListener("click", function () { menu.classList.toggle("is-open"); });
      $$("a", menu).forEach(function (a) {
        a.addEventListener("click", function () { menu.classList.remove("is-open"); });
      });
    }
    $$("[data-cta]").forEach(function (b) {
      b.addEventListener("click", function () { track("request_audit_click", { ubicacion: b.dataset.cta }); });
    });
  }

  function iniciarReveal() {
    if (!("IntersectionObserver" in window)) {
      $$(".reveal").forEach(function (el) { el.classList.add("is-in"); });
      return;
    }
    var obs = new IntersectionObserver(function (entradas) {
      entradas.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("is-in"); obs.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
    $$(".reveal").forEach(function (el) { obs.observe(el); });
  }

  function iniciarScrollMilestones() {
    var hitos = [25, 50, 75, 100];
    var vistos = {};
    var handler = debounce(function () {
      var alto = document.documentElement.scrollHeight - window.innerHeight;
      if (alto <= 0) return;
      var pct = Math.round((window.scrollY / alto) * 100);
      hitos.forEach(function (h) {
        if (pct >= h && !vistos[h]) { vistos[h] = true; track("scroll_milestone", { profundidad: h }); }
      });
    }, 200);
    window.addEventListener("scroll", handler, { passive: true });
  }

  /* ======================= ESTADO DE LA CAPA 2 / 3 ======================= */
  function refrescarContador() {
    fetch(API + "/api/leads/stats")
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) return;
        var el = $("#statLeads");
        if (el) el.textContent = j.stats.total;
        var agregado = $("#statPerdida");
        if (agregado) agregado.textContent = Calc.dineroCompacto(j.stats.perdida_anual_promedio_mxn, "MXN");
      })
      .catch(function () { /* la landing funciona aunque la API no responda */ });
  }

  function verificarSalud() {
    var el = $("#apiEstado");
    if (!el) return;
    fetch(API + "/api/health")
      .then(function (r) { return r.json(); })
      .then(function (j) {
        el.textContent = j.ok ? "API OK · " + j.persistencia.archivo : "API degradada";
        el.style.color = j.ok ? "var(--green)" : "var(--red)";
      })
      .catch(function () {
        el.textContent = "API sin conexión";
        el.style.color = "var(--red)";
      });
  }

  /* ================================ BOOT ================================= */
  document.addEventListener("DOMContentLoaded", function () {
    iniciarTicker();
    iniciarCalculadora();
    iniciarModales();
    iniciarFormularios();
    iniciarFaq();
    iniciarNav();
    iniciarReveal();
    iniciarScrollMilestones();
    verificarSalud();
    refrescarContador();
    $("#anio").textContent = new Date().getFullYear();
    track("view_landing_page", utmActuales());
  });
})();
