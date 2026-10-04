const CLAVE_SESION = 'downtimeos_sesion';
let refrescoCompartido = null;

function idUsuarioSesion(sesion) {
  return sesion?.user?.id || sesion?.perfil?.user_id || null;
}

function mismaIdentidadSesion(primera, segunda) {
  const idPrimera = idUsuarioSesion(primera);
  const idSegunda = idUsuarioSesion(segunda);
  if (idPrimera || idSegunda) return Boolean(idPrimera && idSegunda && idPrimera === idSegunda);
  return Boolean(primera?.access_token && primera.access_token === segunda?.access_token);
}

function leerSesion(storage) {
  try {
    const sesion = JSON.parse(storage?.getItem(CLAVE_SESION) || '{}');
    return sesion && typeof sesion === 'object' && !Array.isArray(sesion) ? sesion : {};
  }
  catch { return {}; }
}
/** Lee la sesión sin romper el render si el almacenamiento está corrupto o bloqueado. */
export function leerSesionNavegador() {
  try {
    if (typeof window === 'undefined') return {};
    return leerSesion(window.localStorage);
  } catch { return {}; }
}

/** Persiste la sesión e informa si el navegador bloqueó el almacenamiento. */
export function guardarSesionNavegador(sesion) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    window.localStorage.setItem(CLAVE_SESION, JSON.stringify(sesion));
    return true;
  } catch { return false; }
}

/**
 * Recupera tokens renovados durante una petición sin copiar perfil/planta de
 * esa petición, y evita que una respuesta tardía de otra cuenta pise la sesión.
 */
export function tokensVigentesDeSesion(sesion) {
  const reciente = leerSesionNavegador();
  if (!reciente.access_token) return sesion;
  const mismaIdentidad = sesion?.user?.id && reciente.user?.id
    ? sesion.user.id === reciente.user.id
    : sesion?.access_token === reciente.access_token;
  if (!mismaIdentidad) throw new Error('La sesión cambió en otra pestaña. Recarga la página antes de continuar.');
  return {
    ...sesion,
    access_token: reciente.access_token,
    refresh_token: reciente.refresh_token || sesion.refresh_token,
  };
}

function guardarSesion(storage, actual, renovada) {
  const perfilRenovado = actual.perfil?.planta_id
    && renovada.perfil?.planta_id !== actual.perfil.planta_id
    ? { ...renovada, perfil: actual.perfil, plantas_disponibles: actual.plantas_disponibles }
    : renovada;
  const siguiente = {
    ...actual,
    ...perfilRenovado,
    access_token: renovada.access_token,
    refresh_token: renovada.refresh_token,
  };
  storage.setItem(CLAVE_SESION, JSON.stringify(siguiente));
  return siguiente;
}

/** Ejecuta fetch con la sesión persistida; ante 401 renueva una vez y reintenta una vez. */
export async function fetchConSesion(input, init = {}) {
  let storage;
  try {
    if (typeof window === 'undefined') return fetch(input, init);
    storage = window.localStorage;
  } catch { return fetch(input, init); }
  if (!storage) return fetch(input, init);
  const sesionInicial = leerSesion(storage);
  const encabezados = new Headers(init.headers || {});
  const authorizationExplicita = encabezados.has('authorization');
  const bearerInicial = encabezados.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1] || null;
  const requestUsaSesionGuardada = !authorizationExplicita || bearerInicial === sesionInicial.access_token;
  if (sesionInicial.access_token && !encabezados.has('authorization')) {
    encabezados.set('authorization', `Bearer ${sesionInicial.access_token}`);
  }
  const peticion = { ...init, headers: encabezados };
  const primera = await fetch(input, peticion);
  if (primera.status !== 401 || !requestUsaSesionGuardada) return primera;

  const sesionTras401 = leerSesion(storage);
  if (!mismaIdentidadSesion(sesionInicial, sesionTras401)) return primera;
  if (sesionTras401.access_token && sesionTras401.access_token !== sesionInicial.access_token) {
    const headersActualizados = new Headers(init.headers || {});
    headersActualizados.set('authorization', `Bearer ${sesionTras401.access_token}`);
    return fetch(input, { ...init, headers: headersActualizados });
  }
  if (!(sesionTras401.refresh_token || sesionInicial.refresh_token)) return primera;

  const refreshToken = sesionTras401.refresh_token || sesionInicial.refresh_token;
  const identidad = idUsuarioSesion(sesionTras401) || `token:${sesionTras401.access_token}`;
  let renovada;
  try {
    if (!refrescoCompartido || refrescoCompartido.storage !== storage
      || refrescoCompartido.identidad !== identidad || refrescoCompartido.refreshToken !== refreshToken) {
      const contexto = { storage, identidad, refreshToken, promesa: null };
      const compartida = (async () => {
        const sesionActual = leerSesion(storage);
        if (!mismaIdentidadSesion(sesionInicial, sesionActual)) return null;
        if (sesionActual.access_token !== sesionInicial.access_token) return sesionActual;
        const refreshTokenActual = sesionActual.refresh_token || refreshToken;
        if (!refreshTokenActual || refreshTokenActual !== refreshToken) return null;
        const respuestaRefresh = await fetch('/api/cuenta', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(encabezados.has('x-downtimeos-planta')
              ? { 'x-downtimeos-planta': encabezados.get('x-downtimeos-planta') }
              : {}),
          },
          body: JSON.stringify({ accion: 'refrescar', refresh_token: refreshToken }),
        });
        if (!respuestaRefresh.ok) return null;
        const cuerpo = await respuestaRefresh.json();
        if (!cuerpo?.access_token || !cuerpo?.refresh_token || !cuerpo?.perfil) return null;
        const sesionAlGuardar = leerSesion(storage);
        if (!mismaIdentidadSesion(sesionInicial, sesionAlGuardar)) return null;
        if (sesionAlGuardar.access_token !== sesionInicial.access_token
          || (sesionAlGuardar.refresh_token && sesionAlGuardar.refresh_token !== refreshToken)) {
          return sesionAlGuardar;
        }
        return guardarSesion(storage, sesionAlGuardar, cuerpo);
      })();
      contexto.promesa = compartida;
      refrescoCompartido = contexto;
      compartida.then(
        () => { if (refrescoCompartido === contexto) refrescoCompartido = null; },
        () => { if (refrescoCompartido === contexto) refrescoCompartido = null; },
      );
    }
    renovada = await refrescoCompartido.promesa;
    if (!renovada) return primera;
  } catch {
    // Red y 5xx no invalidan por sí mismos la sesión almacenada.
    return primera;
  }

  const sesionActual = leerSesion(storage);
  if (!mismaIdentidadSesion(sesionInicial, sesionActual)) return primera;
  const accessTokenRenovado = sesionActual.access_token !== sesionInicial.access_token
    ? sesionActual.access_token : renovada.access_token;
  if (!accessTokenRenovado) return primera;

  const reintentoHeaders = new Headers(init.headers || {});
  reintentoHeaders.set('authorization', `Bearer ${accessTokenRenovado}`);
  return fetch(input, { ...init, headers: reintentoHeaders });
}
