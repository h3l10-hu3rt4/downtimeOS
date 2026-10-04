'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchConSesion, leerSesionNavegador } from '../../lib/sesion-navegador.js';
import { createClient } from '@supabase/supabase-js';
import { etiquetaEstadoSuscripcion, fechaFinSuscripcion } from '../../lib/etiquetas-suscripcion.js';
import { destinoTablero } from '../acceso/return-to.js';

const precio = (valor) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(valor || 0));

export default function Suscripcion() {
  const [token, setToken] = useState('');
  const [plantaId, setPlantaId] = useState('');
  const [destinoRetorno, setDestinoRetorno] = useState('/acceso');
  const [datos, setDatos] = useState({ planes: [], suscripciones: [], pagos: [], plantas_activas: 0, facturacion: null, puede_editar: false, total_suscripciones: 0, siguiente_offset_suscripciones: 0, hay_mas_suscripciones: false });
  const [estado, setEstado] = useState('Cargando…');
  const [estadoCarga, setEstadoCarga] = useState('cargando');
  const [plan, setPlan] = useState('pro');
  const [periodicidad, setPeriodicidad] = useState('anual');
  const [cantidadPlantas, setCantidadPlantas] = useState(3);
  const inicializoFormulario = useRef(false);
  const [orden, setOrden] = useState('');
  const [subiendoPago, setSubiendoPago] = useState('');
  const [solicitando, setSolicitando] = useState(false);
  const [guardandoFiscal, setGuardandoFiscal] = useState(false);
  const [cancelando, setCancelando] = useState('');
  const [cargandoHistorial, setCargandoHistorial] = useState(false);
  const solicitudHistorialEnCurso = useRef(false);
  const mutacionEnCurso = useRef(false);

  const cargar = useCallback(async (accessToken, selectedPlantId) => {
    setEstadoCarga('cargando');
    setEstado('');
    try {
      const respuesta = await fetchConSesion('/api/planta/suscripcion', { headers: { authorization: `Bearer ${accessToken}`, 'x-downtimeos-planta': selectedPlantId } });
      const cuerpo = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) throw Object.assign(new Error(cuerpo.error || 'No se pudo cargar la suscripción.'), { status: respuesta.status });
      if (cuerpo.ok !== true || !Array.isArray(cuerpo.planes) || !Array.isArray(cuerpo.suscripciones)
        || !Array.isArray(cuerpo.pagos) || typeof cuerpo.puede_editar !== 'boolean'
        || !Number.isFinite(Number(cuerpo.plantas_activas)) || !Number.isSafeInteger(cuerpo.total_suscripciones)
        || !Number.isSafeInteger(cuerpo.siguiente_offset_suscripciones)
        || typeof cuerpo.hay_mas_suscripciones !== 'boolean') {
        throw new Error('Recibimos información incompleta de tu cuenta. Inténtalo de nuevo.');
      }
      setDatos(cuerpo);
      if (!inicializoFormulario.current) {
        const ahora = Date.now();
        const suscripcionActual = (cuerpo.suscripciones || []).find((s) => ['activa', 'piloto', 'cancelacion_programada'].includes(s.estado)
          && (!s.inicia_en || Date.parse(s.inicia_en) <= ahora) && (!s.termina_en || Date.parse(s.termina_en) > ahora));
        const referencia = suscripcionActual || cuerpo.suscripciones?.[0];
        if (referencia?.plan_codigo) setPlan(referencia.plan_codigo);
        if (['semestral', 'anual'].includes(referencia?.periodicidad)) setPeriodicidad(referencia.periodicidad);
        setCantidadPlantas(Math.max(3, Number(cuerpo.plantas_activas) || 1, Number(referencia?.plantas_incluidas) || 1));
        inicializoFormulario.current = true;
      }
      setEstadoCarga('listo');
    } catch (error) {
      if (error.status === 401) {
        location.replace('/acceso?returnTo=%2Fsuscripcion');
      } else {
        setEstadoCarga(error.status === 403 ? 'denegado' : 'error');
        setEstado(error.message || 'No pudimos consultar tu suscripción.');
      }
      throw error;
    }
  }, []);

  async function cargarMasHistorial() {
    if (solicitudHistorialEnCurso.current || !datos.hay_mas_suscripciones) return;
    solicitudHistorialEnCurso.current = true;
    setCargandoHistorial(true);
    try {
      const offset = datos.siguiente_offset_suscripciones;
      const respuesta = await fetchConSesion(`/api/planta/suscripcion?offset=${offset}`, {
        headers: { authorization: `Bearer ${token}`, 'x-downtimeos-planta': plantaId },
      });
      const cuerpo = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) throw Object.assign(new Error(cuerpo.error || 'No pudimos cargar más historial.'), { status: respuesta.status });
      if (cuerpo.ok !== true || !Array.isArray(cuerpo.suscripciones) || !Array.isArray(cuerpo.pagos)
        || !Number.isSafeInteger(cuerpo.total_suscripciones) || typeof cuerpo.hay_mas_suscripciones !== 'boolean'
        || !Number.isSafeInteger(cuerpo.siguiente_offset_suscripciones) || cuerpo.offset_suscripciones !== offset) {
        throw new Error('Recibimos información incompleta del historial. Inténtalo de nuevo.');
      }
      setDatos((actuales) => {
        const idsSuscripciones = new Set(actuales.suscripciones.map((item) => item.id));
        const idsPagos = new Set(actuales.pagos.map((item) => item.id));
        return {
          ...actuales,
          suscripciones: [...actuales.suscripciones, ...cuerpo.suscripciones.filter((item) => !idsSuscripciones.has(item.id))],
          pagos: [...actuales.pagos, ...cuerpo.pagos.filter((item) => !idsPagos.has(item.id))],
          total_suscripciones: cuerpo.total_suscripciones,
          siguiente_offset_suscripciones: cuerpo.siguiente_offset_suscripciones,
          hay_mas_suscripciones: cuerpo.hay_mas_suscripciones,
        };
      });
    } catch (error) {
      if (error.status === 401) location.replace('/acceso?returnTo=%2Fsuscripcion');
      else setEstado(error.message || 'No pudimos cargar más historial. Inténtalo de nuevo.');
    } finally {
      solicitudHistorialEnCurso.current = false;
      setCargandoHistorial(false);
    }
  }

  useEffect(() => {
    const cuenta = leerSesionNavegador();
    if (!cuenta.access_token) { location.assign('/acceso?returnTo=%2Fsuscripcion'); return; }
    setToken(cuenta.access_token);
    setPlantaId(cuenta.perfil?.planta_id || '');
    setDestinoRetorno(destinoTablero(cuenta.perfil) || '/acceso');
    cargar(cuenta.access_token, cuenta.perfil?.planta_id).catch(() => {});
  }, [cargar]);

  async function solicitar(evento) {
    evento.preventDefault();
    if (mutacionEnCurso.current) return;
    mutacionEnCurso.current = true;
    setSolicitando(true);
    setEstado('Enviando solicitud…');
    const renovar = Boolean(suscripcionVigente);
    try {
      const respuesta = await fetchConSesion('/api/planta/suscripcion', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-downtimeos-planta': plantaId }, body: JSON.stringify({ accion: renovar ? 'renovar' : 'solicitar', suscripcion_actual_id: renovar ? suscripcionVigente.id : undefined, plan, periodicidad, plantas: cantidadPlantas, orden_compra: orden }) });
      const cuerpo = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) return setEstado(cuerpo.error || 'No pudimos registrar la solicitud. Inténtalo de nuevo.');
      setEstado(cuerpo.mensaje || 'Solicitud registrada.');
      try { await cargar(token, plantaId); }
      catch { setEstado('La solicitud se registró, pero no pudimos actualizar la pantalla. Recarga para consultar el estado antes de enviar otra.'); }
    } catch {
      setEstado('No pudimos confirmar la solicitud por un problema de conexión. Recarga esta pantalla antes de volver a enviarla.');
    } finally {
      mutacionEnCurso.current = false;
      setSolicitando(false);
    }
  }

  async function cancelar(id, esProximoPeriodo = false, esPeriodoNoOfrecido = false) {
    const solicitudPendiente = datos.suscripciones.find((s) => s.id === id && ['solicitada', 'pendiente_pago'].includes(s.estado));
    const confirmacion = esPeriodoNoOfrecido
      ? 'Esta solicitud usa un periodo mensual que ya no ofrecemos. Al cancelarla dejará de bloquear una solicitud semestral o anual. Si ya enviaste una transferencia, esto no procesa una devolución; contacta a DowntimeOS.'
      : esProximoPeriodo
      ? '¿Cancelar el próximo periodo contratado? No interrumpirá el periodo vigente. Si ya fue pagado, la devolución requiere gestión manual con DowntimeOS.'
      : solicitudPendiente
      ? '¿Cancelar esta solicitud pendiente? Se cancelarán la solicitud y cualquier pago todavía pendiente. Si ya enviaste una transferencia, la cancelación no procesa una devolución; contacta a DowntimeOS.'
      : '¿Quieres solicitar la cancelación de este plan? Si tienes un próximo periodo confirmado, no se cancelará automáticamente; puedes cancelarlo por separado.';
    if (mutacionEnCurso.current) return;
    mutacionEnCurso.current = true;
    if (!window.confirm(confirmacion)) {
      mutacionEnCurso.current = false;
      return;
    }
    setCancelando(id);
    try {
      const respuesta = await fetchConSesion('/api/planta/suscripcion', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-downtimeos-planta': plantaId }, body: JSON.stringify({ accion: 'cancelar', id }) });
      const cuerpo = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) return setEstado(cuerpo.error || 'No pudimos registrar la cancelación. Inténtalo de nuevo.');
      setEstado(cuerpo.mensaje || 'Cancelación registrada.');
      try { await cargar(token, plantaId); }
      catch { setEstado('La cancelación se registró, pero no pudimos actualizar la pantalla. Recarga para consultar el estado.'); }
    } catch {
      setEstado('No pudimos confirmar la cancelación por un problema de conexión. Recarga esta pantalla antes de volver a intentarlo.');
    } finally {
      mutacionEnCurso.current = false;
      setCancelando('');
    }
  }

  async function guardarFiscal(evento) {
    evento.preventDefault();
    if (mutacionEnCurso.current) return;
    mutacionEnCurso.current = true;
    setGuardandoFiscal(true);
    setEstado('Guardando datos fiscales…');
    const form = Object.fromEntries(new FormData(evento.currentTarget));
    try {
      const respuesta = await fetchConSesion('/api/planta/suscripcion', { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-downtimeos-planta': plantaId }, body: JSON.stringify({ accion: 'facturacion', ...form }) });
      const cuerpo = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) return setEstado(cuerpo.error || 'No pudimos guardar los datos. Inténtalo de nuevo.');
      setEstado(cuerpo.mensaje || 'Datos guardados.');
      try { await cargar(token, plantaId); }
      catch { setEstado('Los datos se guardaron, pero no pudimos actualizar la pantalla. Recarga para confirmar los cambios.'); }
    } catch {
      setEstado('No pudimos confirmar el guardado por un problema de conexión. Recarga esta pantalla antes de volver a intentarlo.');
    } finally {
      mutacionEnCurso.current = false;
      setGuardandoFiscal(false);
    }
  }

  async function adjuntarComprobante(pago, archivo, input) {
    if (!archivo) return;
    if (mutacionEnCurso.current) {
      if (input) input.value = '';
      return;
    }
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(archivo.type) || archivo.size < 1 || archivo.size > 10 * 1024 * 1024) {
      setEstado('El comprobante debe ser un PDF, JPG o PNG de hasta 10 MB.');
      if (input) input.value = '';
      return;
    }
    mutacionEnCurso.current = true;
    setSubiendoPago(pago.id); setEstado('Preparando carga segura…');
    try {
      const configRespuesta = await fetch('/api/config').then((respuesta) => respuesta.json());
      if (!configRespuesta.supabase_url || !configRespuesta.supabase_publishable_key) throw new Error('No está disponible la configuración segura para cargar el archivo.');
      const intentoRespuesta = await fetchConSesion('/api/planta/suscripcion', {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-downtimeos-planta': plantaId },
        body: JSON.stringify({ accion: 'iniciar_comprobante', pago_id: pago.id, tipo: archivo.type, bytes: archivo.size }),
      });
      const intento = await intentoRespuesta.json();
      if (!intentoRespuesta.ok) throw new Error(intento.error || 'No pudimos preparar la carga.');
      const cliente = createClient(configRespuesta.supabase_url, configRespuesta.supabase_publishable_key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error: errorSubida } = await cliente.storage.from(intento.bucket)
        .uploadToSignedUrl(intento.path, intento.token, archivo, { contentType: archivo.type, upsert: false });
      if (errorSubida) throw new Error('No se pudo cargar el archivo. Inténtalo de nuevo.');
      const confirmacion = await fetchConSesion('/api/planta/suscripcion', {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-downtimeos-planta': plantaId },
        body: JSON.stringify({ accion: 'finalizar_comprobante', intento_id: intento.intento_id }),
      });
      const resultado = await confirmacion.json();
      if (!confirmacion.ok) throw new Error(resultado.error || 'No pudimos registrar el comprobante.');
      setEstado(resultado.mensaje || 'Comprobante recibido para revisión.');
      try {
        await cargar(token, plantaId);
      } catch {
        setEstado('El comprobante se recibió correctamente, pero no pudimos actualizar esta pantalla. Recarga para ver el estado; no vuelvas a subir el archivo.');
      }
    } catch (error) {
      setEstado(error.message || 'No se pudo cargar el comprobante.');
    } finally {
      mutacionEnCurso.current = false;
      setSubiendoPago('');
      if (input) input.value = '';
    }
  }

  const ahora = Date.now();
  const actual = datos.suscripciones.find((s) => ['activa', 'piloto', 'cancelacion_programada'].includes(s.estado)
    && (!s.inicia_en || Date.parse(s.inicia_en) <= ahora) && (!s.termina_en || Date.parse(s.termina_en) > ahora));
  const ultimo = actual || datos.suscripciones[0];
  const renovacionPendiente = datos.suscripciones.find((s) => s.periodo_programado && ['solicitada', 'pendiente_pago'].includes(s.estado));
  const solicitudPeriodoNoOfrecido = datos.suscripciones.find((s) => ['solicitada', 'pendiente_pago'].includes(s.estado)
    && !['semestral', 'anual'].includes(s.periodicidad));
  const solicitudInicialPendiente = datos.suscripciones.find((s) => !s.periodo_programado
    && s.id !== solicitudPeriodoNoOfrecido?.id && ['solicitada', 'pendiente_pago'].includes(s.estado));
  const renovacionProgramada = datos.suscripciones.find((s) => s.periodo_programado && s.estado === 'activa' && s.inicia_en && Date.parse(s.inicia_en) > ahora);
  const suscripcionVigente = datos.suscripciones.find((s) => ['activa', 'piloto', 'cancelacion_programada'].includes(s.estado)
    && (!s.inicia_en || Date.parse(s.inicia_en) <= ahora) && (!s.termina_en || Date.parse(s.termina_en) > ahora));
  const haySolicitudPendiente = datos.suscripciones.some((s) => ['solicitada', 'pendiente_pago'].includes(s.estado));
  const seleccion = datos.planes.find((p) => p.codigo === plan);
  return <main className="auth-page"><section className="auth-card onboarding-card billing-card">
    <div className="auth-card__top"><p className="auth-brand">DOWNTIME<span>OS</span></p><span className="auth-status"><i /> CUENTA Y FACTURACIÓN</span></div>
    <p className="auth-kicker">ADMINISTRACIÓN / SUSCRIPCIÓN</p><h1>Planes y pagos</h1><p className="auth-copy">Solicita un plan por orden de compra o transferencia. Tu plan se activa solo cuando el pago queda validado.</p>
    {estadoCarga === 'cargando' ? <section className="onboarding-section" role="status"><h2>Consultando tu cuenta</h2><p>Estamos verificando tu suscripción y facturación…</p></section> : null}
    {estadoCarga === 'denegado' ? <section className="onboarding-section" role="status"><h2>Acceso restringido</h2><p>{estado}</p><p>Si necesitas consultar planes y pagos, solicita al titular de la cuenta el permiso de facturación.</p><a href={destinoRetorno}>Volver a la planta</a></section> : null}
    {estadoCarga === 'error' ? <section className="onboarding-section" role="alert"><h2>No pudimos consultar tu cuenta</h2><p>{estado}</p><button className="btn btn--secondary" type="button" onClick={() => cargar(token, plantaId).catch(() => {})}>Reintentar</button></section> : null}
    {estadoCarga === 'listo' ? <div className="billing-panels">
    {solicitudPeriodoNoOfrecido ? <section className="onboarding-section" aria-labelledby="billing-legacy-period-title"><h2 id="billing-legacy-period-title">Solicitud anterior requiere atención</h2><p>La solicitud pendiente usa un periodo mensual que ya no ofrecemos. Cancélala para liberar la cuenta y después podrás enviar una solicitud semestral o anual. Si ya enviaste una transferencia, cancelarla aquí no procesa una devolución; contacta a DowntimeOS.</p>{datos.puede_editar ? <button type="button" className="btn btn--secondary" disabled={Boolean(cancelando) || solicitando || guardandoFiscal || Boolean(subiendoPago)} onClick={() => cancelar(solicitudPeriodoNoOfrecido.id, false, true)}>{cancelando === solicitudPeriodoNoOfrecido.id ? 'Cancelando solicitud…' : 'Cancelar solicitud mensual anterior'}</button> : <p>Solicita al titular o al responsable de facturación que la cancele.</p>}</section> : null}
    {solicitudInicialPendiente ? <section className="onboarding-section" aria-labelledby="billing-pending-request-title"><h2 id="billing-pending-request-title">Solicitud de plan pendiente</h2><p>{solicitudInicialPendiente.plan_codigo.toUpperCase()} · {solicitudInicialPendiente.periodicidad} · {solicitudInicialPendiente.estado.replaceAll('_', ' ')}. Si necesitas corregir el plan o la orden de compra, cancela esta solicitud y envía una nueva. Si ya transferiste, la cancelación no procesa una devolución; contacta a DowntimeOS.</p>{datos.puede_editar ? <button type="button" className="btn btn--secondary" disabled={Boolean(cancelando) || solicitando || guardandoFiscal || Boolean(subiendoPago)} onClick={() => cancelar(solicitudInicialPendiente.id)}>{cancelando === solicitudInicialPendiente.id ? 'Cancelando solicitud…' : 'Cancelar solicitud pendiente'}</button> : <p>Solicita al titular o al responsable de facturación que la cancele.</p>}</section> : null}
    {ultimo ? <section className="onboarding-section billing-current"><h2>{actual ? 'Estado de tu cuenta' : 'Última solicitud'}</h2><p><strong>{ultimo.plan_codigo.toUpperCase()}</strong> · {etiquetaEstadoSuscripcion(ultimo, ahora)}</p><p>Periodo: {ultimo.periodicidad || 'Por confirmar'} · Plantas: {ultimo.plantas_incluidas}</p>{fechaFinSuscripcion(ultimo, ahora) ? <p>{fechaFinSuscripcion(ultimo, ahora)}: {new Intl.DateTimeFormat('es-MX', { dateStyle: 'long', timeZone: 'America/Mexico_City' }).format(new Date(ultimo.termina_en))}</p> : null}{ultimo.orden_compra ? <p>Orden de compra: {ultimo.orden_compra}</p> : null}{actual && renovacionPendiente ? <p role="status">Renovación solicitada · Pago pendiente · El nuevo periodo se programará al validar el pago y empezará al terminar el periodo actual.</p> : null}{actual && !['cancelada', 'cancelacion_programada'].includes(actual.estado) ? <button type="button" className="btn btn--secondary" disabled={Boolean(cancelando) || solicitando || guardandoFiscal || Boolean(subiendoPago)} onClick={() => cancelar(actual.id)}>{cancelando === actual.id ? 'Cancelando…' : 'Solicitar cancelación'}</button> : null}</section> : <section className="onboarding-section"><h2>Aún no tienes una suscripción</h2><p>Consulta los planes y envía una solicitud. Si estás en un piloto acordado con DowntimeOS, el equipo asociará las condiciones a tu cuenta.</p></section>}
    {renovacionPendiente ? <section className="onboarding-section"><h2>Renovación pendiente</h2><p>{renovacionPendiente.plan_codigo.toUpperCase()} · {renovacionPendiente.periodicidad} · {renovacionPendiente.estado.replaceAll('_', ' ')}</p>{renovacionPendiente.inicio_programado_en ? <p>Inicio estimado: {new Intl.DateTimeFormat('es-MX', { dateStyle: 'long', timeZone: 'America/Mexico_City' }).format(new Date(renovacionPendiente.inicio_programado_en))}. Se confirmará al validar el pago.</p> : null}<p>El nuevo periodo se programará al terminar el periodo actual y solo después de validar manualmente el pago. No hay cobro automático.</p><button type="button" className="btn btn--secondary" disabled={Boolean(cancelando) || solicitando || guardandoFiscal || Boolean(subiendoPago)} onClick={() => cancelar(renovacionPendiente.id)}>{cancelando === renovacionPendiente.id ? 'Cancelando…' : 'Cancelar solicitud de renovación'}</button></section> : null}
    {renovacionProgramada ? <section className="onboarding-section"><h2>Próximo periodo confirmado</h2><p>{renovacionProgramada.plan_codigo.toUpperCase()} · {renovacionProgramada.periodicidad}</p><p>Comienza el {new Intl.DateTimeFormat('es-MX', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Mexico_City' }).format(new Date(renovacionProgramada.inicia_en))}. El plan actual continúa vigente hasta entonces.</p><p>Si el próximo periodo ya fue pagado, cancelarlo no genera una devolución automática; cualquier reembolso se gestiona manualmente con DowntimeOS.</p><button type="button" className="btn btn--secondary" disabled={Boolean(cancelando) || solicitando || guardandoFiscal || Boolean(subiendoPago)} onClick={() => cancelar(renovacionProgramada.id, true)}>{cancelando === renovacionProgramada.id ? 'Cancelando…' : 'Cancelar próximo periodo'}</button></section> : null}
    {datos.suscripciones.length ? <section className="onboarding-section"><h2>Historial de suscripciones</h2><div className="billing-list">{datos.suscripciones.map((s) => <article key={s.id}><strong>{s.plan_codigo.toUpperCase()} · {s.periodicidad || 'Periodo por confirmar'}</strong><span>{etiquetaEstadoSuscripcion(s, ahora)} · {s.plantas_incluidas} {Number(s.plantas_incluidas) === 1 ? 'planta' : 'plantas'}</span><small>Solicitud: {new Date(s.creada_en).toLocaleDateString('es-MX')}</small>{s.orden_compra ? <small>Orden de compra: {s.orden_compra}</small> : null}</article>)}</div><p>Mostrando {datos.suscripciones.length} de {datos.total_suscripciones} suscripciones.</p>{datos.hay_mas_suscripciones ? <button className="btn btn--secondary" type="button" onClick={cargarMasHistorial} disabled={cargandoHistorial}>{cargandoHistorial ? 'Cargando historial…' : 'Cargar 50 suscripciones anteriores'}</button> : null}</section> : null}
    {datos.puede_editar && !renovacionPendiente && !renovacionProgramada ? <form className="onboarding-section billing-request" onSubmit={solicitar}><div><h2>{suscripcionVigente ? (actual?.estado === 'piloto' ? 'Continuar con un plan pagado' : 'Renovar suscripción') : 'Solicitar un plan'}</h2><p>{suscripcionVigente ? 'Elige el plan y periodo del siguiente ciclo. No se hará ningún cargo automático; después de validar el pago, se programará al terminar el periodo actual.' : 'El precio corresponde a la tarifa publicada en USD. La activación requiere confirmación de DowntimeOS.'}</p></div>
      <label>Plan<select value={plan} onChange={(e) => { setPlan(e.target.value); if (e.target.value === 'enterprise') setCantidadPlantas((n) => Math.max(3, n)); }}>{datos.planes.map((p) => <option key={p.codigo} value={p.codigo}>{p.nombre}</option>)}</select></label>
      <label>Periodicidad<select value={periodicidad} onChange={(e) => setPeriodicidad(e.target.value)}><option value="semestral">Semestral</option><option value="anual">Anual</option></select></label>
      {plan === 'enterprise' ? <label>Plantas incluidas<input type="number" min={Math.max(3, datos.plantas_activas || 0)} max="100" value={cantidadPlantas} onChange={(e) => setCantidadPlantas(Math.max(3, datos.plantas_activas || 0, Number(e.target.value) || 3))} /><small>La cotización debe cubrir tus {datos.plantas_activas || 0} plantas activas. Podrás ampliar este número si tu contrato ya contempla más sitios.</small></label> : null}
      <label>Orden de compra (si ya está disponible)<input value={orden} onChange={(e) => setOrden(e.target.value)} placeholder="Número de OC" /></label>
      <p className="billing-price">Total de referencia: {precio((periodicidad === 'anual' ? seleccion?.precio_anual_usd : seleccion?.precio_semestral_usd) * (plan === 'enterprise' ? cantidadPlantas : 1))} USD por {periodicidad === 'anual' ? 'año' : 'semestre'}{plan === 'enterprise' ? ' · ' + cantidadPlantas + ' plantas' : ''}</p>
      <button className="btn btn--primary btn--block auth-submit" type="submit" disabled={haySolicitudPendiente || solicitando || guardandoFiscal || Boolean(cancelando) || Boolean(subiendoPago)}>{solicitando ? (suscripcionVigente ? 'Enviando renovación…' : 'Enviando solicitud…') : (suscripcionVigente ? 'Solicitar renovación' : 'Enviar solicitud')}</button>
    </form> : <section className="onboarding-section"><h2>¿Necesitas cambiar o pagar un plan?</h2><p>Solicita a tu administrador de cuenta o al responsable de facturación que te otorgue ese permiso.</p></section>}
    {datos.puede_editar ? <form className="onboarding-section billing-fiscal" onSubmit={guardarFiscal}><div><h2>Datos de facturación</h2><p>No emitimos CFDI desde esta pantalla. Estos datos solo se usan para gestionar la facturación de tu empresa.</p></div><label>Razón social<input name="razon_social" defaultValue={datos.facturacion?.razon_social || ''} /></label><label>RFC<input name="rfc" maxLength="13" defaultValue={datos.facturacion?.rfc || ''} /></label><label>Correo de cuentas por pagar<input name="correo" type="email" defaultValue={datos.facturacion?.correo || ''} /></label><label>Domicilio fiscal<textarea name="domicilio_fiscal" rows="3" defaultValue={datos.facturacion?.domicilio_fiscal || ''} /></label><label>Referencia de CxP<input name="referencia_cxp" defaultValue={datos.facturacion?.referencia_cxp || ''} /></label><button className="btn btn--secondary" type="submit" disabled={guardandoFiscal || solicitando || Boolean(cancelando) || Boolean(subiendoPago)}>{guardandoFiscal ? 'Guardando datos…' : 'Guardar datos fiscales'}</button></form> : null}
    {datos.pagos.length ? <section className="onboarding-section"><h2>Historial de pagos</h2><div className="billing-list">{datos.pagos.map((p) => <article key={p.id}><strong>{precio(p.importe)} {p.moneda}</strong><span>{p.estado.replaceAll('_', ' ')} · {p.referencia || 'Sin referencia registrada'}</span><small>{new Date(p.created_at).toLocaleDateString('es-MX')}</small>{p.comprobante ? <small>Comprobante: {{ recibido: 'recibido para revisión', verificado: 'revisado y validado', rechazado: 'rechazado; puedes adjuntar otro', anulado: 'anulado al cancelar el pago' }[p.comprobante.estado] || p.comprobante.estado} · {p.comprobante.tipo?.split('/')[1]?.toUpperCase()}</small> : null}{datos.puede_editar && p.estado === 'pendiente' && (!p.comprobante || p.comprobante.estado === 'rechazado') ? <label>Adjuntar comprobante (PDF, JPG o PNG; máximo 10 MB)<input type="file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" disabled={subiendoPago === p.id || Boolean(subiendoPago)} onChange={(e) => adjuntarComprobante(p, e.target.files?.[0], e.currentTarget)} />{subiendoPago === p.id ? <small role="status">Cargando y validando archivo…</small> : null}</label> : null}</article>)}</div></section> : null}
    </div> : null}
    <p aria-live="polite" className="auth-state">{estado}</p><p className="onboarding-footnote">Pago corporativo mediante transferencia u orden de compra. No almacenamos datos de tarjetas.</p>
    <p className="auth-footer"><a href={destinoRetorno}>Volver a la planta</a></p>
  </section></main>;
}
