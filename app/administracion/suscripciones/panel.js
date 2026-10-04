'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

const dinero = (importe, moneda) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: moneda || 'USD', maximumFractionDigits: 2 }).format(Number(importe || 0));

export default function PanelSuscripciones() {
  const [solicitudes, setSolicitudes] = useState([]);
  const [total, setTotal] = useState(0);
  const [hayMas, setHayMas] = useState(false);
  const [estado, setEstado] = useState('Cargando solicitudes…');
  const [ocupada, setOcupada] = useState(false);
  const [cargando, setCargando] = useState(true);
  const cargaEnCurso = useRef(null);
  const cargar = useCallback(({ offset = 0, anexar = false } = {}) => {
    if (cargaEnCurso.current) return cargaEnCurso.current;
    setCargando(true);
    setEstado('Cargando solicitudes…');
    const peticion = (async () => {
      try {
      const respuesta = await fetch(`/api/administracion/suscripciones?offset=${offset}`);
      const cuerpo = await respuesta.json();
      if (!respuesta.ok) throw new Error(cuerpo.error || 'No pudimos cargar la información.');
      if (!Array.isArray(cuerpo.suscripciones) || !Number.isSafeInteger(cuerpo.total) || typeof cuerpo.hay_mas !== 'boolean') throw new Error('Recibimos una página incompleta de solicitudes.');
      setSolicitudes((actuales) => anexar ? [...actuales, ...cuerpo.suscripciones] : cuerpo.suscripciones);
      setTotal(cuerpo.total); setHayMas(cuerpo.hay_mas); setEstado('');
      } catch (error) {
        setEstado(error.message || 'No pudimos cargar las solicitudes. Comprueba tu conexión e inténtalo de nuevo.');
        throw error;
      } finally {
        cargaEnCurso.current = null;
        setCargando(false);
      }
    })();
    cargaEnCurso.current = peticion;
    return peticion;
  }, []);
  useEffect(() => { cargar().catch(() => {}); }, [cargar]);

  async function resolver(id, accion) {
    const advertencia = accion === 'activar' ? 'Confirma solo después de verificar la orden de compra o el depósito en los registros financieros y revisar el comprobante si existe.' : accion === 'piloto' ? 'Activar un piloto de 14 días para esta empresa?' : accion === 'rechazar_comprobante' ? '¿Rechazar solo este comprobante? El pago seguirá pendiente y la empresa podrá adjuntar otro.' : '¿Rechazar esta solicitud?';
    if (ocupada || !window.confirm(advertencia)) return;
    setOcupada(true);
    setEstado('Actualizando solicitud…');
    try {
      const respuesta = await fetch('/api/administracion/suscripciones', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, accion }) });
      const cuerpo = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) {
        setEstado(cuerpo.error || 'No se pudo actualizar la solicitud.');
        return;
      }
      const confirmacion = cuerpo.mensaje || 'Solicitud actualizada.';
      try {
        await cargar();
        setEstado(confirmacion);
      } catch {
        setEstado(`${confirmacion} No pudimos actualizar la lista; recarga antes de volver a actuar sobre esta solicitud.`);
      }
    } catch {
      // La respuesta pudo perderse después de que el servidor guardara el
      // cambio. Recargar antes de permitir otra decisión evita duplicarla.
      setEstado('No pudimos confirmar la respuesta. Consultando el estado actualizado…');
      try {
        await cargar();
        setEstado('Estado actualizado desde el servidor. Verifica la solicitud antes de intentar otra acción.');
      } catch {
        setEstado('No pudimos confirmar ni actualizar el estado. Recarga esta página antes de volver a procesar la solicitud.');
      }
    } finally {
      setOcupada(false);
    }
  }

  return <main className="auth-page"><section className="auth-card onboarding-card admin-billing-card">
    <div className="auth-card__top"><p className="auth-brand">DOWNTIME<span>OS</span></p><span className="auth-status"><i /> ADMINISTRACIÓN INTERNA</span></div>
    <p className="auth-kicker">PLATAFORMA / REVISIÓN COMERCIAL</p><h1>Solicitudes de suscripción</h1>
    <p className="auth-copy">Revisa la orden de compra o confirma el depósito fuera de la plataforma antes de activar un plan. Esta pantalla nunca procesa tarjetas.</p>
    {estado && !cargando && !ocupada && solicitudes.length === 0 ? <div className="admin-billing-load-error" role="alert"><p>{estado}</p><button className="btn btn--secondary" type="button" disabled={cargando} onClick={() => cargar().catch(() => {})}>{cargando ? 'Cargando…' : 'Reintentar carga de solicitudes'}</button></div> : <p aria-live="polite" aria-atomic="true" className="auth-state">{estado}</p>}
    {cargando ? <p role="status" aria-live="polite">Cargando solicitudes…</p> : null}
    <div className="admin-billing-list">{solicitudes.map((s) => {
      const pago = s.organizacion_pagos?.[0];
      const pendiente = ['solicitada', 'pendiente_pago'].includes(s.estado);
      const periodoOfrecido = ['semestral', 'anual'].includes(s.periodicidad);
      const renovacion = Boolean(s.periodo_programado);
      return <article className="admin-billing-item" key={s.id}><div className="admin-billing-heading"><div><strong>{s.organizaciones?.nombre || 'Empresa'}</strong><span>{s.plan_codigo.toUpperCase()} · {s.periodicidad} · {s.plantas_incluidas} planta(s)</span></div><small>{renovacion ? (pendiente ? 'renovación · pago pendiente' : 'renovación programada') : s.estado.replaceAll('_', ' ')}</small></div>
        {!periodoOfrecido ? <p role="alert">Periodo histórico no ofrecido. No puede activarse; rechaza esta solicitud y pide una nueva semestral o anual.</p> : null}
        {renovacion ? <p>{s.inicio_programado_en ? `Inicio estimado: ${new Intl.DateTimeFormat('es-MX', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Mexico_City' }).format(new Date(s.inicio_programado_en))}. Se confirmará al validar el pago. ` : ''}El periodo iniciará al terminar el vigente.</p> : null}
        {renovacion && pendiente ? <p>Esta renovación no se rechaza como una solicitud nueva. Si el cliente ya no desea continuar, debe cancelarla desde su cuenta; un comprobante enviado sí puede rechazarse por separado.</p> : null}
        <p>Orden de compra: {s.orden_compra || 'No proporcionada'}</p>
        {pago ? <p>Pago: {dinero(pago.importe, pago.moneda)} · {pago.estado.replaceAll('_', ' ')} · Referencia {pago.referencia || '—'}</p> : <p>Sin registro de pago.</p>}
        {pago?.comprobante ? <p>Comprobante {pago.comprobante.estado.replaceAll('_', ' ')} · {pago.comprobante.tipo?.split('/')[1]?.toUpperCase()} · {Math.ceil(Number(pago.comprobante.bytes || 0) / 1024)} KB · recibido {pago.comprobante.recibido_en ? new Date(pago.comprobante.recibido_en).toLocaleString('es-MX') : '—'} · <a href={pago.comprobante.url} target="_blank" rel="noopener noreferrer">Abrir enlace seguro temporal</a></p> : null}
        <small>Solicitada {new Date(s.creada_en).toLocaleString('es-MX')}</small>
        {pendiente ? <div className="team-actions">{periodoOfrecido ? <><button className="btn btn--primary" disabled={ocupada} onClick={() => resolver(s.id, 'activar')}>{renovacion ? 'Confirmar pago y programar renovación' : 'Confirmar pago externo y activar'}</button>{pago?.estado === 'comprobante_recibido' ? <button className="btn btn--secondary" disabled={ocupada} onClick={() => resolver(s.id, 'rechazar_comprobante')}>Rechazar comprobante</button> : null}{!renovacion ? <button className="btn btn--secondary" disabled={ocupada} onClick={() => resolver(s.id, 'piloto')}>Activar piloto 14 días</button> : null}</> : null}{!renovacion ? <button className="btn btn--secondary" disabled={ocupada} onClick={() => resolver(s.id, 'rechazar')}>Rechazar solicitud</button> : null}</div> : null}
      </article>;
    })}{!solicitudes.length && !estado ? <p>No hay solicitudes todavía.</p> : null}</div>
    {hayMas ? <button className="btn btn--secondary" type="button" disabled={cargando || ocupada} onClick={() => cargar({ offset: solicitudes.length, anexar: true }).catch(() => {})}>{cargando ? 'Cargando solicitudes…' : `Cargar más solicitudes (${solicitudes.length} de ${total})`}</button> : null}
    <p className="onboarding-footnote">Toda activación queda registrada. El usuario y los datos de tarjeta nunca se guardan en esta pantalla.</p>
  </section></main>;
}
