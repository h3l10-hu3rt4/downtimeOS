'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { crearControlCarga } from '../../../lib/control-carga.js';

const dinero = (importe, moneda) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: moneda || 'USD', maximumFractionDigits: 2 }).format(Number(importe || 0));

export default function PanelSuscripciones() {
  const [solicitudes, setSolicitudes] = useState([]);
  const [total, setTotal] = useState(0);
  const [hayMas, setHayMas] = useState(false);
  const [estado, setEstado] = useState('Cargando solicitudes…');
  const [ocupada, setOcupada] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [correoTitular, setCorreoTitular] = useState('');
  const [planPiloto, setPlanPiloto] = useState('starter');
  const [confirmacion, setConfirmacion] = useState(null);
  const controlCarga = useRef(null);
  if (!controlCarga.current) controlCarga.current = crearControlCarga();
  const cargar = useCallback(({ offset = 0, anexar = false, forzar = false } = {}) => {
    const carga = controlCarga.current.ejecutar(async ({ esVigente }) => {
      setCargando(true);
      setEstado('Cargando solicitudes…');
      try {
      const respuesta = await fetch(`/api/administracion/suscripciones?offset=${offset}`);
      const cuerpo = await respuesta.json();
      if (!respuesta.ok) throw new Error(cuerpo.error || 'No pudimos cargar la información.');
      if (!Array.isArray(cuerpo.suscripciones) || !Number.isSafeInteger(cuerpo.total) || typeof cuerpo.hay_mas !== 'boolean') throw new Error('Recibimos una página incompleta de solicitudes.');
      if (!esVigente()) return;
      setSolicitudes((actuales) => anexar ? [...actuales, ...cuerpo.suscripciones] : cuerpo.suscripciones);
      setTotal(cuerpo.total); setHayMas(cuerpo.hay_mas); setEstado('');
      } catch (error) {
        if (esVigente()) setEstado(error.message || 'No pudimos cargar las solicitudes. Comprueba tu conexión e inténtalo de nuevo.');
        throw error;
      } finally {
        if (esVigente()) setCargando(false);
      }
    }, { forzar });
    return carga.promesa;
  }, []);
  useEffect(() => { cargar().catch(() => {}); }, [cargar]);
  useEffect(() => {
    if (!confirmacion) return undefined;
    const cerrarConEscape = (evento) => {
      if (evento.key === 'Escape' && !ocupada) setConfirmacion(null);
    };
    window.addEventListener('keydown', cerrarConEscape);
    return () => window.removeEventListener('keydown', cerrarConEscape);
  }, [confirmacion, ocupada]);

  async function resolver(id, accion) {
    if (ocupada) return;
    const configuracion = accion === 'activar'
      ? { titulo: 'Confirmar activación', mensaje: 'Verifica la orden de compra o el depósito y revisa el comprobante antes de activar el plan.', boton: 'Confirmar activación' }
      : accion === 'piloto'
        ? { titulo: 'Activar piloto', mensaje: 'Se habilitará un piloto de 14 días para esta empresa.', boton: 'Activar piloto' }
        : accion === 'rechazar_comprobante'
          ? { titulo: 'Rechazar comprobante', mensaje: 'Se rechazará solo este comprobante. El pago seguirá pendiente y la empresa podrá adjuntar otro.', boton: 'Rechazar comprobante', peligro: true }
          : { titulo: 'Rechazar solicitud', mensaje: 'La solicitud de suscripción será rechazada.', boton: 'Rechazar solicitud', peligro: true };
    setConfirmacion({ ...configuracion, ejecutar: () => resolverConfirmado(id, accion) });
  }

  async function resolverConfirmado(id, accion) {
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
        await cargar({ forzar: true });
        setEstado(confirmacion);
      } catch {
        setEstado(`${confirmacion} No pudimos actualizar la lista; recarga antes de volver a actuar sobre esta solicitud.`);
      }
    } catch {
      // La respuesta pudo perderse después de que el servidor guardara el
      // cambio. Recargar antes de permitir otra decisión evita duplicarla.
      setEstado('No pudimos confirmar la respuesta. Consultando el estado actualizado…');
      try {
        await cargar({ forzar: true });
        setEstado('Estado actualizado desde el servidor. Verifica la solicitud antes de intentar otra acción.');
      } catch {
        setEstado('No pudimos confirmar ni actualizar el estado. Recarga esta página antes de volver a procesar la solicitud.');
      }
    } finally {
      setOcupada(false);
    }
  }

  async function activarPilotoPorCorreo(evento) {
    evento.preventDefault();
    if (ocupada) return;
    setConfirmacion({
      titulo: `Activar piloto ${planPiloto.toUpperCase()}`,
      mensaje: `Se activará ${planPiloto.toUpperCase()} durante 14 días para la empresa cuyo titular fundador es ${correoTitular.trim()}. No se registrará ningún pago ni cargo.`,
      boton: 'Activar piloto por 14 días',
      ejecutar: activarPilotoConfirmado,
    });
  }

  async function activarPilotoConfirmado() {
    setOcupada(true);
    setEstado('Validando al titular y activando el piloto…');
    try {
      const respuesta = await fetch('/api/administracion/suscripciones', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accion: 'piloto_por_correo', correo: correoTitular, plan_codigo: planPiloto }),
      });
      const cuerpo = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) {
        setEstado(cuerpo.error || 'No se pudo activar el piloto.');
        return;
      }
      setCorreoTitular('');
      const fin = cuerpo.resultado?.termina_en
        ? new Intl.DateTimeFormat('es-MX', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Mexico_City' }).format(new Date(cuerpo.resultado.termina_en))
        : '';
      const mensajeExito = `${cuerpo.mensaje}${fin ? ` Vigente hasta ${fin}.` : ''}`;
      await cargar({ forzar: true }).catch(() => {});
      setEstado(mensajeExito);
    } catch {
      setEstado('No pudimos confirmar la activación. Recarga la información antes de volver a intentarlo.');
    } finally {
      setOcupada(false);
    }
  }

  return <main className="auth-page"><section className="auth-card onboarding-card admin-billing-card">
    <div className="auth-card__top"><p className="auth-brand">DOWNTIME<span>OS</span></p><span className="auth-status"><i /> ADMINISTRACIÓN INTERNA</span></div>
    <p className="auth-kicker">PLATAFORMA / REVISIÓN COMERCIAL</p><h1>Solicitudes de suscripción</h1>
    <p className="auth-copy">Revisa la orden de compra o confirma el depósito fuera de la plataforma antes de activar un plan. Esta pantalla nunca procesa tarjetas.</p>
    {confirmacion ? <div className="admin-confirm-overlay" onMouseDown={(evento) => { if (evento.target === evento.currentTarget && !ocupada) setConfirmacion(null); }}>
      <section className="admin-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="adminConfirmTitle" aria-describedby="adminConfirmMessage">
        <div className="admin-confirm-mark" aria-hidden="true">{confirmacion.peligro ? '!' : '✓'}</div>
        <p className="auth-kicker">DOWNTIMEOS / CONFIRMACIÓN</p>
        <h2 id="adminConfirmTitle">{confirmacion.titulo}</h2>
        <p id="adminConfirmMessage">{confirmacion.mensaje}</p>
        <div className="team-actions admin-confirm-actions">
          <button className="btn btn--secondary" type="button" autoFocus disabled={ocupada} onClick={() => setConfirmacion(null)}>Cancelar</button>
          <button className={`btn ${confirmacion.peligro ? 'btn--danger' : 'btn--primary'}`} type="button" disabled={ocupada} onClick={async () => { const ejecutar = confirmacion.ejecutar; setConfirmacion(null); await ejecutar(); }}>{confirmacion.boton}</button>
        </div>
      </section>
    </div> : null}
    <section className="admin-billing-item admin-pilot-by-email" aria-labelledby="pilotoCorreoTitulo">
      <h2 id="pilotoCorreoTitulo">Activar piloto para una cuenta</h2>
      <p>Escribe el correo del administrador fundador y elige el plan que quieres probar durante 14 días. Se aplican los límites del plan y no se registra ningún pago ni cargo; escribir el correo no concede acceso.</p>
      <form className="team-form" onSubmit={activarPilotoPorCorreo}>
        <label className="field"><span>CORREO DEL TITULAR FUNDADOR</span><input type="email" autoComplete="email" required maxLength={254} value={correoTitular} onChange={(evento) => setCorreoTitular(evento.target.value)} placeholder="titular@empresa.com" /></label>
        <label className="field"><span>PLAN DE PRUEBA</span><select value={planPiloto} onChange={(evento) => setPlanPiloto(evento.target.value)}><option value="starter">Starter · hasta 5 activos</option><option value="pro">Pro · hasta 20 activos</option><option value="enterprise">Enterprise · multiplanta</option></select></label>
        <button className="btn btn--primary" type="submit" disabled={ocupada || cargando}>{ocupada ? 'Activando piloto…' : 'Activar piloto de 14 días'}</button>
      </form>
      <small>Se registra una auditoría y el piloto se aplica a toda la organización. Se respetan los límites de activos y plantas; Enterprise requiere al menos tres plantas activas. En el entorno local, los correos se consultan en Mailpit; este control no envía una invitación.</small>
    </section>
    {estado && !cargando && !ocupada && solicitudes.length === 0 ? <div className="admin-billing-load-error" role="alert"><p>{estado}</p><button className="btn btn--secondary" type="button" disabled={cargando} onClick={() => cargar().catch(() => {})}>{cargando ? 'Cargando…' : 'Reintentar carga de solicitudes'}</button></div> : <p aria-live="polite" aria-atomic="true" className="auth-state">{estado}</p>}
    {cargando ? <p role="status" aria-live="polite">Cargando solicitudes…</p> : null}
    <div className="admin-billing-list">{solicitudes.map((s) => {
      const pago = s.organizacion_pagos?.[0];
      const pendiente = ['solicitada', 'pendiente_pago'].includes(s.estado);
      const periodoOfrecido = ['semestral', 'anual'].includes(s.periodicidad);
      const renovacion = Boolean(s.periodo_programado);
      const mejora = Boolean(s.mejora_de_suscripcion_id);
      return <article className="admin-billing-item" key={s.id}><div className="admin-billing-heading"><div><strong>{s.organizaciones?.nombre || 'Empresa'}</strong><span>{s.plan_codigo.toUpperCase()} · {s.estado === 'piloto' ? 'piloto de 14 días' : `${s.periodicidad || 'periodo no definido'} · ${s.plantas_incluidas} planta(s)`}</span></div><small>{renovacion ? (pendiente ? 'renovación · pago pendiente' : 'renovación programada') : mejora && pendiente ? 'mejora inmediata · pago pendiente' : s.estado.replaceAll('_', ' ')}</small></div>
        {!periodoOfrecido && s.estado !== 'piloto' ? <p role="alert">Periodo histórico no ofrecido. No puede activarse; rechaza esta solicitud y pide una nueva semestral o anual.</p> : null}
        {renovacion ? <p>{s.inicio_programado_en ? `Inicio estimado: ${new Intl.DateTimeFormat('es-MX', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Mexico_City' }).format(new Date(s.inicio_programado_en))}. Se confirmará al validar el pago. ` : ''}El periodo iniciará al terminar el vigente.</p> : null}
        {renovacion && pendiente ? <p>Esta renovación no se rechaza como una solicitud nueva. Si el cliente ya no desea continuar, debe cancelarla desde su cuenta; un comprobante enviado sí puede rechazarse por separado.</p> : null}
        {mejora && pendiente ? <p>Mejora de plan: al confirmar el pago, este plan reemplaza de inmediato al plan vigente de la empresa. Se cobra el periodo completo, sin prorrateo.</p> : null}
        <p>Orden de compra: {s.orden_compra || 'No proporcionada'}</p>
        {pago ? <p>Pago: {dinero(pago.importe, pago.moneda)} · {pago.estado.replaceAll('_', ' ')} · Referencia {pago.referencia || '—'}</p> : <p>Sin registro de pago.</p>}
        {pago?.comprobante ? <p>Comprobante {pago.comprobante.estado.replaceAll('_', ' ')} · {pago.comprobante.tipo?.split('/')[1]?.toUpperCase()} · {Math.ceil(Number(pago.comprobante.bytes || 0) / 1024)} KB · recibido {pago.comprobante.recibido_en ? new Date(pago.comprobante.recibido_en).toLocaleString('es-MX') : '—'} · <a href={pago.comprobante.url} target="_blank" rel="noopener noreferrer">Abrir enlace seguro temporal</a></p> : null}
        <small>Solicitada {new Date(s.creada_en).toLocaleString('es-MX')}</small>
        {pendiente ? <div className="team-actions">{periodoOfrecido ? <><button className="btn btn--primary" disabled={ocupada} onClick={() => resolver(s.id, 'activar')}>{renovacion ? 'Confirmar pago y programar renovación' : mejora ? 'Confirmar pago y reemplazar el plan vigente' : 'Confirmar pago externo y activar'}</button>{pago?.estado === 'comprobante_recibido' ? <button className="btn btn--secondary" disabled={ocupada} onClick={() => resolver(s.id, 'rechazar_comprobante')}>Rechazar comprobante</button> : null}{!renovacion && !mejora ? <button className="btn btn--secondary" disabled={ocupada} onClick={() => resolver(s.id, 'piloto')}>Activar piloto 14 días</button> : null}</> : null}{!renovacion ? <button className="btn btn--secondary" disabled={ocupada} onClick={() => resolver(s.id, 'rechazar')}>Rechazar solicitud</button> : null}</div> : null}
      </article>;
    })}{!solicitudes.length && !estado ? <p>No hay solicitudes todavía.</p> : null}</div>
    {hayMas ? <button className="btn btn--secondary" type="button" disabled={cargando || ocupada} onClick={() => cargar({ offset: solicitudes.length, anexar: true }).catch(() => {})}>{cargando ? 'Cargando solicitudes…' : `Cargar más solicitudes (${solicitudes.length} de ${total})`}</button> : null}
    <p className="onboarding-footnote">Toda activación queda registrada. El usuario y los datos de tarjeta nunca se guardan en esta pantalla.</p>
  </section></main>;
}
