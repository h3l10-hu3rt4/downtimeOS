'use client';
import { useCallback, useEffect, useState } from 'react';
import { fetchConSesion, guardarSesionNavegador, leerSesionNavegador, tokensVigentesDeSesion } from '../../lib/sesion-navegador.js';
import { destinoTablero } from '../acceso/return-to.js';

function destinoDePlanta(perfil) {
  if (!perfil?.onboarding_completado_en) return '/configurar-planta';
  return destinoTablero(perfil);
}

export default function Plantas() {
  const [cuenta, setCuenta] = useState(null);
  const [nombre, setNombre] = useState('');
  const [estado, setEstado] = useState('Cargando tus plantas…');
  const [estadoCarga, setEstadoCarga] = useState('cargando');
  const [ocupado, setOcupado] = useState(false);

  const cargarPlantas = useCallback(async (actual) => {
    const respuesta = await fetchConSesion('/api/planta/plantas', { headers: { authorization: `Bearer ${actual.access_token}`, 'x-downtimeos-planta': actual.perfil?.planta_id || '' } });
    const body = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) throw Object.assign(new Error(body.error || 'No pudimos cargar tus plantas.'), { status: respuesta.status });
    if (!Array.isArray(body.plantas) || typeof body.puede_agregar_planta !== 'boolean' || typeof body.puede_crear_planta !== 'boolean') {
      throw new Error('Recibimos información incompleta de tus plantas. Inténtalo de nuevo.');
    }
    const actualizado = {
      ...tokensVigentesDeSesion(actual),
      plantas_disponibles: body.plantas,
      puede_agregar_planta: body.puede_agregar_planta,
      motivo_agregar_planta: String(body.motivo_agregar_planta || ''),
      puede_crear_planta: body.puede_crear_planta,
      motivo_crear_planta: String(body.motivo_crear_planta || ''),
    };
    if (!guardarSesionNavegador(actualizado)) {
      throw new Error('Tus plantas se cargaron, pero el navegador bloqueó guardar la sesión. Permite el almacenamiento para este sitio e inicia sesión de nuevo.');
    }
    setCuenta(actualizado);
    setEstado('');
    setEstadoCarga('permitido');
  }, []);

  function manejarErrorCarga(error) {
    if (error.status === 401) {
      location.replace('/acceso?returnTo=%2Fplantas');
      return;
    }
    setEstado(error.message || 'No pudimos cargar las plantas. Comprueba tu conexión e inténtalo de nuevo.');
    setEstadoCarga(error.status === 403 ? 'denegado' : 'error');
  }

  useEffect(() => {
    const actual = leerSesionNavegador();
    if (!actual.access_token) { location.replace('/acceso?returnTo=%2Fplantas'); return; }
    setCuenta(actual);
    cargarPlantas(actual).catch(manejarErrorCarga);
  }, [cargarPlantas]);

  async function seleccionar(planta) {
    if (!cuenta) return;
    setOcupado(true); setEstado(`Abriendo ${planta.nombre}…`);
    try {
      const respuesta = await fetchConSesion('/api/cuenta', { headers: { authorization: `Bearer ${cuenta.access_token}`, 'x-downtimeos-planta': planta.planta_id } });
      const cuerpo = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) throw new Error(cuerpo.error || 'No pudimos abrir esta planta.');
      if (!cuerpo.perfil || !Array.isArray(cuerpo.plantas_disponibles)) {
        throw new Error('El servidor respondió sin confirmar el acceso a esta planta. Actualiza la lista e inténtalo de nuevo.');
      }
      if (cuerpo.perfil.planta_id !== planta.planta_id) {
        throw new Error('El servidor confirmó una planta distinta a la seleccionada. No cambiamos tu sesión; actualiza la lista e inténtalo de nuevo.');
      }
      const destino = destinoDePlanta(cuerpo.perfil);
      if (!destino) throw new Error('Tu rol no tiene una pantalla de planta asignada. Contacta a la persona administradora de tu cuenta.');
      const actualizado = { ...tokensVigentesDeSesion(cuenta), perfil: cuerpo.perfil, plantas_disponibles: cuerpo.plantas_disponibles, planta_id: planta.planta_id };
      if (!guardarSesionNavegador(actualizado)) {
        throw new Error('La planta está disponible, pero el navegador bloqueó guardar la sesión. Permite el almacenamiento para este sitio e inténtalo de nuevo.');
      }
      location.assign(destino);
    } catch (error) {
      setEstado(error.message || 'No pudimos abrir la planta por un problema de conexión. Inténtalo de nuevo.');
      setOcupado(false);
    }
  }

  async function agregar(evento) {
    evento.preventDefault();
    if (!cuenta || ocupado) return;
    setOcupado(true); setEstado('Creando nueva planta…');
    let creada = false;
    try {
      const respuesta = await fetchConSesion('/api/planta/plantas', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${cuenta.access_token}`, 'x-downtimeos-planta': cuenta.perfil.planta_id }, body: JSON.stringify({ nombre }) });
      const cuerpo = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) throw new Error(cuerpo.error || 'No pudimos crear la planta.');
      creada = true;
      const seleccion = await fetchConSesion('/api/cuenta', { headers: { authorization: `Bearer ${cuenta.access_token}`, 'x-downtimeos-planta': cuerpo.planta.id } });
      const perfil = await seleccion.json().catch(() => ({}));
      if (!seleccion.ok) {
        setEstado('La planta se creó, pero no pudimos abrirla. Selecciónala de la lista para continuar.');
        const lista = await fetchConSesion('/api/planta/plantas', { headers: { authorization: `Bearer ${cuenta.access_token}`, 'x-downtimeos-planta': cuenta.perfil.planta_id } });
        const actualizadas = await lista.json().catch(() => ({}));
        if (lista.ok && Array.isArray(actualizadas.plantas)) {
          const siguiente = { ...tokensVigentesDeSesion(cuenta), plantas_disponibles: actualizadas.plantas };
          if (!guardarSesionNavegador(siguiente)) {
            setEstado('La planta se creó. El navegador bloqueó guardar la sesión; permite el almacenamiento y recarga para seleccionarla.');
            setOcupado(false);
            return;
          }
          setCuenta(siguiente);
        }
        setOcupado(false);
        return;
      }
      if (!perfil.perfil || !Array.isArray(perfil.plantas_disponibles)) {
        setEstado('La planta se creó, pero el servidor no confirmó la sesión para abrirla. Actualiza la lista y selecciónala para continuar.');
        setOcupado(false);
        return;
      }
      if (perfil.perfil.planta_id !== cuerpo.planta.id) {
        setEstado('La planta se creó, pero el servidor no confirmó el acceso a ese sitio. Actualiza la lista antes de continuar.');
        setOcupado(false);
        return;
      }
      const actualizado = { ...tokensVigentesDeSesion(cuenta), perfil: perfil.perfil, plantas_disponibles: perfil.plantas_disponibles, planta_id: cuerpo.planta.id };
      if (!guardarSesionNavegador(actualizado)) {
        setEstado('La planta se creó, pero el navegador bloqueó guardar la sesión. Permite el almacenamiento e inicia sesión para seleccionarla.');
        setOcupado(false);
        return;
      }
      location.assign('/configurar-planta');
    } catch (error) {
      setEstado(creada
        ? 'La planta se creó, pero no pudimos terminar de abrirla. Recarga la lista y selecciónala para continuar.'
        : error.message || 'No pudimos confirmar la creación. Recarga la lista de plantas antes de volver a intentarlo.');
      setOcupado(false);
    }
  }

  const destinoRegreso = destinoDePlanta(cuenta?.perfil) || '/acceso';

  return <main className="auth-page"><section className="auth-card onboarding-card plant-picker-card">
    <div className="auth-card__top"><p className="auth-brand">DOWNTIME<span>OS</span></p><span className="auth-status"><i /> ESPACIOS DE TRABAJO</span></div>
    <p className="auth-kicker">CUENTA / PLANTAS</p><h1>Selecciona una planta</h1><p className="auth-copy">Elige el sitio cuya operación quieres consultar. Cada planta mantiene su propio equipo, máquinas e historial.</p>
    {estadoCarga === 'cargando' ? <p role="status">Verificando acceso y cargando plantas…</p> : null}
    {estadoCarga === 'denegado' ? <section className="onboarding-section" role="status"><h2>No tienes permiso para consultar estas plantas</h2><p>{estado || 'Pide acceso a la persona administradora de tu empresa.'}</p><a className="btn btn--secondary" href={destinoRegreso}>Volver al tablero</a></section> : null}
    {estadoCarga === 'error' ? <section className="onboarding-section" role="alert"><h2>No pudimos cargar tus plantas</h2><p>{estado}</p><button className="btn btn--secondary" type="button" disabled={ocupado} onClick={() => { setEstadoCarga('cargando'); setEstado('Cargando tus plantas…'); cargarPlantas(cuenta).catch(manejarErrorCarga); }}>Reintentar</button></section> : null}
    {estadoCarga === 'permitido' ? <>
      <div className="plant-list">{(cuenta?.plantas_disponibles || []).map((planta) => <button className="plant-choice" key={planta.planta_id} disabled={ocupado} onClick={() => seleccionar(planta)}><span><strong>{planta.nombre}</strong><small>{planta.organizacion} · {planta.rol}</small></span><span>Entrar</span></button>)}</div>
      {!cuenta?.plantas_disponibles?.length ? <p>No hay plantas disponibles para tu cuenta. Contacta a la persona administradora para que te asigne acceso.</p> : null}
      {cuenta?.perfil?.es_propietario_cuenta ? <form className="onboarding-section plant-create" onSubmit={agregar}><h2>Agregar otra planta</h2><p>{cuenta.puede_crear_planta ? 'Disponible en Enterprise y sujeto a los sitios incluidos en tu cotización.' : cuenta.motivo_crear_planta}</p><label>Nombre de la nueva planta<input value={nombre} onChange={(e) => setNombre(e.target.value)} minLength={2} required placeholder="Ej. Planta Norte" /></label><button className="btn btn--secondary" type="submit" disabled={ocupado || !cuenta.puede_crear_planta}>Crear planta</button></form> : cuenta?.perfil?.es_admin_cuenta ? <section className="onboarding-section plant-create-info"><h2>Agregar otra planta</h2><p>{cuenta.motivo_crear_planta || 'Solo el titular de la cuenta puede agregar plantas.'} Contacta al titular para solicitar un sitio adicional.</p></section> : null}
    </> : null}
    {estadoCarga === 'permitido' && estado ? <p aria-live="polite" className="auth-state">{estado}</p> : null}<p className="auth-footer"><a href={destinoRegreso}>Volver al tablero</a></p>
  </section></main>;
}
