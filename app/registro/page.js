'use client';
import { useEffect, useRef, useState } from 'react';
import { guardarSesionNavegador } from '../../lib/sesion-navegador.js';
import { urlMailpitLocal } from '../../lib/mailpit-local.js';
export default function Registro() {
  const [estado, setEstado] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [registroAceptado, setRegistroAceptado] = useState(false);
  const [requiereConfirmacion, setRequiereConfirmacion] = useState(false);
  const [requiereInicioSesion, setRequiereInicioSesion] = useState(false);
  const [buzonLocal, setBuzonLocal] = useState(false);
  const [urlBuzonLocal, setUrlBuzonLocal] = useState('');
  const [emailRegistro, setEmailRegistro] = useState('');
  const [reenviando, setReenviando] = useState(false);
  const envioEnCurso = useRef(false);
  useEffect(() => {
    let cancelado = false;
    fetch('/api/config').then((respuesta) => respuesta.ok ? respuesta.json() : null).then((configuracion) => {
      const url = urlMailpitLocal(configuracion?.supabase_url);
      if (!cancelado) { setUrlBuzonLocal(url); setBuzonLocal(Boolean(url)); }
    }).catch(() => {});
    return () => { cancelado = true; };
  }, []);
  async function enviar(evento) {
    evento.preventDefault();
    if (envioEnCurso.current || registroAceptado) return;
    envioEnCurso.current = true;
    setEnviando(true); setEstado('Creando empresa y planta…');
    const datos = Object.fromEntries(new FormData(evento.currentTarget));
    setEmailRegistro(String(datos.email || '').trim());
    try {
      const respuesta = await fetch('/api/cuenta', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ accion:'registro', ...datos }) });
      const cuerpo = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) return setEstado(cuerpo.error || 'No fue posible crear la cuenta. Inténtalo de nuevo.');
      setRegistroAceptado(true);
      if (cuerpo.requiere_confirmacion) {
        setRequiereConfirmacion(true);
        setEstado('Tu empresa quedó registrada. Confirma el correo para continuar; el enlace abrirá la configuración de tu planta.');
        return;
      }
      if (cuerpo.requiere_inicio_sesion) {
        setRequiereInicioSesion(true);
        setEstado('Tu empresa ya está creada, pero no pudimos iniciar sesión automáticamente. Inicia sesión con tu correo y contraseña para continuar.');
        return;
      }
      if (!cuerpo.access_token || !cuerpo.perfil) {
        setRequiereInicioSesion(true);
        setEstado('Tu empresa quedó registrada. Inicia sesión con tu correo y contraseña para configurar tu planta.');
        return;
      }
      if (!guardarSesionNavegador(cuerpo)) {
        setRegistroAceptado(true);
        setRequiereInicioSesion(true);
        setEstado('La empresa ya quedó creada. El navegador bloqueó el almacenamiento de sesión; permite el almacenamiento para este sitio e inicia sesión para configurar la planta.');
        return;
      }
      setEstado('Cuenta creada. Abriendo tu planta…');
      setTimeout(() => location.assign('/configurar-planta'), 350);
    } catch {
      setEstado('No pudimos conectar con el servidor. Revisa tu conexión; si el registro sí se completó, intenta iniciar sesión antes de volver a registrarte.');
    } finally {
      envioEnCurso.current = false;
      setEnviando(false);
    }
  }
  async function reenviarConfirmacion() {
    if (reenviando || !emailRegistro) return;
    setReenviando(true);
    setEstado('Solicitando un nuevo enlace…');
    try {
      const respuesta = await fetch('/api/cuenta', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accion: 'reenviar-confirmacion', email: emailRegistro }) });
      const cuerpo = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) throw new Error(cuerpo.error || 'No pudimos solicitar otro enlace. Espera un momento e inténtalo de nuevo.');
      setEstado('Si la cuenta todavía necesita confirmación, se envió un nuevo enlace. Revisa tu bandeja y el correo no deseado.');
    } catch (error) {
      setEstado(error.message || 'No pudimos confirmar el envío. Espera un momento e inténtalo de nuevo.');
    } finally {
      setReenviando(false);
    }
  }
  return <main className="auth-page"><section className="auth-card auth-card--register"><div className="auth-card__top"><p className="auth-brand">DOWNTIME<span>OS</span></p><span className="auth-status"><i /> ALTA DE PLANTA</span></div><p className="auth-kicker">CONTROL DE PLANTA / REGISTRO</p><h1>Configura tu primera planta</h1><p className="auth-copy">Crea la cuenta de Dirección. Después podrás invitar a Operaciones y a los operadores de piso.</p><form onSubmit={enviar} className="auth-form"><label>Empresa<input name="empresa" autoComplete="organization" placeholder="Nombre de la empresa" minLength="2" required /></label><label>Planta principal<input name="planta" autoComplete="organization-title" placeholder="Nombre de la planta" minLength="2" required /></label><label>Tu nombre<input name="nombre" autoComplete="name" placeholder="Nombre completo" required /></label><label>Correo de trabajo<input name="email" type="email" autoComplete="email" placeholder="correo@empresa.com" required /></label><label>Contraseña<input name="password" type="password" autoComplete="new-password" minLength="10" placeholder="Mínimo 10 caracteres" required /></label><button type="submit" className="btn btn--primary btn--block auth-submit" disabled={enviando || registroAceptado}>{enviando ? 'Creando empresa…' : registroAceptado ? 'Solicitud registrada' : 'Crear empresa'}</button></form><p aria-live="polite" className="auth-state">{estado}</p>{registroAceptado && (requiereConfirmacion || requiereInicioSesion) ? <p className="auth-links"><a href="/acceso?returnTo=%2Fconfigurar-planta">Iniciar sesión para configurar mi planta</a></p> : null}{requiereConfirmacion ? <><button className="btn btn--secondary" type="button" onClick={reenviarConfirmacion} disabled={reenviando || !emailRegistro}>{reenviando ? 'Solicitando enlace…' : 'Reenviar correo de confirmación'}</button>{buzonLocal ? <p className="team-email-note" role="note">Estás usando el entorno local. Abre <a href={urlBuzonLocal} target="_blank" rel="noreferrer">Mailpit</a> para encontrar el correo de confirmación; no se envía a Gmail ni Outlook.</p> : null}</> : null}<p className="auth-footer"><a href="/acceso">Ya tengo una cuenta</a>.</p></section></main>;
}
