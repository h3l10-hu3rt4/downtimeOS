'use client';
import { useCallback, useEffect, useState } from 'react';
import { fetchConSesion, leerSesionNavegador } from '../../lib/sesion-navegador.js';

export default function ContactoWhatsApp() {
  const [token, setToken] = useState('');
  const [plantaId, setPlantaId] = useState('');
  const [telefono, setTelefono] = useState('');
  const [contacto, setContacto] = useState(null);
  const [enlace, setEnlace] = useState('');
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
    if (cuerpo.contacto?.verificado_en) setEstado('Número verificado para esta planta.');
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

  async function iniciar(event) {
    event.preventDefault();
    setProcesando(true);
    setEnlace('');
    setEstado('Preparando la verificación…');
    try {
      const respuesta = await fetchConSesion('/api/planta/whatsapp-contacto', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-downtimeos-planta': plantaId },
        body: JSON.stringify({ telefono, consentimiento }),
      });
      const cuerpo = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) throw new Error(cuerpo.error || 'No se pudo iniciar la verificación.');
      setEnlace(cuerpo.enlace_verificacion);
      await cargar(token, plantaId);
      setEstado('Solicitud lista. Abre WhatsApp y envía el mensaje prellenado desde el número que registraste; el código vence en 10 minutos.');
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
    <p className="auth-kicker">TU CUENTA / WHATSAPP</p><h1>Mi WhatsApp</h1>
    <p className="auth-copy">Tu número pertenece a tu membresía y a esta planta. Si tienes acceso a varias plantas, verifica el contacto en cada una. Operaciones recibe avisos de paros; Dirección y Finanzas reciben reportes ejecutivos.</p>
    <section className="onboarding-section">
      <h2>Control del número</h2>
      <p>Para verificarlo sin enviar un mensaje automático ni revelar un código por otro canal, DowntimeOS abre un mensaje prellenado. Envíalo desde el mismo WhatsApp que registraste; la firma del webhook y el teléfono de origen validan que controlas el número.</p>
      <form className="auth-form" onSubmit={iniciar}>
        <label>Número internacional<input type="tel" inputMode="tel" autoComplete="tel" placeholder="+52 55 1234 5678" value={telefono} onChange={(event) => setTelefono(event.target.value)} required /></label>
        <label className="onboarding-check"><input type="checkbox" checked={consentimiento} onChange={(event) => setConsentimiento(event.target.checked)} required /> Acepto recibir en este número notificaciones de la planta según mi función; puedo retirar el consentimiento cambiando o borrando el contacto.</label>
        <button className="btn btn--primary btn--block auth-submit" type="submit" disabled={procesando || !consentimiento}>{procesando ? 'Preparando…' : contacto?.verificado_en ? 'Cambiar y verificar número' : 'Verificar mi número'}</button>
      </form>
      {enlace ? <a className="btn btn--secondary contact-whatsapp-link" href={enlace} target="_blank" rel="noreferrer">Abrir WhatsApp y enviar verificación</a> : null}
      <p className="contact-whatsapp-status" role="status" aria-live="polite">{estado}</p>
      {contacto?.verificado_en && !enlace ? <p>Verificado el {new Date(contacto.verificado_en).toLocaleString('es-MX')} para esta planta.</p> : null}
      {enlace ? <button className="btn btn--secondary" type="button" onClick={refrescar} disabled={procesando}>{procesando ? 'Revisando confirmación…' : 'Ya lo envié · actualizar estado'}</button> : null}
      {contacto ? <button className="btn btn--secondary" type="button" onClick={retirarConsentimiento} disabled={procesando}>Retirar consentimiento y eliminar mi número</button> : null}
    </section>
    <p className="auth-footer"><a href="/">Volver a DowntimeOS</a></p>
  </section></main>;
}
