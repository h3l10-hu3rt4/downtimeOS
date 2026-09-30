'use client';
import { useState } from 'react';

const destino = (rol) => ({ direccion: '/direccion', operaciones: '/operaciones', operador: '/operador' }[rol] || '/direccion');
export default function Acceso() {
  const [estado, setEstado] = useState('');
  async function enviar(evento) {
    evento.preventDefault(); setEstado('Validando acceso…');
    const datos = Object.fromEntries(new FormData(evento.currentTarget));
    const respuesta = await fetch('/api/cuenta', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accion: 'inicio', ...datos }) });
    const cuerpo = await respuesta.json();
    if (!respuesta.ok) return setEstado(cuerpo.error || 'No fue posible iniciar sesión.');
    localStorage.setItem('downtimeos_sesion', JSON.stringify(cuerpo));
    location.assign(destino(cuerpo.perfil.rol));
  }
  return <main className="auth-page"><section className="auth-card"><div className="auth-card__top"><p className="auth-brand">DOWNTIME<span>OS</span></p><span className="auth-status"><i /> SISTEMA OPERATIVO</span></div><p className="auth-kicker">CONTROL DE PLANTA / ACCESO</p><h1>Acceso a tu planta</h1><p className="auth-copy">Consulta y opera los paros de tu línea de producción.</p><form onSubmit={enviar} className="auth-form"><label>Correo de trabajo<input name="email" type="email" placeholder="correo@empresa.com" required /></label><label>Contraseña<input name="password" type="password" placeholder="••••••••••" required /></label><button type="submit" className="btn btn--primary btn--block auth-submit">Iniciar sesión <span>→</span></button></form><p aria-live="polite" className="auth-state">{estado}</p><p className="auth-links"><a href="/recuperar">¿Olvidaste tu contraseña?</a></p><p className="auth-footer">¿Tu empresa es nueva? <a href="/registro">Crea la cuenta de tu planta</a>.</p></section></main>;
}
