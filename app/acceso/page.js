'use client';
import { useState } from 'react';
import { destinoDeParametros, destinoTablero } from './return-to.js';
import { guardarSesionNavegador } from '../../lib/sesion-navegador.js';
import LocalEmailNotice from '../_components/LocalEmailNotice.js';

const destino = (perfil, plantas) => {
  if ((plantas || []).length > 1) return '/plantas';
  if (!perfil?.onboarding_completado_en) return '/configurar-planta';
  return destinoTablero(perfil) || '/acceso';
};
export default function Acceso() {
  const [estado, setEstado] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [reenviando, setReenviando] = useState(false);
  const [mostrarReenvio, setMostrarReenvio] = useState(false);
  const [email, setEmail] = useState('');
  function destinoSolicitado(perfil) {
    return destinoDeParametros(new URLSearchParams(window.location.search), perfil);
  }
  async function enviar(evento) {
    evento.preventDefault();
    if (enviando) return;
    setEnviando(true); setEstado('Validando acceso…');
    const datos = Object.fromEntries(new FormData(evento.currentTarget));
    setEmail(String(datos.email || '').trim());
    try {
      const respuesta = await fetch('/api/cuenta', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accion: 'inicio', ...datos }) });
      const cuerpo = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) { setMostrarReenvio(respuesta.status === 401); setEstado(cuerpo.error || 'No fue posible iniciar sesión.'); return; }
      if (!cuerpo.access_token || !cuerpo.perfil) { setEstado('El servidor no confirmó una sesión válida. Inténtalo de nuevo.'); return; }
      if (!guardarSesionNavegador(cuerpo)) {
        setEstado('El acceso fue validado, pero el navegador bloqueó el almacenamiento de sesión. Permite el almacenamiento para este sitio e inicia sesión de nuevo.');
        return;
      }
      location.assign(destinoSolicitado(cuerpo.perfil) || destino(cuerpo.perfil, cuerpo.plantas_disponibles));
    } catch {
      setEstado('No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.');
    } finally {
      setEnviando(false);
    }
  }
  async function reenviarConfirmacion() {
    if (reenviando || !email) return;
    setReenviando(true);
    try {
      const respuesta = await fetch('/api/cuenta', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accion: 'reenviar-confirmacion', email }) });
      const cuerpo = await respuesta.json().catch(() => ({}));
      setEstado(respuesta.ok
        ? 'Solicitud procesada. Si la cuenta necesita confirmar el correo, revisa el buzón configurado para este entorno.'
        : cuerpo.error || 'No pudimos procesar la solicitud. Inténtalo de nuevo en unos minutos.');
    } catch {
      setEstado('No pudimos conectar con el servidor. Inténtalo de nuevo en unos minutos.');
    } finally {
      setReenviando(false);
    }
  }
  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-card__top"><p className="auth-brand">DOWNTIME<span>OS</span></p><span className="auth-status"><i /> SISTEMA OPERATIVO</span></div>
        <p className="auth-kicker">CONTROL DE PLANTA / ACCESO</p>
        <h1>Acceso a tu planta</h1>
        <p className="auth-copy">Consulta y opera los paros de tu línea de producción.</p>
        <LocalEmailNotice />
        <form onSubmit={enviar} className="auth-form">
          <label>Correo de trabajo<input name="email" type="email" autoComplete="email" placeholder="correo@empresa.com" value={email} onChange={(evento) => setEmail(evento.target.value)} required /></label>
          <label>Contraseña<input name="password" type="password" autoComplete="current-password" placeholder="••••••••••" required /></label>
          <button type="submit" className="btn btn--primary btn--block auth-submit" disabled={enviando}>{enviando ? 'Validando…' : 'Iniciar sesión'}</button>
        </form>
        <p aria-live="polite" className="auth-state">{estado}</p>
        {mostrarReenvio ? <p className="auth-links"><button type="button" className="auth-inline-button" onClick={reenviarConfirmacion} disabled={reenviando || !email}>{reenviando ? 'Enviando…' : '¿No confirmaste tu correo? Reenviar enlace'}</button></p> : null}
        <p className="auth-links"><a href="/recuperar">¿Olvidaste tu contraseña?</a></p>
        <p className="auth-footer">¿Tu empresa es nueva? <a href="/registro">Crea la cuenta de tu planta</a>.</p>
      </section>
    </main>
  );
}
