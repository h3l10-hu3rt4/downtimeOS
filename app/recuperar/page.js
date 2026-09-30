'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

export default function Recuperar() {
  const [modo, setModo] = useState('solicitar');
  const [estado, setEstado] = useState('');
  const [supabase, setSupabase] = useState(null);
  useEffect(() => {
    const cliente = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    setSupabase(cliente);
    const activar = () => setModo('nueva');
    const { data } = cliente.auth.onAuthStateChange((evento) => {
      if (evento === 'PASSWORD_RECOVERY') activar();
    });
    if (window.location.hash.includes('access_token')) activar();
    return () => data.subscription.unsubscribe();
  }, []);
  async function enviar(evento) {
    evento.preventDefault();
    const datos = Object.fromEntries(new FormData(evento.currentTarget));
    if (modo === 'solicitar') {
      const respuesta = await fetch('/api/cuenta', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accion: 'recuperar', email: datos.email }) });
      setEstado(respuesta.ok ? 'Si el correo existe, recibirás un enlace para recuperar tu contraseña.' : 'No fue posible solicitar la recuperación.');
      return;
    }
    if (datos.password !== datos.confirmar) return setEstado('Las contraseñas no coinciden.');
    if (!supabase) return setEstado('El enlace de recuperación todavía no está listo.');
    const { error } = await supabase.auth.updateUser({ password: datos.password });
    setEstado(error ? 'No fue posible actualizar la contraseña.' : 'Contraseña actualizada. Ya puedes iniciar sesión.');
    if (!error) setTimeout(() => location.assign('/acceso'), 900);
  }
  return <main className="auth-page"><section className="auth-card"><div className="auth-card__top"><p className="auth-brand">DOWNTIME<span>OS</span></p><span className="auth-status"><i /> SEGURIDAD DE CUENTA</span></div><p className="auth-kicker">CONTROL DE PLANTA / RECUPERACIÓN</p><h1>{modo === 'solicitar' ? 'Recupera tu acceso' : 'Define una contraseña nueva'}</h1><p className="auth-copy">{modo === 'solicitar' ? 'Te enviaremos un enlace seguro al correo asociado a tu cuenta.' : 'La contraseña debe tener al menos 10 caracteres.'}</p><form onSubmit={enviar} className="auth-form">{modo === 'solicitar' ? <label>Correo de trabajo<input name="email" type="email" placeholder="correo@empresa.com" required /></label> : <><label>Nueva contraseña<input name="password" type="password" minLength="10" required /></label><label>Confirmar contraseña<input name="confirmar" type="password" minLength="10" required /></label></>}<button type="submit" className="auth-submit">{modo === 'solicitar' ? 'Enviar enlace' : 'Guardar contraseña'} <span>→</span></button></form><p aria-live="polite" className="auth-state">{estado}</p><p className="auth-footer"><a href="/acceso">Volver al inicio de sesión</a></p></section></main>;
}
