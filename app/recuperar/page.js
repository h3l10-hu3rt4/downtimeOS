'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { PASSWORD_MIN_LENGTH, passwordTieneLongitudInvalida } from '../../lib/password.js';

export function estadoEnlaceRecuperacion(url) {
  const actual = new URL(url);
  const parametros = [new URLSearchParams(actual.search), new URLSearchParams(actual.hash.replace(/^#/, ''))];
  const error = parametros.some((p) => p.has('error') || p.has('error_code') || p.has('error_description'));
  return error ? 'invalido' : 'esperando';
}

export function tieneCallbackRecuperacion(url) {
  const actual = new URL(url);
  const query = new URLSearchParams(actual.search);
  const hash = new URLSearchParams(actual.hash.replace(/^#/, ''));
  return query.has('code') || (hash.has('access_token') && hash.has('refresh_token'));
}

export default function Recuperar() {
  const [modo, setModo] = useState('solicitar');
  const [estado, setEstado] = useState('');
  const [supabase, setSupabase] = useState(null);
  const [enlaceInvalido, setEnlaceInvalido] = useState(false);
  const [reintentarCallback, setReintentarCallback] = useState(false);
  const [enviando, setEnviando] = useState(false);
  useEffect(() => {
    let suscripcion;
    let cancelado = false;
    const callbackRecuperacion = tieneCallbackRecuperacion(window.location.href);
    async function inicializar() {
      if (estadoEnlaceRecuperacion(window.location.href) === 'invalido') {
        setEnlaceInvalido(true);
        return;
      }
      const respuesta = await fetch('/api/config');
      const configuracion = respuesta.ok ? await respuesta.json() : {};
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL || configuracion.supabase_url;
      const clave = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || configuracion.supabase_publishable_key;
      if (!url || !clave) {
        setEstado('Falta configurar Supabase en el servidor.');
        return;
      }
      // Los enlaces actuales de recuperación de Supabase suelen devolver los
      // tokens en el hash (implicit); si el proyecto emite PKCE, el callback
      // llega como ?code= y debe intercambiarse con el flujo correspondiente.
      const parametros = new URLSearchParams(window.location.search);
      const fetchAuth = (...argumentos) => fetch(...argumentos).catch((error) => {
        if (callbackRecuperacion && !cancelado) {
          setReintentarCallback(true);
          setEstado('No pudimos validar el enlace por un problema de conexión. Revisa tu conexión e inténtalo de nuevo.');
        }
        throw error;
      });
      const cliente = createClient(url, clave, { global: { fetch: fetchAuth }, auth: {
        flowType: parametros.has('code') ? 'pkce' : 'implicit', detectSessionInUrl: true,
        persistSession: true, autoRefreshToken: true,
      } });
      if (cancelado) return;
      setSupabase(cliente);
      suscripcion = cliente.auth.onAuthStateChange((evento, sesion) => {
        if (!cancelado && evento === 'PASSWORD_RECOVERY' && sesion?.access_token) {
          setEnlaceInvalido(false);
          setReintentarCallback(false);
          setModo('nueva');
        }
      });
    }
    inicializar().catch(() => {
      if (callbackRecuperacion) {
        setReintentarCallback(true);
        setEstado('No pudimos validar el enlace por un problema de conexión. Revisa tu conexión e inténtalo de nuevo.');
      } else setEstado('No fue posible cargar la configuración de recuperación.');
    });
    return () => { cancelado = true; suscripcion?.data?.subscription?.unsubscribe(); };
  }, []);
  async function enviar(evento) {
    evento.preventDefault();
    if (enviando) return;
    setEnviando(true);
    const datos = Object.fromEntries(new FormData(evento.currentTarget));
    try {
      if (modo === 'solicitar') {
        const respuesta = await fetch('/api/cuenta', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accion: 'recuperar', email: datos.email }) });
        const cuerpo = await respuesta.json().catch(() => ({}));
        setEstado(respuesta.ok
          ? 'Solicitud recibida. Si el correo está asociado a una cuenta, recibirás instrucciones para restablecer tu contraseña.'
          : cuerpo.error || 'No pudimos procesar la solicitud. Inténtalo de nuevo en unos minutos.');
        return;
      }
      if (datos.password !== datos.confirmar) { setEstado('Las contraseñas no coinciden.'); return; }
      if (passwordTieneLongitudInvalida(datos.password)) { setEstado(`La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`); return; }
      if (!supabase) { setEstado('El enlace de recuperación todavía no está listo.'); return; }
      const { error } = await supabase.auth.updateUser({ password: datos.password });
      setEstado(error ? 'No fue posible actualizar la contraseña.' : 'Contraseña actualizada. Ya puedes iniciar sesión.');
      if (!error) setTimeout(() => location.assign('/acceso'), 900);
    } catch {
      setEstado(modo === 'solicitar'
        ? 'No pudimos conectar con el servidor. Si no recibes el correo, inténtalo de nuevo en unos minutos.'
        : 'No pudimos confirmar el cambio de contraseña. Vuelve a abrir el enlace e inténtalo de nuevo.');
    } finally {
      setEnviando(false);
    }
  }
  return <main className="auth-page"><section className="auth-card"><div className="auth-card__top"><p className="auth-brand">DOWNTIME<span>OS</span></p><span className="auth-status"><i /> SEGURIDAD DE CUENTA</span></div><p className="auth-kicker">CONTROL DE PLANTA / RECUPERACIÓN</p><h1>{enlaceInvalido ? 'El enlace ya no es válido' : modo === 'solicitar' ? 'Recupera tu acceso' : 'Define una contraseña nueva'}</h1><p className="auth-copy">{enlaceInvalido ? 'El enlace expiró o ya fue utilizado. Solicita uno nuevo para restablecer tu contraseña.' : modo === 'solicitar' ? 'Te enviaremos un enlace seguro al correo asociado a tu cuenta.' : `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`}</p>{!enlaceInvalido && !reintentarCallback && <form onSubmit={enviar} className="auth-form">{modo === 'solicitar' ? <label>Correo de trabajo<input name="email" type="email" autoComplete="email" placeholder="correo@empresa.com" required /></label> : <><label>Nueva contraseña<input name="password" type="password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} required /></label><label>Confirmar contraseña<input name="confirmar" type="password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} required /></label></>}<button type="submit" className="btn btn--primary btn--block auth-submit" disabled={enviando}>{enviando ? 'Procesando…' : modo === 'solicitar' ? 'Enviar enlace' : 'Guardar contraseña'}</button></form>}{reintentarCallback && !enlaceInvalido && <button type="button" className="btn btn--primary btn--block auth-submit" onClick={() => window.location.reload()}>Reintentar validación</button>}{enlaceInvalido && <button type="button" className="btn btn--primary btn--block auth-submit" onClick={() => { setEnlaceInvalido(false); setModo('solicitar'); setEstado(''); }}>Solicitar un enlace nuevo</button>}<p aria-live="polite" className="auth-state">{estado}</p><p className="auth-footer"><a href="/acceso">Volver al inicio de sesión</a></p></section></main>;
}
