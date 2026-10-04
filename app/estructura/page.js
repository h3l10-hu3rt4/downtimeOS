'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchConSesion, leerSesionNavegador } from '../../lib/sesion-navegador.js';

const vacio = { id: '', nombre: '', linea_id: '', tipo: 'MA', etapa: '', etapa_orden: 1, tarifa_hora: '', cuello_botella: false };

export async function ejecutarMutacionEstructura({ mutar, recargar, alMutar, alRecargarError }) {
  const resultado = await mutar();
  alMutar?.(resultado);
  try {
    const recargaCorrecta = await recargar();
    if (recargaCorrecta === false) throw new Error('La mutación se completó, pero la lista no se pudo actualizar.');
    return { resultado, recargaError: null };
  } catch (error) {
    alRecargarError?.(error);
    return { resultado, recargaError: error };
  }
}

export default function EstructuraPlanta() {
  const [sesionLista, setSesionLista] = useState(false);
  const [lineas, setLineas] = useState([]);
  const [activos, setActivos] = useState([]);
  const [linea, setLinea] = useState({ id: '', nombre: '' });
  const [activo, setActivo] = useState(vacio);
  const [mensaje, setMensaje] = useState('');
  const [acceso, setAcceso] = useState('verificando');
  const [errorCodigo, setErrorCodigo] = useState('');
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [archivando, setArchivando] = useState('');
  const [editandoActivo, setEditandoActivo] = useState('');
  const [errorCarga, setErrorCarga] = useState('');
  const archivandoLock = useRef(false);

  const peticion = useCallback(async (method = 'GET', body) => {
    const sesion = leerSesionNavegador();
    if (!sesion.access_token) throw new Error('Tu sesión expiró. Inicia sesión de nuevo.');
    const respuesta = await fetchConSesion('/api/planta/estructura', { method,
      headers: { authorization: `Bearer ${sesion.access_token}`, 'x-downtimeos-planta': sesion.perfil?.planta_id || '', ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const resultado = await respuesta.json();
    if (!respuesta.ok) {
      const error = new Error(resultado.error || 'No se pudo completar la operación.');
      error.codigo = resultado.codigo || '';
      error.status = respuesta.status;
      throw error;
    }
    return resultado;
  }, []);

  const cargar = useCallback(async () => {
    setCargando(true);
    setErrorCarga('');
    try {
      const datos = await peticion(); setLineas(datos.lineas); setActivos(datos.activos);
      const primeraLinea = datos.lineas.find((fila) => fila.activa && !fila.archivado_en)?.id || '';
      setActivo((actual) => actual.linea_id ? actual : { ...actual, linea_id: primeraLinea });
      setAcceso('permitido');
      return true;
    }
    catch (error) {
      setErrorCarga(error.message || 'Comprueba tu conexión e inténtalo de nuevo.');
      if (error.status === 401) {
        location.replace('/acceso?returnTo=%2Festructura');
      } else if (error.status === 403) {
        setAcceso(error.status === 403 ? 'denegado' : 'error');
      } else {
        setAcceso((actual) => actual === 'permitido' ? 'permitido' : 'error');
      }
      return false;
    }
    finally { setCargando(false); }
  }, [peticion]);
  useEffect(() => {
    const sesion = leerSesionNavegador();
    if (!sesion.access_token) {
      location.replace('/acceso?returnTo=%2Festructura');
      return;
    }
    setSesionLista(true);
    cargar();
  }, [cargar]);

  async function crear(tipo, datos) {
    if (guardando) return;
    setGuardando(true); setErrorCodigo('');
    try {
      await ejecutarMutacionEstructura({
        mutar: () => peticion('POST', { tipo, [tipo]: datos }),
        recargar: cargar,
        alMutar: () => {
          setMensaje(tipo === 'linea' ? 'Línea agregada.' : 'Equipo agregado.');
          if (tipo === 'linea') setLinea({ id: '', nombre: '' }); else setActivo({ ...vacio, linea_id: lineasActivas[0]?.id || '' });
        },
        alRecargarError: () => setMensaje(tipo === 'linea'
          ? 'Línea agregada. No pudimos actualizar la lista; puedes reintentar.'
          : 'Equipo agregado. No pudimos actualizar la lista; puedes reintentar.'),
      });
    } catch (error) { setMensaje(error.message); setErrorCodigo(error.codigo || ''); }
    finally { setGuardando(false); }
  }
  function editarActivo(fila) {
    if (guardando || archivando) return;
    setMensaje(''); setErrorCodigo(''); setEditandoActivo(fila.id);
    setActivo({
      id: fila.id, nombre: fila.nombre, linea_id: fila.linea_id, tipo: fila.tipo || 'MA',
      etapa: fila.etapa, etapa_orden: fila.etapa_orden, tarifa_hora: fila.tarifa_hora,
      cuello_botella: Boolean(fila.cuello_botella),
    });
    document.getElementById('nuevo-equipo')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  async function actualizarActivo(datos) {
    if (guardando || !editandoActivo) return;
    setGuardando(true); setErrorCodigo('');
    try {
      await ejecutarMutacionEstructura({
        mutar: () => peticion('PATCH', { accion: 'actualizar_activo', activo: datos }),
        recargar: cargar,
        alMutar: () => {
          setMensaje(`Equipo ${editandoActivo} actualizado. Los paros históricos no cambiaron.`);
          setEditandoActivo('');
          setActivo({ ...vacio, linea_id: lineasActivas[0]?.id || '' });
        },
        alRecargarError: () => setMensaje(`Equipo actualizado. No pudimos refrescar la lista; puedes reintentar.`),
      });
    } catch (error) { setMensaje(error.message); setErrorCodigo(error.codigo || ''); }
    finally { setGuardando(false); }
  }
  function cancelarEdicionActivo() {
    setEditandoActivo(''); setActivo({ ...vacio, linea_id: lineasActivas[0]?.id || '' }); setMensaje(''); setErrorCodigo('');
  }
  async function archivar(tipo, id) {
    const clave = `${tipo}:${id}`;
    if (archivandoLock.current) return;
    if (!window.confirm(`¿Archivar ${tipo === 'linea' ? 'la línea' : 'el equipo'} ${id}? Se conserva el historial de paros.`)) return;
    archivandoLock.current = true;
    setArchivando(clave); setErrorCodigo('');
    try {
      await ejecutarMutacionEstructura({
        mutar: () => peticion('PATCH', { accion: `archivar_${tipo}`, id }),
        recargar: cargar,
        alMutar: () => setMensaje('Elemento archivado; su historial se conservó.'),
        alRecargarError: () => setMensaje('Elemento archivado; su historial se conservó. No pudimos actualizar la lista; puedes reintentar.'),
      });
    } catch (error) { setMensaje(error.message); setErrorCodigo(error.codigo || ''); }
    finally { archivandoLock.current = false; setArchivando(''); }
  }

  const lineasActivas = lineas.filter((fila) => fila.activa && !fila.archivado_en);
  if (!sesionLista) return <main className="account-page"><p role="status">Verificando tu sesión…</p></main>;

  return <main className="account-page"><div className="account-page__header"><div><p className="auth-kicker">ADMINISTRACIÓN DE PLANTA</p><h1>Líneas y equipos</h1><p>Actualiza la estructura sin borrar eventos ni reportes históricos.</p></div><a className="btn btn--secondary" href="/direccion">Volver al panel</a></div>
    {acceso === 'verificando' ? <p role="status">Verificando permisos…</p> : null}
    {acceso === 'denegado' ? <section className="account-panel" role="status"><h2>Esta función requiere autorización</h2><p>Solo Dirección puede cambiar líneas, equipos y tarifas de la planta. Si necesitas acceso, pide autorización a la persona administradora de tu empresa.</p></section> : null}
    {acceso === 'error' ? <section className="account-panel" role="alert"><h2>No pudimos validar el acceso</h2><p>{errorCarga || 'Comprueba tu conexión e inténtalo de nuevo.'}</p><button className="btn btn--secondary" type="button" onClick={() => { setAcceso('verificando'); void cargar(); }}>Reintentar</button></section> : null}
    {acceso === 'permitido' ? <>
    {mensaje && <p className="auth-state" role="status">{mensaje}{errorCodigo === 'PLAN_ASSET_LIMIT' ? <> <a href="/suscripcion">Ver suscripción y pagos</a></> : null}</p>}
    {errorCarga ? <section className="account-panel" role="alert"><h2>No pudimos actualizar la lista</h2><p>{errorCarga}</p><button className="btn btn--secondary" type="button" disabled={cargando} onClick={() => { void cargar(); }}>{cargando ? 'Actualizando…' : 'Reintentar'}</button></section> : null}
    <section className="account-panel"><h2>Líneas</h2>
      {cargando ? <p role="status">Cargando líneas…</p> : lineas.length ? <div className="account-list">{lineas.map((fila) => <article className="account-list__row" key={fila.id}><div><strong>{fila.id} · {fila.nombre}</strong><small>{fila.archivado_en || !fila.activa ? 'Archivada' : 'Activa'}</small></div>{fila.activa && !fila.archivado_en && <button className="btn btn--secondary" type="button" disabled={Boolean(archivando) || guardando} onClick={() => archivar('linea', fila.id)}>{archivando === `linea:${fila.id}` ? 'Archivando…' : 'Archivar'}</button>}</article>)}</div> : <div className="account-empty-state"><h3>Aún no hay líneas de producción</h3><p>Agrega la primera línea para organizar los equipos de esta planta.</p><a className="btn btn--secondary" href="#nueva-linea">Ir a agregar línea</a></div>}
      <form id="nueva-linea" className="account-inline-form" onSubmit={(e) => { e.preventDefault(); crear('linea', linea); }}><label>Código<input required pattern="L-[0-9]{2}" placeholder="L-03" value={linea.id} onChange={(e) => setLinea({ ...linea, id: e.target.value.toUpperCase() })} /></label><label>Nombre<input required minLength="2" placeholder="Empaque" value={linea.nombre} onChange={(e) => setLinea({ ...linea, nombre: e.target.value })} /></label><button className="btn btn--primary" disabled={guardando}>{guardando ? 'Guardando…' : 'Agregar línea'}</button></form>
    </section>
    <section className="account-panel"><h2>Equipos</h2>{!cargando && !activos.length ? <div className="account-empty-state"><h3>Aún no hay equipos registrados</h3><p>{lineasActivas.length ? 'Agrega el primer equipo y asígnalo a una línea de producción.' : 'Primero crea una línea de producción; después podrás agregar y asignar sus equipos.'}</p><a className="btn btn--secondary" href={lineasActivas.length ? '#nuevo-equipo' : '#nueva-linea'}>{lineasActivas.length ? 'Ir a agregar equipo' : 'Ir a agregar línea'}</a></div> : null}{cargando ? <p role="status">Cargando equipos…</p> : activos.length ? <div className="account-list">{activos.map((fila) => <article className="account-list__row" key={fila.id}><div><strong>{fila.id} · {fila.nombre}</strong><small>{fila.linea_id} / {fila.etapa} · {fila.archivado_en || !fila.activo ? 'Archivado' : 'Activo'}</small></div>{fila.activo && !fila.archivado_en && <div className="account-list__actions"><button className="btn btn--secondary" type="button" disabled={Boolean(archivando) || guardando || Boolean(editandoActivo)} onClick={() => editarActivo(fila)}>Editar</button><button className="btn btn--secondary" type="button" disabled={Boolean(archivando) || guardando || Boolean(editandoActivo)} onClick={() => archivar('activo', fila.id)}>{archivando === `activo:${fila.id}` ? 'Archivando…' : 'Archivar'}</button></div>}</article>)}</div> : null}
      <form id="nuevo-equipo" className="account-grid-form" onSubmit={(e) => { e.preventDefault(); const datos = { ...activo, etapa_orden: Number(activo.etapa_orden), tarifa_hora: Number(activo.tarifa_hora) }; if (editandoActivo) actualizarActivo(datos); else crear('activo', datos); }}>
        <h3>{editandoActivo ? `Editar equipo ${editandoActivo}` : 'Agregar equipo'}</h3>
        {editandoActivo ? <p className="account-form-hint">Los cambios aplican a próximos paros. El historial conserva los datos originales.</p> : null}
        <label>Código<input required pattern="[A-Z]-[0-9]{2}" placeholder="M-03" value={activo.id} readOnly={Boolean(editandoActivo)} onChange={(e) => setActivo({ ...activo, id: e.target.value.toUpperCase() })} /></label>
        <label>Nombre<input required minLength="2" placeholder="Transportador 03" value={activo.nombre} onChange={(e) => setActivo({ ...activo, nombre: e.target.value })} /></label>
        <label>Línea<select value={activo.linea_id} onChange={(e) => setActivo({ ...activo, linea_id: e.target.value })} required>{lineasActivas.map((fila) => <option key={fila.id} value={fila.id}>{fila.id} · {fila.nombre}</option>)}</select></label>
        <label>Etapa<input required minLength="2" placeholder="Ensamble" value={activo.etapa} onChange={(e) => setActivo({ ...activo, etapa: e.target.value })} /></label>
        <label>Orden<input type="number" min="1" max="99" required value={activo.etapa_orden} onChange={(e) => setActivo({ ...activo, etapa_orden: e.target.value })} /></label>
        <label>Tarifa por hora (MXN)<input type="number" min="1" step="0.01" required value={activo.tarifa_hora} onChange={(e) => setActivo({ ...activo, tarifa_hora: e.target.value })} /></label>
        <label className="onboarding-check"><input type="checkbox" checked={activo.cuello_botella} onChange={(e) => setActivo({ ...activo, cuello_botella: e.target.checked })} /> Cuello de botella</label>
        <div className="account-form-actions"><button className="btn btn--primary" disabled={guardando || Boolean(archivando)}>{guardando ? 'Guardando…' : editandoActivo ? 'Guardar cambios' : 'Agregar equipo'}</button>{editandoActivo ? <button className="btn btn--secondary" type="button" disabled={guardando} onClick={cancelarEdicionActivo}>Cancelar</button> : null}</div>
      </form>
    </section>
    </> : null}
  </main>;
}
