'use client';
import { useCallback, useEffect, useState } from 'react';
import { fetchConSesion, leerSesionNavegador } from '../../lib/sesion-navegador.js';
import { destinoTablero } from '../acceso/return-to.js';

export default function ContactoWhatsApp() {
  const [token, setToken] = useState('');
  const [plantaId, setPlantaId] = useState('');
  const [telefono, setTelefono] = useState('');
  const [contacto, setContacto] = useState(null);
  const [consentimiento, setConsentimiento] = useState(false);
  const [verificacion, setVerificacion] = useState(null);
  const [enlaceVerificacion, setEnlaceVerificacion] = useState('');
  const [estado, setEstado] = useState('Cargando tu contacto…');
  const [procesando, setProcesando] = useState(false);
  const [destinoRegreso, setDestinoRegreso] = useState('/acceso?returnTo=%2Fcontacto-whatsapp');

  const cargar = useCallback(async (accessToken, selectedPlantId) => {
    const respuesta = await fetchConSesion('/api/planta/whatsapp-contacto', {
      headers: { authorization: `Bearer ${accessToken}`, 'x-downtimeos-planta': selectedPlantId },
    });
    const cuerpo = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) throw Object.assign(new Error(cuerpo.error || 'No se pudo consultar el contacto.'), { status: respuesta.status });
    setContacto(cuerpo.contacto || null);
    setConsentimiento(Boolean(cuerpo.contacto?.consentimiento_en));
    setVerificacion(cuerpo.verificacion || null);
    if (cuerpo.contacto?.telefono_e164) setTelefono(cuerpo.contacto.telefono_e164);
    if (cuerpo.contacto?.verificado_en) setEstado('Número verificado para esta planta.');
    else if (cuerpo.verificacion?.estado === 'pendiente') setEstado('Verificación pendiente: envía el mensaje prellenado desde el WhatsApp del número registrado.');
    else if (cuerpo.contacto?.telefono_e164 && cuerpo.contacto?.consentimiento_en) setEstado('Número guardado con consentimiento. Recibe avisos; para aceptar o rechazar paros, confirma que controlas este WhatsApp.');
    else setEstado('Agrega tu número y acepta recibir avisos para quedar registrado como destinatario de esta planta.');
    return cuerpo;
  }, []);

  useEffect(() => {
    const sesion = leerSesionNavegador();
    if (!sesion.access_token || !sesion.perfil?.planta_id) {
      location.replace('/acceso?returnTo=%2Fcontacto-whatsapp');
      return;
    }
    const destino = (sesion.plantas_disponibles || []).length > 1
      ? '/plantas'
      : !sesion.perfil.onboarding_completado_en
        ? '/configurar-planta'
        : destinoTablero(sesion.perfil);
    setDestinoRegreso(destino || '/acceso?returnTo=%2Fcontacto-whatsapp');
    setToken(sesion.access_token);
    setPlantaId(sesion.perfil.planta_id);
    cargar(sesion.access_token, sesion.perfil.planta_id).catch((error) => setEstado(error.message));
  }, [cargar]);

  async function guardarContacto(event) {
    event.preventDefault();
    setProcesando(true);
    setEstado('Guardando contacto…');
    try {
      const respuesta = await fetchConSesion('/api/planta/whatsapp-contacto', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-downtimeos-planta': plantaId },
        body: JSON.stringify({ accion: 'guardar_contacto', telefono, consentimiento }),
      });
      const cuerpo = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) throw new Error(cuerpo.error || 'No se pudo guardar el contacto.');
      setContacto(cuerpo.contacto || null);
      setEstado(cuerpo.mensaje || 'Número guardado. Aún no está verificado.');
    } catch (error) { setEstado(error.message); }
    finally { setProcesando(false); }
  }

  async function retirarConsentimiento() {
    if (!window.confirm('¿Retirar el consentimiento y eliminar tu número de esta planta?')) return;
    setProcesando(true);
    try {
      const respuesta = await fetchConSesion('/api/planta/whatsapp-contacto', {
        method: 'DELETE', headers: { authorization: `Bearer ${token}`, 'x-downtimeos-planta': plantaId },
      });
      const cuerpo = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) throw new Error(cuerpo.error || 'No se pudo retirar el consentimiento.');
      setContacto(null); setTelefono(''); setConsentimiento(false); setEstado(cuerpo.mensaje);
    } catch (error) { setEstado(error.message); }
    finally { setProcesando(false); }
  }

  async function iniciarVerificacion() {
    setProcesando(true);
    setEstado('Preparando verificación por WhatsApp…');
    setEnlaceVerificacion('');
    try {
      const respuesta = await fetchConSesion('/api/planta/whatsapp-contacto', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-downtimeos-planta': plantaId },
        body: JSON.stringify({ accion: 'reiniciar_verificacion_whatsapp', telefono, consentimiento }),
      });
      const cuerpo = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) throw new Error(cuerpo.error || 'No se pudo iniciar la verificación por WhatsApp.');
      setVerificacion({ estado: 'pendiente', expira_en: cuerpo.expira_en, canal: 'whatsapp' });
      setEnlaceVerificacion(cuerpo.enlace_verificacion || '');
      setEstado(cuerpo.instrucciones || 'Abre WhatsApp y envía el mensaje prellenado desde el número registrado.');
    } catch (error) { setEstado(error.message); }
    finally { setProcesando(false); }
  }

  async function comprobarVerificacion() {
    setProcesando(true);
    try {
      const cuerpo = await cargar(token, plantaId);
      if (cuerpo.contacto?.verificado_en) setEnlaceVerificacion('');
      else if (cuerpo.verificacion?.estado === 'pendiente') setEstado('Aún no llega la confirmación. Envía el mensaje desde WhatsApp y vuelve a comprobar.');
      else setEstado('El desafío expiró o no está activo. Inicia una verificación nueva.');
    } catch (error) { setEstado(error.message); }
    finally { setProcesando(false); }
  }

  return <main className="auth-page"><section className="auth-card onboarding-card contact-whatsapp-card">
    <div className="auth-card__top"><p className="auth-brand">DOWNTIME<span>OS</span></p><span className="auth-status"><i /> CONTACTO DE PLANTA</span></div>
    <p className="auth-kicker">TU CUENTA / CONTACTO DE PLANTA</p><h1>Mi número de contacto</h1>
    <p className="auth-copy">Tu número pertenece a tu membresía y a esta planta. Si tienes acceso a varias plantas, registra el contacto en cada una. Operaciones recibe avisos de paros; Dirección y Finanzas reciben reportes ejecutivos.</p>
    <section className="onboarding-section">
      <h2>Contacto de WhatsApp</h2>
      <p>Guarda el número con tu consentimiento para recibir avisos de WhatsApp. Para aceptar o rechazar paros desde WhatsApp, confirma una sola vez que controlas ese número; la confirmación se hace enviando un mensaje a la planta, sin SMS.</p>
      <form className="auth-form" onSubmit={guardarContacto}>
        <label>Número internacional<input type="tel" inputMode="tel" autoComplete="tel" placeholder="+52 55 1234 5678" value={telefono} onChange={(event) => setTelefono(event.target.value)} required /></label>
        <label className="onboarding-check"><input type="checkbox" checked={consentimiento} onChange={(event) => setConsentimiento(event.target.checked)} required /> Acepto recibir en este número mensajes operativos de WhatsApp de esta planta según mi función. Puedo retirar el consentimiento o borrar el contacto cuando quiera.</label>
        <button className="btn btn--primary btn--block auth-submit" type="submit" disabled={procesando || !consentimiento}>{procesando ? 'Guardando…' : contacto?.telefono_e164 ? 'Guardar cambios' : 'Guardar número para WhatsApp'}</button>
      </form>
      <p className="contact-whatsapp-status" role="status" aria-live="polite">{estado}</p>
      {contacto?.verificado_en ? <p>Verificado el {new Date(contacto.verificado_en).toLocaleString('es-MX')} para esta planta.</p> : null}
      {contacto?.telefono_e164 && !contacto?.verificado_en ? <>
        <p>Estado: número registrado con consentimiento. Los avisos pueden llegar, pero las decisiones por WhatsApp seguirán pendientes hasta verificar la propiedad.</p>
        <button className="btn btn--secondary" type="button" onClick={iniciarVerificacion} disabled={procesando || !consentimiento || !telefono.trim()}>
          {procesando ? 'Preparando…' : verificacion?.estado === 'pendiente' ? 'Generar un nuevo desafío de WhatsApp' : 'Verificar para aceptar o rechazar paros'}
        </button>
        {enlaceVerificacion ? <p><a className="btn btn--primary" href={enlaceVerificacion} target="_blank" rel="noreferrer">Abrir WhatsApp y enviar verificación</a></p> : null}
        {verificacion?.estado === 'pendiente' ? <button className="btn btn--secondary" type="button" onClick={comprobarVerificacion} disabled={procesando}>Ya lo envié · comprobar estado</button> : null}
      </> : null}
      {contacto ? <button className="btn btn--secondary" type="button" onClick={retirarConsentimiento} disabled={procesando}>Retirar consentimiento y eliminar mi número</button> : null}
    </section>
    <p className="auth-footer"><a href={destinoRegreso}>Volver a mi tablero</a></p>
  </section></main>;
}
