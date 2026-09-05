/* ==========================================================================
   DowntimeCO — Tabla de usuarios, roles y permisos
   --------------------------------------------------------------------------
   Módulo independiente, con forma de tabla relacional, para que la migración a
   Supabase Auth + Postgres sea una copia y no una reescritura:

     · USUARIOS  ≈ public.usuarios   (uno por persona; `email` es la clave)
     · ROLES     ≈ public.roles      (catálogo cerrado)
     · PERMISOS  ≈ columnas booleanas del rol, que en producción se traducen a
                   políticas de fila sobre las columnas financieras

   ⚠️ La contraseña vive aquí en claro porque esto es una MAQUETA. En el
   producto no existe este archivo: la sesión la emite Supabase Auth y el
   servidor decide qué columnas puede leer cada rol. No lo "endurezcas"
   añadiéndole capas de cliente; reemplázalo.
   ========================================================================== */
(function (global) {
  "use strict";

  var DOMINIO = "downtimeco.tech";
  var CLAVE_DEMO = "demo1234";

  /* ---------------------------------------------------------------- roles ---
     `permisos` es lo que cada vista PREGUNTA antes de pintar. Mover una
     capacidad de un rol a otro es una línea aquí, no un cambio de vista. */
  var ROLES = [
    {
      id: "direccion",
      etiqueta: "Dirección y Finanzas",
      inicio: "direccion.html",
      permisos: { verMontos: true, verTarifas: true, exportar: true, registrarParo: false, validarParo: false }
    },
    {
      id: "operaciones",
      etiqueta: "Operaciones y Mantenimiento",
      inicio: "operaciones.html",
      permisos: { verMontos: true, verTarifas: false, exportar: false, registrarParo: true, validarParo: true }
    },
    {
      id: "operador",
      etiqueta: "Operador de Piso",
      inicio: "operador.html",
      permisos: { verMontos: false, verTarifas: false, exportar: false, registrarParo: true, validarParo: false }
    }
  ];

  /* ------------------------------------------------------------- usuarios ---
     `iniciales` es un campo propio y no se deriva del nombre: la insignia es
     identidad visual, no una abreviatura calculada. */
  var USUARIOS = [
    {
      id: "usr-001",
      email: "alex@" + DOMINIO,
      nombre: "Alejandro Huerta",
      iniciales: "AH",
      puesto: "Dirección General y Finanzas",
      rol: "direccion"
    },
    {
      id: "usr-002",
      email: "alondra@" + DOMINIO,
      nombre: "Alondra González",
      iniciales: "AG",
      puesto: "Gerencia de Operaciones y Mantenimiento",
      rol: "operaciones"
    },
    {
      id: "usr-003",
      email: "helio@" + DOMINIO,
      nombre: "Helio Huerta",
      iniciales: "HH",
      puesto: "Operador de Piso",
      rol: "operador"
    }
  ];

  function rol(id) {
    for (var i = 0; i < ROLES.length; i++) if (ROLES[i].id === id) return ROLES[i];
    return null;
  }

  /** Usuario + los campos de su rol, que es como llegaría de un JOIN. */
  function conRol(usuario) {
    if (!usuario) return null;
    var r = rol(usuario.rol);
    return {
      id: usuario.id,
      email: usuario.email,
      nombre: usuario.nombre,
      iniciales: usuario.iniciales,
      puesto: usuario.puesto,
      rol: usuario.rol,
      etiquetaRol: r ? r.etiqueta : usuario.rol,
      inicio: r ? r.inicio : "index.html",
      permisos: r ? r.permisos : {}
    };
  }

  function porEmail(email) {
    var buscado = String(email || "").trim().toLowerCase();
    for (var i = 0; i < USUARIOS.length; i++) {
      if (USUARIOS[i].email === buscado) return conRol(USUARIOS[i]);
    }
    return null;
  }

  function porRol(idRol) {
    for (var i = 0; i < USUARIOS.length; i++) {
      if (USUARIOS[i].rol === idRol) return conRol(USUARIOS[i]);
    }
    return null;
  }

  function todos() {
    return USUARIOS.map(conRol);
  }

  /** Único punto que compara credenciales. En producción, Supabase Auth. */
  function autenticar(email, clave) {
    var usuario = porEmail(email);
    if (!usuario || String(clave) !== CLAVE_DEMO) return null;
    return usuario;
  }

  global.Usuarios = {
    DOMINIO: DOMINIO,
    CLAVE_DEMO: CLAVE_DEMO,
    ROLES: ROLES,
    todos: todos,
    rol: rol,
    porEmail: porEmail,
    porRol: porRol,
    autenticar: autenticar
  };
})(window);
