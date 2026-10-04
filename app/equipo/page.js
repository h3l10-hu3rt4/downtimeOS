'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchConSesion, leerSesionNavegador } from '../../lib/sesion-navegador.js';
import { urlMailpitLocal } from '../../lib/mailpit-local.js';

export default function Equipo() {
  const [token, setToken] = useState('');
  const [plantaId, setPlantaId] = useState('');
  const [invitaciones, setInvitaciones] = useState([]);
  const [permisos, setPermisos] = useState({ es_propietario: false, es_admin_cuenta: false });
  const [puedeVerFacturacion, setPuedeVerFacturacion] = useState(false);
  const [estado, setEstado] = useState('');
  const [cargando, setCargando] = useState(true);
  const [accesoEquipo, setAccesoEquipo] = useState('cargando');
  const [buzonLocal, setBuzonLocal] = useState(false);
  const [urlBuzonLocal, setUrlBuzonLocal] = useState('');
  const [procesando, setProcesando] = useState(false);
  const [listaDesactualizada, setListaDesactualizada] = useState(false);
  const mutacionEnCurso = useRef(false);

  const cargar = useCallback(async (accessToken, selectedPlantId, { conservarAcceso = false } = {}) => {
    try {
      const respuesta = await fetchConSesion('/api/planta/equipo', { headers: { authorization: `Bearer ${accessToken}`, 'x-downtimeos-planta': selectedPlantId } });
      const cuerpo = await respuesta.json().catch(() => null);
      if (!respuesta.ok) throw Object.assign(new Error(cuerpo?.error || 'No pudimos cargar el equipo.'), { status: respuesta.status });
      if (!Array.isArray(cuerpo?.invitaciones)) throw new Error('El servidor respondió con una lista de equipo inválida. Inténtalo de nuevo.');
      setInvitaciones(cuerpo.invitaciones);
      setPermisos(cuerpo.permisos || { es_propietario: false, es_admin_cuenta: false });
      setListaDesactualizada(false);
      setAccesoEquipo('permitido');
    } catch (error) {
      if (error.status === 401 && !conservarAcceso) {
        location.replace('/acceso?returnTo=%2Fequipo');
      } else if (!conservarAcceso) {
        setAccesoEquipo(error.status === 403 ? 'denegado' : 'error');
      }
      throw error;
    }
  }, []);

  async function actualizarLista(mensajeGuardado) {
    try {
      await cargar(token, plantaId, { conservarAcceso: true });
      setEstado(mensajeGuardado);
    } catch {
      setListaDesactualizada(true);
      setEstado(`${mensajeGuardado} La lista no se actualizó; el cambio sí se guardó. Reintenta la actualización antes de volver a realizar la acción.`);
    }
  }

  async function reintentarLista() {
    try {
      await cargar(token, plantaId, { conservarAcceso: true });
      setEstado('Lista de equipo actualizada.');
    } catch {
      setListaDesactualizada(true);
      setEstado('El cambio anterior sigue guardado, pero la lista aún no se pudo actualizar. Comprueba tu conexión e inténtalo de nuevo.');
    }
  }

  useEffect(() => {
    let cancelado = false;
    fetch('/api/config').then((respuesta) => respuesta.ok ? respuesta.json() : null).then((configuracion) => {
      const url = urlMailpitLocal(configuracion?.supabase_url);
      if (!cancelado) { setUrlBuzonLocal(url); setBuzonLocal(Boolean(url)); }
    }).catch(() => {});
    return () => { cancelado = true; };
  }, []);

  useEffect(() => {
    const cuenta = leerSesionNavegador();
    if (!cuenta.access_token) { location.replace('/acceso?returnTo=%2Fequipo'); return; }
    setToken(cuenta.access_token);
    setPlantaId(cuenta.perfil?.planta_id || '');
    setPuedeVerFacturacion(Boolean(cuenta.perfil?.es_propietario_cuenta || cuenta.perfil?.puede_administrar_facturacion));
    cargar(cuenta.access_token, cuenta.perfil?.planta_id).catch((error) => setEstado(error.message)).finally(() => setCargando(false));
  }, [cargar]);

  async function enviar(evento) {
    evento.preventDefault();
    if (mutacionEnCurso.current) return;
    mutacionEnCurso.current = true;
    setProcesando(true);
    const formulario = evento.currentTarget;
    setEstado('Enviando invitación…');
    const valores = Object.fromEntries(new FormData(evento.currentTarget));
    try {
      const respuesta = await fetchConSesion('/api/planta/equipo', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-downtimeos-planta': plantaId }, body: JSON.stringify({ ...valores, administrar_facturacion: valores.administrar_facturacion === 'on', administrar_cuenta: valores.administrar_cuenta === 'on' }) });
      const cuerpo = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) return setEstado(cuerpo.error || 'No pudimos enviar la invitación. Inténtalo de nuevo.');
      formulario.reset();
      const email = cuerpo.usuario?.email || valores.email;
      const confirmacion = buzonLocal
        ? `Supabase aceptó la solicitud de correo para ${email}. Confirma en Mailpit; en cuentas nuevas el asunto puede decir “Confirm your email address”. No llegará a Gmail ni Outlook.`
        : `Solicitamos el envío del enlace de invitación a ${email}. Pídele que revise su bandeja de entrada y spam; si no aparece, puedes reenviarlo.`;
      setEstado(confirmacion);
      await actualizarLista(confirmacion);
    } catch {
      setEstado('No pudimos confirmar el envío por un problema de conexión. Revisa la lista de invitaciones antes de volver a intentarlo.');
    } finally {
      mutacionEnCurso.current = false;
      setProcesando(false);
    }
  }

  async function actuar(id, accion) {
    if (mutacionEnCurso.current) return;
    mutacionEnCurso.current = true;
    setProcesando(true);
    const mensajes = { revocar: 'Revocando invitación…', reenviar: 'Enviando otro enlace…', delegar_admin: 'Concediendo administración de cuenta…', revocar_delegacion: 'Revocando administración de cuenta…' };
    setEstado(mensajes[accion] || 'Actualizando equipo…');
    try {
      const respuesta = await fetchConSesion('/api/planta/equipo', { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-downtimeos-planta': plantaId }, body: JSON.stringify({ id, accion }) });
      const cuerpo = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) return setEstado(cuerpo.error || 'No pudimos completar la acción. Inténtalo de nuevo.');
      await actualizarLista(cuerpo.mensaje || 'Cambios guardados.');
    } catch {
      setEstado('No pudimos confirmar el cambio por un problema de conexión. Recarga la página antes de volver a intentarlo.');
    } finally {
      mutacionEnCurso.current = false;
      setProcesando(false);
    }
  }

  async function cambiarPermisos(evento, id) {
    evento.preventDefault();
    if (mutacionEnCurso.current) return;
    mutacionEnCurso.current = true;
    setProcesando(true);
    const valores = Object.fromEntries(new FormData(evento.currentTarget));
    try {
      const respuesta = await fetchConSesion('/api/planta/equipo', { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-downtimeos-planta': plantaId }, body: JSON.stringify({ id, accion: 'cambiar_rol', ...valores, administrar_facturacion: valores.administrar_facturacion === 'on' }) });
      const cuerpo = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) return setEstado(cuerpo.error || 'No pudimos cambiar los permisos. Inténtalo de nuevo.');
      await actualizarLista(cuerpo.mensaje || 'Permisos actualizados.');
    } catch {
      setEstado('No pudimos confirmar el cambio de permisos por un problema de conexión. Recarga la página antes de volver a intentarlo.');
    } finally {
      mutacionEnCurso.current = false;
      setProcesando(false);
    }
  }

  return <main className="auth-page"><section className="auth-card onboarding-card">
    <div className="auth-card__top"><p className="auth-brand">DOWNTIME<span>OS</span></p><span className="auth-status"><i /> EQUIPO DE PLANTA</span></div>
    <p className="auth-kicker">CONTROL DE PLANTA / PASO 3 DE 3</p><h1>Invita a tu equipo</h1>
    <p className="auth-copy">Cada persona recibirá un enlace seguro para activar su acceso. Si aún no tiene cuenta, podrá crear su contraseña. Puedes invitar ahora o volver más tarde.</p>
    {accesoEquipo === 'denegado' ? <section className="onboarding-section" role="status"><h2>Esta función requiere autorización</h2><p>Solo el titular o una persona con administración delegada puede invitar y administrar usuarios. Pídele al titular que te delegue ese permiso.</p><a href="/direccion">Volver al tablero</a></section> : null}
    {accesoEquipo === 'error' ? <section className="onboarding-section" role="alert"><h2>No pudimos validar el acceso</h2><p>{estado || 'Comprueba tu conexión e inténtalo de nuevo.'}</p><button className="btn btn--secondary" type="button" onClick={() => { setAccesoEquipo('cargando'); setCargando(true); cargar(token, plantaId).catch((error) => setEstado(error.message)).finally(() => setCargando(false)); }}>Reintentar</button></section> : null}
    {accesoEquipo === 'cargando' ? <p role="status">Verificando permisos…</p> : null}
    {accesoEquipo === 'permitido' ? <>
    <form onSubmit={enviar} className="auth-form team-invite-form">
      <label>Nombre completo<input name="nombre" placeholder="Nombre de la persona" required /></label>
      <label>Correo de trabajo<input name="email" type="email" placeholder="persona@empresa.com" required /></label>
      <label>Función en la planta<select name="rol" defaultValue="operador">{permisos.es_propietario ? <option value="direccion">Dirección</option> : null}{permisos.es_propietario ? <option value="finanzas">Finanzas</option> : null}<option value="operaciones">Operaciones</option><option value="operador">Operador de piso</option></select></label>
      {permisos.es_propietario ? <label className="onboarding-check"><input name="administrar_facturacion" type="checkbox" /> También puede administrar suscripción y facturación</label> : null}
      {permisos.es_propietario ? <label className="onboarding-check"><input name="administrar_cuenta" type="checkbox" /> Delegar administración de usuarios de la cuenta</label> : null}
      {buzonLocal ? <p className="team-email-note" role="note">Estás usando el entorno local. Los correos de prueba se consultan en <a href={urlBuzonLocal} target="_blank" rel="noreferrer">Mailpit</a>; no llegan a Gmail ni Outlook. Para cuentas nuevas, el asunto puede aparecer como “Confirm your email address”.</p> : null}
      <button className="btn btn--primary btn--block auth-submit" type="submit" disabled={procesando}>{procesando ? 'Procesando…' : 'Enviar invitación'}</button>
    </form>
    <p aria-live="polite" className="auth-state">{estado}</p>
    <div className="onboarding-section team-invitations"><div><h2>Invitaciones de esta planta</h2><p>El estado se actualiza cuando la persona activa su cuenta.</p></div>
      {listaDesactualizada ? <div role="alert"><p>El cambio ya se guardó; esta lista puede estar desactualizada.</p><button className="btn btn--secondary" type="button" onClick={reintentarLista} disabled={procesando}>Reintentar actualización</button></div> : null}
      {cargando ? <p>Cargando…</p> : invitaciones.length ? <div className="team-list">{invitaciones.map((i) => <article className="team-item" key={i.id}><div><strong>{i.nombre}</strong><span>{i.email} · {i.rol}</span><small>{i.estado === 'pendiente' ? 'Pendiente' : i.estado === 'aceptada' ? 'Activa' : i.estado === 'revocada' ? 'Revocada' : i.estado}{i.es_admin_cuenta ? ' · Administrador delegado' : ''}</small></div>{i.estado === 'pendiente' || i.estado === 'aceptada' ? <div className="team-actions">{i.estado === 'pendiente' ? <button className="btn btn--secondary" type="button" disabled={procesando} onClick={() => actuar(i.id, 'reenviar')}>Reenviar enlace</button> : <details className="team-permissions"><summary>Editar permisos</summary><form onSubmit={(e) => cambiarPermisos(e, i.id)}><select name="rol" aria-label={`Función de ${i.nombre}`} defaultValue={!permisos.es_propietario && ['direccion', 'finanzas'].includes(i.rol) ? '' : i.rol} required disabled={procesando}>{!permisos.es_propietario && i.rol === 'direccion' ? <option value="" disabled>Dirección (solo titular; selecciona otra función)</option> : null}{!permisos.es_propietario && i.rol === 'finanzas' ? <option value="" disabled>Finanzas (solo titular; selecciona otra función)</option> : null}{permisos.es_propietario ? <option value="direccion">Dirección</option> : null}{permisos.es_propietario ? <option value="finanzas">Finanzas</option> : null}<option value="operaciones">Operaciones</option><option value="operador">Operador de piso</option></select>{permisos.es_propietario ? <label><input type="checkbox" name="administrar_facturacion" defaultChecked={i.puede_administrar_facturacion} disabled={procesando} /> Administrar facturación</label> : null}<button className="btn btn--secondary" type="submit" disabled={procesando}>Guardar permisos</button></form></details>}{permisos.es_propietario && i.estado === 'aceptada' ? <button className="btn btn--secondary" type="button" disabled={procesando} onClick={() => actuar(i.id, i.es_admin_cuenta ? 'revocar_delegacion' : 'delegar_admin')}>{i.es_admin_cuenta ? 'Revocar administración' : 'Delegar administración'}</button> : null}{!(permisos.es_propietario && i.estado === 'aceptada' && i.es_admin_cuenta) ? <button className="btn btn--secondary" type="button" disabled={procesando} onClick={() => actuar(i.id, 'revocar')}>{i.estado === 'aceptada' ? 'Desactivar acceso' : 'Revocar invitación'}</button> : null}</div> : null}</article>)}</div> : !cargando ? <p>Aún no has invitado personas.</p> : null}
    </div>
    <div className="team-footer">{puedeVerFacturacion ? <a href="/suscripcion" className="btn btn--primary">Continuar a suscripción y pagos</a> : null}<a href="/direccion" className="team-later">Omitir por ahora y entrar a la planta</a><p>{permisos.es_propietario ? 'Eres el titular de la cuenta. Puedes delegar la administración de usuarios; la titularidad no se transfiere.' : 'La titularidad pertenece a otra persona. Como administrador delegado, puedes gestionar miembros regulares, pero no al titular ni a otros delegados.'}</p></div>
    </> : null}
  </section></main>;
}
