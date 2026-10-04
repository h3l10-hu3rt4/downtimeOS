'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { fetchConSesion, guardarSesionNavegador, tokensVigentesDeSesion } from '../../lib/sesion-navegador.js';
import { copyEstadoActivacion } from '../../lib/estado-activacion.js';
import { PASSWORD_MIN_LENGTH, passwordTieneLongitudInvalida } from '../../lib/password.js';

export default function ActivarCuenta() {
  const [cliente, setCliente] = useState(null);
  const [lista, setLista] = useState(false);
  const [modoRegistro, setModoRegistro] = useState(false);
  const [enlaceInvalido, setEnlaceInvalido] = useState(false);
  const [flujoInvitacion, setFlujoInvitacion] = useState(false);
  const [requiereContrasena, setRequiereContrasena] = useState(false);
  const [datosInvitacion, setDatosInvitacion] = useState(null);
  const [estado, setEstado] = useState('Validando el enlace seguro…');
  const [estadoEnlace, setEstadoEnlace] = useState('validando');
  const [enlaceAcceso, setEnlaceAcceso] = useState('/acceso');
  const [procesando, setProcesando] = useState(false);

  useEffect(() => {
    let vigente = true;
    let suscripcion;
    let temporizadorCallback;
    async function inicializar() {
      const parametros = new URLSearchParams(window.location.search);
      const fragmento = new URLSearchParams(window.location.hash.slice(1));
      const esFlujoInvitacion = parametros.get('flujo') === 'invitacion';
      const tipo = fragmento.get('type');
      const esRegistro = !esFlujoInvitacion && tipo === 'signup';
      const esAccesoExistente = !esFlujoInvitacion && tipo === 'magiclink';
      const hayErrorProveedor = ['error', 'error_code', 'error_description'].some((clave) => parametros.has(clave) || fragmento.has(clave));
      const marcarEnlaceInvalido = (mensaje, flujo = {}, estadoFinal = 'invalido') => {
        setModoRegistro(Boolean(flujo.registro));
        setFlujoInvitacion(Boolean(flujo.invitacion));
        setEnlaceAcceso(flujo.registro ? '/acceso?returnTo=%2Fconfigurar-planta' : '/acceso');
        setEnlaceInvalido(true);
        setEstadoEnlace(estadoFinal);
        setEstado(mensaje);
      };

      setModoRegistro(esRegistro);
      setFlujoInvitacion(esFlujoInvitacion);
      setEnlaceAcceso(esRegistro ? '/acceso?returnTo=%2Fconfigurar-planta' : '/acceso');
      if (esFlujoInvitacion) {
        const invitacionId = parametros.get('invitacion') || '';
        const tokenAceptacion = parametros.get('token') || '';
        const invitacionValida = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(invitacionId)
          && /^[A-Za-z0-9_-]{40,64}$/.test(tokenAceptacion);
        if (!invitacionValida) {
          marcarEnlaceInvalido('Esta invitación no es válida o ya venció. Pide a la persona que te invitó que reenvíe el enlace.', { invitacion: true });
          return;
        }
        setDatosInvitacion({ id: invitacionId, token: tokenAceptacion });
        setRequiereContrasena(parametros.get('configurar') === '1');
      }
      if (hayErrorProveedor) {
        if (esFlujoInvitacion) {
          marcarEnlaceInvalido('La invitación expiró o ya se utilizó. Pide a la persona que te invitó que reenvíe el enlace.', { invitacion: true });
        } else if (esRegistro) {
          marcarEnlaceInvalido('El enlace de confirmación expiró o ya se utilizó. Inicia sesión para retomar la configuración de tu planta.', { registro: true });
        } else {
          marcarEnlaceInvalido('Este enlace expiró o ya se utilizó. Si intentabas aceptar una invitación, pide que te reenvíen el enlace; si ya tienes cuenta, inicia sesión.', {});
        }
        return;
      }
      if (!esFlujoInvitacion && !esRegistro && !esAccesoExistente && !fragmento.has('access_token') && !parametros.has('code')) {
        marcarEnlaceInvalido('No recibimos un enlace de confirmación. Si acabas de registrarte, inicia sesión para retomar la configuración de tu planta. Si llegaste por una invitación, pide a quien te invitó que reenvíe el enlace.', { registro: true }, 'incompleto');
        return;
      }

      const respuesta = await fetch('/api/config');
      const configuracion = respuesta.ok ? await respuesta.json() : {};
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL || configuracion.supabase_url;
      const clave = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || configuracion.supabase_publishable_key;
      if (!url || !clave) throw new Error('La activación no está disponible por el momento.');
      // Signup uses Supabase's implicit confirmation link. Make browser URL
      // detection/persistence explicit so #access_token links are restored
      // before getSession() checks for a callback session.
      const auth = createClient(url, clave, { auth: {
        flowType: parametros.has('code') ? 'pkce' : 'implicit', detectSessionInUrl: true,
        persistSession: true, autoRefreshToken: true,
      } });
      if (!vigente) return;
      setCliente(auth);
      let finalizando = false;
      let sesionReconocida = false;
      async function completarCuenta(session, modo) {
        if (finalizando || !session?.access_token) return;
        finalizando = true; setEstado(modo === 'signup' ? 'Correo confirmado. Preparando tu planta…' : 'Enlace validado. Abriendo tu cuenta…');
        if (!guardarSesionNavegador({ access_token: session.access_token, refresh_token: session.refresh_token, user: session.user })) {
          finalizando = false;
          setEstado(modo === 'signup'
            ? 'Tu correo quedó confirmado, pero el navegador bloqueó el almacenamiento de sesión. Permítelo para este sitio e inicia sesión para continuar con la configuración.'
            : 'El enlace fue validado, pero el navegador bloqueó el almacenamiento de sesión. Permítelo para este sitio e inicia sesión para continuar.');
          return;
        }
        const cuentaResponse = await fetchConSesion('/api/cuenta', { headers: { authorization: `Bearer ${session.access_token}` } });
        const cuenta = cuentaResponse.ok ? await cuentaResponse.json() : null;
        if (!cuenta?.perfil) { finalizando = false; setEstado(modo === 'signup' ? 'Tu correo quedó confirmado, pero no encontramos la configuración de la planta. Inicia sesión o contacta soporte.' : 'No encontramos una planta asociada a este enlace. Inicia sesión o contacta a quien te invitó.'); return; }
        const tokensSesion = tokensVigentesDeSesion(session);
        if (!guardarSesionNavegador({ ...cuenta, ...tokensSesion })) {
          finalizando = false;
          setEstado(modo === 'signup'
            ? 'Tu correo quedó confirmado, pero no pudimos guardar la sesión en este navegador. Permite el almacenamiento e inicia sesión para configurar la planta.'
            : 'El enlace fue validado, pero no pudimos guardar la sesión en este navegador. Permite el almacenamiento e inicia sesión para continuar.');
          return;
        }
        setEstado(modo === 'signup' ? 'Abriendo la configuración de tu planta…' : 'Abriendo tu planta…');
        const destino = (cuenta.plantas_disponibles || []).length > 1 ? '/plantas' : cuenta.perfil.onboarding_completado_en ? ({ direccion: '/direccion', admin: '/direccion', finanzas: '/direccion', operaciones: '/operaciones', operador: '/operador' }[cuenta.perfil.rol] || '/direccion') : '/configurar-planta';
        setTimeout(() => location.assign(destino), 500);
      }
      const reconocer = (event, session) => {
        if (session?.access_token) {
          sesionReconocida = true;
          clearTimeout(temporizadorCallback);
          setEstadoEnlace('validado');
        }
        if (esFlujoInvitacion && session && ['SIGNED_IN', 'INITIAL_SESSION', 'USER_UPDATED', 'PASSWORD_RECOVERY'].includes(event)) {
          setLista(true);
          setEstado(parametros.get('configurar') === '1'
            ? 'Enlace validado. Crea una contraseña para tu cuenta y acepta la invitación.'
            : 'Enlace validado. Confirma que aceptas el acceso a la planta.');
          return;
        }
        if (esRegistro && session && ['SIGNED_IN', 'INITIAL_SESSION', 'USER_UPDATED'].includes(event)) {
          setTimeout(() => completarCuenta(session, 'signup').catch(() => { finalizando = false; setEstado('Correo confirmado, pero no pudimos abrir la planta. Inicia sesión para continuar.'); }), 0);
          return;
        }
        if (esAccesoExistente && session && ['SIGNED_IN', 'INITIAL_SESSION'].includes(event)) {
          setTimeout(() => completarCuenta(session, 'magiclink').catch(() => { finalizando = false; setEstado('No pudimos abrir la planta. Inicia sesión para continuar.'); }), 0);
          return;
        }
        if (session && !esFlujoInvitacion && !esRegistro && !esAccesoExistente) {
          marcarEnlaceInvalido('No pudimos identificar el propósito de este enlace. Inicia sesión o pide a quien te invitó que lo reenvíe.', {});
        }
      };
      const registro = auth.auth.onAuthStateChange(reconocer);
      suscripcion = registro.data.subscription;
      const { data } = await auth.auth.getSession();
      if (!vigente) return;
      if (data.session) reconocer('INITIAL_SESSION', data.session);
      if (!data.session && !sesionReconocida) {
        temporizadorCallback = setTimeout(() => {
          if (!vigente || sesionReconocida) return;
          setEstadoEnlace('error');
          setEstado('La validación está tardando más de lo esperado. El enlace todavía podría ser válido; vuelve a intentarlo antes de pedir uno nuevo.');
        }, 15000);
      }
    }
    inicializar().catch(() => {
      setEstadoEnlace('error');
      setEnlaceInvalido(true);
      setEstado('No pudimos verificar el enlace por un problema de conexión. Comprueba tu conexión e inténtalo de nuevo.');
    });
    return () => { vigente = false; clearTimeout(temporizadorCallback); suscripcion?.unsubscribe(); };
  }, []);

  async function enviar(evento) {
    evento.preventDefault();
    if (procesando) return;
    setProcesando(true);
    try {
      const datos = Object.fromEntries(new FormData(evento.currentTarget));
      if (!cliente) { setEstado('La invitación todavía no está lista.'); return; }
      const { data: sesion } = await cliente.auth.getSession();
      if (!sesion.session) { setEstado('Tu enlace venció o no se validó. Solicita uno nuevo al administrador de la cuenta.'); return; }
      let sesionActual = sesion.session;

      if (flujoInvitacion) {
        if (!datosInvitacion?.id || !datosInvitacion?.token) { setEstado('El enlace de invitación no es válido o ya venció.'); return; }
        if (requiereContrasena) {
          if (datos.password !== datos.confirmar) { setEstado('Las contraseñas no coinciden.'); return; }
          if (passwordTieneLongitudInvalida(datos.password)) { setEstado(`La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`); return; }
          setEstado('Guardando tu contraseña…');
          const { error: errorContrasena } = await cliente.auth.updateUser({ password: datos.password });
          if (errorContrasena) { setEstado('No pudimos guardar la contraseña. Solicita un enlace nuevo al administrador.'); return; }
          const { data: sesionActualizada } = await cliente.auth.getSession();
          if (!sesionActualizada.session) { setEstado('La contraseña quedó guardada, pero tu sesión venció. Inicia sesión y pide al administrador que reenvíe la invitación.'); return; }
          sesionActual = sesionActualizada.session;
        }
        setEstado('Aceptando tu invitación…');
        const respuestaInvitacion = await fetch('/api/cuenta', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${sesionActual.access_token}` },
          body: JSON.stringify({ accion: 'aceptar-invitacion', invitacion_id: datosInvitacion.id, token: datosInvitacion.token }),
        });
        const resultadoAceptacion = await respuestaInvitacion.json().catch(() => null);
        const cuentaAceptada = respuestaInvitacion.ok ? resultadoAceptacion : null;
        if (!cuentaAceptada?.perfil) {
          setEstado(resultadoAceptacion?.error || 'No pudimos validar esta invitación. El acceso a la planta sigue bloqueado; pide al administrador un enlace nuevo.');
          return;
        }
        if (!guardarSesionNavegador({ ...cuentaAceptada, access_token: sesionActual.access_token, refresh_token: sesionActual.refresh_token })) {
          setEstado('La invitación ya fue aceptada, pero el navegador bloqueó el almacenamiento de sesión. Permite el almacenamiento para este sitio e inicia sesión para entrar a la planta.');
          return;
        }
        setEstado('Invitación aceptada. Abriendo tu planta…');
        const destinoAceptado = (cuentaAceptada.plantas_disponibles || []).length > 1 ? '/plantas' : cuentaAceptada.perfil.onboarding_completado_en ? ({ direccion: '/direccion', admin: '/direccion', finanzas: '/direccion', operaciones: '/operaciones', operador: '/operador' }[cuentaAceptada.perfil.rol] || '/direccion') : '/configurar-planta';
        setTimeout(() => location.assign(destinoAceptado), 500);
        return;
      }

      if (datos.password !== datos.confirmar) { setEstado('Las contraseñas no coinciden.'); return; }
      setEstado('Guardando tu contraseña…');
      const { error } = await cliente.auth.updateUser({ password: datos.password });
      if (error) { setEstado('No pudimos guardar la contraseña. Solicita un nuevo enlace de invitación.'); return; }
      const sesionActualizada = await cliente.auth.getSession();
      if (!sesionActualizada.data.session) { setEstado('Contraseña creada. Ya puedes iniciar sesión.'); return; }
      const session = sesionActualizada.data.session;
      if (!guardarSesionNavegador({ access_token: session.access_token, refresh_token: session.refresh_token, user: session.user })) {
        setEstado(flujoInvitacion
          ? 'La contraseña se actualizó, pero el navegador bloqueó el almacenamiento. Permítelo e inicia sesión para aceptar la invitación.'
          : 'La contraseña se actualizó, pero el navegador bloqueó el almacenamiento. Permítelo e inicia sesión para continuar.');
        return;
      }
      const respuesta = await fetchConSesion('/api/cuenta', { headers: { authorization: `Bearer ${session.access_token}` } });
      const cuenta = respuesta.ok ? await respuesta.json() : null;
      if (!cuenta?.perfil) { setEstado('Contraseña creada. Inicia sesión para continuar.'); return; }
      const tokensSesion = tokensVigentesDeSesion(session);
      if (!guardarSesionNavegador({ ...cuenta, ...tokensSesion })) {
        setEstado('Tu cuenta está lista, pero el navegador bloqueó el almacenamiento de sesión. Permítelo e inicia sesión para continuar.');
        return;
      }
      setEstado('Tu cuenta está lista. Abriendo tu planta…');
      const destino = (cuenta.plantas_disponibles || []).length > 1 ? '/plantas' : cuenta.perfil.onboarding_completado_en ? ({ direccion: '/direccion', admin: '/direccion', finanzas: '/direccion', operaciones: '/operaciones', operador: '/operador' }[cuenta.perfil.rol] || '/direccion') : '/configurar-planta';
      setTimeout(() => location.assign(destino), 500);
    } catch {
      setEstado('No pudimos confirmar esta acción por un problema de conexión. Recarga la página y revisa el estado de tu invitación antes de volver a intentarlo.');
    } finally {
      setProcesando(false);
    }
  }

  return <main className="auth-page"><section className="auth-card"><div className="auth-card__top"><p className="auth-brand">DOWNTIME<span>OS</span></p><span className="auth-status"><i /> ACTIVACIÓN SEGURA</span></div><p className="auth-kicker">CONTROL DE PLANTA / ACTIVACIÓN SEGURA</p><h1>{estadoEnlace === 'validando' ? 'Validando enlace seguro…' : estadoEnlace === 'error' ? 'No pudimos verificar el enlace' : enlaceInvalido ? 'Revisa tu enlace' : 'Activa tu cuenta'}</h1><p className="auth-copy">{estadoEnlace === 'error' ? 'Comprueba tu conexión e inténtalo de nuevo. Si el enlace venció, solicita otro.' : copyEstadoActivacion({ enlaceInvalido, flujoInvitacion, modoRegistro, estadoEnlace })}</p>
    {lista && (flujoInvitacion || !modoRegistro) ? <form onSubmit={enviar} className="auth-form">{requiereContrasena ? <><label>Nueva contraseña<input name="password" type="password" minLength={PASSWORD_MIN_LENGTH} autoComplete="new-password" required placeholder={`Mínimo ${PASSWORD_MIN_LENGTH} caracteres`} /></label><label>Confirmar contraseña<input name="confirmar" type="password" minLength={PASSWORD_MIN_LENGTH} autoComplete="new-password" required /></label></> : null}<button type="submit" className="btn btn--primary btn--block auth-submit" disabled={procesando}>{procesando ? 'Procesando…' : flujoInvitacion ? 'Aceptar invitación' : 'Activar cuenta'}</button></form> : null}
    <p aria-live="polite" className="auth-state">{estado}</p>{estadoEnlace === 'error' ? <button className="btn btn--secondary" type="button" onClick={() => location.reload()}>Intentar de nuevo</button> : null}<p className="auth-footer"><a href={enlaceAcceso}>{modoRegistro ? 'Iniciar sesión para configurar mi planta' : 'Volver al inicio de sesión'}</a></p>
  </section></main>;
}
