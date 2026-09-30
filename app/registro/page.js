'use client';
import { useState } from 'react';
export default function Registro() {
  const [estado, setEstado] = useState('');
  async function enviar(evento) {
    evento.preventDefault(); setEstado('Creando empresa y planta…');
    const datos = Object.fromEntries(new FormData(evento.currentTarget));
    const respuesta = await fetch('/api/cuenta', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ accion:'registro', ...datos }) });
    const cuerpo = await respuesta.json();
    if (!respuesta.ok) return setEstado(cuerpo.error || 'No fue posible crear la cuenta.');
    localStorage.setItem('downtimeos_sesion', JSON.stringify(cuerpo));
    setEstado('Cuenta creada. Abriendo tu planta…');
    setTimeout(() => location.assign('/direccion?onboarding=1'), 350);
  }
  return <main className="auth-page"><section className="auth-card auth-card--register"><div className="auth-card__top"><p className="auth-brand">DOWNTIME<span>OS</span></p><span className="auth-status"><i /> ALTA DE PLANTA</span></div><p className="auth-kicker">CONTROL DE PLANTA / REGISTRO</p><h1>Configura tu primera planta</h1><p className="auth-copy">Crea la cuenta de Dirección. Después podrás invitar a Operaciones y a los operadores de piso.</p><form onSubmit={enviar} className="auth-form"><label>Empresa<input name="empresa" placeholder="Nombre de la empresa" required /></label><label>Planta principal<input name="planta" placeholder="Nombre de la planta" required /></label><label>Tu nombre<input name="nombre" placeholder="Nombre completo" required /></label><label>Correo de trabajo<input name="email" type="email" placeholder="correo@empresa.com" required /></label><label>Contraseña<input name="password" type="password" minLength="10" placeholder="Mínimo 10 caracteres" required /></label><button type="submit" className="btn btn--primary btn--block auth-submit">Crear empresa <span>→</span></button></form><p aria-live="polite" className="auth-state">{estado}</p><p className="auth-footer"><a href="/acceso">Ya tengo una cuenta</a>.</p></section></main>;
}
