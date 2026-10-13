'use client';
import { useCallback, useEffect, useState } from 'react';
import { fetchConSesion, leerSesionNavegador } from '../../lib/sesion-navegador.js';

export default function ContactoWhatsApp() {
  const [token, setToken] = useState('');
  const [plantaId, setPlantaId] = useState('');
  const [telefono, setTelefono] = useState('');
  const [contacto, setContacto] = useState(null);
  const [enlace, setEnlace] = useState('');
  const [smsEnviado, setSmsEnviado] = useState(false);
  const [codigoSMS, setCodigoSMS] = useState('');
  const [consentimiento, setConsentimiento] = useState(false);
  const [estado, setEstado] = useState('Cargando tu contacto…');
  const [procesando, setProcesando] = useState(false);

  const cargar = useCallback(async (accessToken, selectedPlantId) => {
    const respuesta = await fetchConSesion('/api/planta/whatsapp-contacto', {
      headers: { authorization: `Bearer ${accessToken}`, 'x-downtimeos-planta': selectedPlantId },
    });
    const cuerpo = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) throw Object.assign(new Error(cuerpo.error || 'No se pudo consultar el contacto.'), { status: respuesta.status });
    setContacto(cuerpo.contacto || null);
    if (cuerpo.contacto?.telefono_e164) setTelefono(cuerpo.contacto.telefono_e164);
    setSmsEnviado(cuerpo.verificacion?.estado === 'pendiente' && cuerpo.verificacion?.canal === 'sms');
    if (cuerpo.contacto?.verificado_en) setEstado('Número verificado para esta planta.');
    else if (cuerpo.verificacion?.estado === 'pendiente' && cuerpo.verificacion?.canal === 'sms') setEstado('Código SMS enviado. Escríbelo abajo para validar el número.');
    else if (cuerpo.verificacion?.estado === 'pendiente') setEstado('Desafío pendiente: Meta aún no ha confirmado el mensaje entrante.');
    else if (cuerpo.verificacion?.estado === 'expirada') setEstado('El código venció sin confirmación. Inicia una verificación nueva y envía el mensaje más reciente.');
    else setEstado('Agrega y verifica tu número para recibir avisos de tu función.');
    return cuerpo;
  }, []);

  useEffect(() => {
    const sesion = leerSesionNavegador();
    if (!sesion.access_token || !sesion.perfil?.planta_id) {
      location.replace('/acceso?returnTo=%2Fcontacto-whatsapp');
      return;
    }
    setToken(sesion.access_token);
    setPlantaId(sesion.perfil.planta_id);
    cargar(sesion.access_token, sesion.perfil.planta_id).catch((error) => setEstado(error.message));
  }, [cargar]);

  async function iniciarSms(event) {
    event.preventDefault();
    setProcesando(true);
    setEnlace('');
    setEstado('Enviando código SMS…');
    try {
      const respuesta = await fetchConSesion('/api/planta/whatsapp-contacto', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-downtimeos-planta': plantaId },
        body: JSON.stringify({ accion: 'enviar_sms', telefono, consentimiento }),
      });
      const cuerpo = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) throw new Error(cuerpo.error || 'No se pudo enviar el SMS.');
      setSmsEnviado(true);
      setCodigoSMS('');
      await cargar(token, plantaId);
      setEstado('Enviamos el código por SMS. Escríbelo aquí dentro de 10 minutos; no lo compartas.');
    } catch (error) { setEstado(error.message); }
    finally { setProcesando(false); }
  }

  async function verificarSms() {
    setProcesando(true);
    setEstado('Validando el código con Twilio…');
    try {
      const respuesta = await fetchConSesion('/api/planta/whatsapp-contacto', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-downtimeos-planta': plantaId },
        body: JSON.stringify({ accion: 'verificar_sms', codigo: codigoSMS }),
      });
      const cuerpo = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) throw new Error(cuerpo.error || 'No se pudo validar el código.');
      setCodigoSMS('');
      setSmsEnviado(false);
      setEnlace('');
      await cargar(token, plantaId);
      setEstado('¡Listo! El número quedó verificado por SMS para esta planta.');
    } catch (error) { setEstado(error.message); }
    finally { setProcesando(false); }
  }

  async function iniciarWhatsApp() {
    setProcesando(true);
    setEnlace('');
    setEstado('Preparando verificación alternativa de WhatsApp…');
    try {
      const respuesta = await fetchConSesion('/api/planta/whatsapp-contacto', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-downtimeos-planta': plantaId },
        body: JSON.stringify({ telefono, consentimiento }),
      });
      const cuerpo = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) throw new Error(cuerpo.error || 'No se pudo iniciar la verificación por WhatsApp.');
      setEnlace(cuerpo.enlace_verificacion);
      setSmsEnviado(false);
      await cargar(token, plantaId);
      setEstado('Abre WhatsApp y envía el mensaje prellenado desde el número registrado.');
    } catch (error) { setEstado(error.message); }
    finally { setProcesando(false); }
  }

  async function refrescar() {
    setProcesando(true);
    setEstado('Revisando si llegó la confirmación de WhatsApp…');
    try {
      let cuerpo;
      for (let intento = 0; intento < 4; intento += 1) {
        cuerpo = await cargar(token, plantaId);
        if (cuerpo.contacto?.verificado_en || cuerpo.verificacion?.estado !== 'pendiente') break;
        if (intento < 3) await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      if (cuerpo.contacto?.verificado_en) {
        setEnlace('');
        setEstado('¡Listo! El número quedó verificado para esta planta.');
      } else if (cuerpo.verificacion?.estado === 'pendiente') {
        const vencimiento = new Date(cuerpo.verificacion.expira_en).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
        setEstado(`Aún no llega la confirmación de Meta. Verifica que enviaste el mensaje más reciente desde el mismo número; el código vence a las ${vencimiento}.`);
      } else {
        setEnlace('');
        setEstado('No llegó la confirmación y el código ya venció. Pulsa “Verificar mi número” para generar uno nuevo y envíalo enseguida.');
      }
    }
    catch (error) { setEstado(error.message); }
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
      setContacto(null); setEnlace(''); setTelefono(''); setConsentimiento(false); setEstado(cuerpo.mensaje);
    } catch (error) { setEstado(error.message); }
    finally { setProcesando(false); }
  }

  return <main className="auth-page"><section className="auth-card onboarding-card contact-whatsapp-card">
    <div className="auth-card__top"><p className="auth-brand">DOWNTIME<span>OS</span></p><span className="auth-status"><i /> CONTACTO DE PLANTA</span></div>
    <p className="auth-kicker">TU CUENTA / CONTACTO DE PLANTA</p><h1>Mi número de contacto</h1>
    <p className="auth-copy">Tu número pertenece a tu membresía y a esta planta. Si tienes acceso a varias plantas, verifica el contacto en cada una. Operaciones recibe avisos de paros; Dirección y Finanzas reciben reportes ejecutivos.</p>
    <section className="onboarding-section">
      <h2>Verificación por SMS</h2>
      <p>Te enviaremos un código de un solo uso al número indicado. DowntimeOS no guarda ese código; Twilio valida que tienes acceso al teléfono. El SMS se usa únicamente para verificar el contacto.</p>
      <form className="auth-form" onSubmit={iniciarSms}>
        <label>Número internacional<input type="tel" inputMode="tel" autoComplete="tel" placeholder="+52 55 1234 5678" value={telefono} onChange={(event) => setTelefono(event.target.value)} required /></label>
        <label className="onboarding-check"><input type="checkbox" checked={consentimiento} onChange={(event) => setConsentimiento(event.target.checked)} required /> Acepto recibir en este número el SMS de verificación y las notificaciones operativas de la planta según mi función. Puedo retirar el consentimiento cambiando o borrando el contacto.</label>
        <button className="btn btn--primary btn--block auth-submit" type="submit" disabled={procesando || !consentimiento}>{procesando ? 'Enviando SMS…' : contacto?.verificado_en ? 'Cambiar y verificar número' : 'Enviar código por SMS'}</button>
      </form>
      {smsEnviado ? <div className="auth-form contact-sms-code">
        <label>Código de verificación<input type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{4,10}" maxLength={10} placeholder="Código recibido por SMS" value={codigoSMS} onChange={(event) => setCodigoSMS(event.target.value.replace(/\D/g, '').slice(0, 10))} /></label>
        <button className="btn btn--secondary" type="button" onClick={verificarSms} disabled={procesando || codigoSMS.length < 4}>{procesando ? 'Validando…' : 'Confirmar código SMS'}</button>
      </div> : null}
      <button className="btn btn--secondary" type="button" onClick={iniciarWhatsApp} disabled={procesando || !consentimiento}>Usar verificación alternativa por WhatsApp</button>
      {enlace ? <a className="btn btn--secondary contact-whatsapp-link" href={enlace} target="_blank" rel="noreferrer">Abrir WhatsApp y enviar verificación</a> : null}
      <p className="contact-whatsapp-status" role="status" aria-live="polite">{estado}</p>
      {contacto?.verificado_en && !enlace ? <p>Verificado el {new Date(contacto.verificado_en).toLocaleString('es-MX')} para esta planta.</p> : null}
      {enlace ? <button className="btn btn--secondary" type="button" onClick={refrescar} disabled={procesando}>{procesando ? 'Revisando confirmación…' : 'Ya lo envié · actualizar estado'}</button> : null}
      {contacto ? <button className="btn btn--secondary" type="button" onClick={retirarConsentimiento} disabled={procesando}>Retirar consentimiento y eliminar mi número</button> : null}
    </section>
    <p className="auth-footer"><a href="/">Volver a DowntimeOS</a></p>
  </section></main>;
}
