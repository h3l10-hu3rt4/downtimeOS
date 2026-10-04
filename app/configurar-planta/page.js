'use client';
import { useEffect, useState } from 'react';
import { fetchConSesion, leerSesionNavegador } from '../../lib/sesion-navegador.js';
import { codigoLineaDisponible, nuevoActivo, quitarLinea as quitarLineaDelBorrador, renombrarLinea, validarBorradorPlanta } from '../../lib/configurar-planta.js';
import { borrarBorradorConfiguracion, claveBorradorConfiguracion, guardarBorradorConfiguracion, leerBorradorConfiguracion } from '../../lib/borrador-configuracion-planta.js';

const nuevaMaquina = (numero, linea = 'L-01') => ({
  id: `M-${String(numero).padStart(2, '0')}`, linea_id: linea, tipo: 'MA',
  nombre: '', etapa: '', etapa_orden: 1, tarifa_hora: '', cuello_botella: false,
});

const PLANTILLAS = {
  basica: {
    nombre: 'Una línea, etapas secuenciales',
    estructura: [{ etapas: 3, paralelas: 1 }],
  },
  paralela: {
    nombre: 'Una línea con máquinas paralelas',
    estructura: [{ etapas: 2, paralelas: 2 }],
  },
  dosLineas: {
    nombre: 'Dos líneas, etapas secuenciales',
    estructura: [{ etapas: 2, paralelas: 1 }, { etapas: 2, paralelas: 1 }],
  },
};

function crearBorrador(plantilla) {
  let numeroMaquina = 1;
  const lineas = plantilla.estructura.map((_, i) => ({ id: `L-${String(i + 1).padStart(2, '0')}`, nombre: '' }));
  const activos = plantilla.estructura.flatMap((definicion, i) => Array.from({ length: definicion.etapas }, (_, etapa) =>
    Array.from({ length: definicion.paralelas }, () => ({
      ...nuevaMaquina(numeroMaquina++, lineas[i].id), etapa: '', etapa_orden: etapa + 1,
    })),
  ).flat());
  return { lineas, activos };
}

export default function ConfigurarPlanta() {
  const [sesionLista, setSesionLista] = useState(false);
  const [lineas, setLineas] = useState([{ id: 'L-01', nombre: '' }]);
  const [activos, setActivos] = useState([nuevaMaquina(1)]);
  const [estado, setEstado] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [borradorListo, setBorradorListo] = useState(false);
  const [claveBorrador, setClaveBorrador] = useState('');
  const [borradorGuardado, setBorradorGuardado] = useState(false);
  const [borradorIntentado, setBorradorIntentado] = useState(false);
  const [lineaPendienteDeQuitar, setLineaPendienteDeQuitar] = useState(null);

  useEffect(() => {
    const sesion = leerSesionNavegador();
    if (!sesion.access_token) {
      location.replace('/acceso?returnTo=%2Fconfigurar-planta');
      return;
    }
    const clave = claveBorradorConfiguracion(sesion.user?.id, sesion.perfil?.planta_id);
    const guardado = leerBorradorConfiguracion(clave);
    if (guardado) {
      setLineas(guardado.lineas);
      setActivos(guardado.activos);
      setEstado('Recuperamos tu borrador guardado en este navegador. Revísalo y continúa cuando esté listo.');
    }
    setClaveBorrador(clave);
    setBorradorListo(true);
    setSesionLista(true);
  }, []);

  useEffect(() => {
    if (!borradorListo || !claveBorrador || guardando) return undefined;
    const temporizador = setTimeout(() => {
      setBorradorGuardado(guardarBorradorConfiguracion(claveBorrador, lineas, activos));
      setBorradorIntentado(true);
    }, 300);
    return () => clearTimeout(temporizador);
  }, [activos, borradorListo, claveBorrador, guardando, lineas]);

  function cargarPlantilla(clave) {
    setLineaPendienteDeQuitar(null);
    if (clave === 'cero') {
      setLineas([{ id: 'L-01', nombre: '' }]);
      setActivos([nuevaMaquina(1)]);
    } else {
      const borrador = crearBorrador(PLANTILLAS[clave]);
      setLineas(borrador.lineas);
      setActivos(borrador.activos);
    }
    setEstado('Estructura cargada como borrador. Completa tus datos reales y pulsa Guardar y continuar para guardar.');
  }

  function cambiarLinea(indice, campo, valor) {
    setLineaPendienteDeQuitar(null);
    if (campo === 'id') {
      const borrador = renombrarLinea(lineas, activos, indice, valor);
      setLineas(borrador.lineas);
      setActivos(borrador.activos);
      return;
    }
    setLineas((actuales) => actuales.map((linea, i) => i === indice ? { ...linea, [campo]: valor } : linea));
  }
  function agregarLinea() {
    if (lineas.length >= 30) {
      setEstado('Tu plan permite hasta 30 líneas por planta.');
      return;
    }
    setLineas((actuales) => [...actuales, { id: codigoLineaDisponible(actuales), nombre: '' }]);
  }
  function quitarLinea(indice) {
    const borrador = quitarLineaDelBorrador(lineas, activos, indice);
    setLineas(borrador.lineas);
    setActivos(borrador.activos);
    setLineaPendienteDeQuitar(null);
    setEstado('Línea y máquinas asociadas quitadas del borrador. Aún no se ha guardado ningún cambio en la planta.');
  }
  function solicitarQuitarLinea(indice) {
    const linea = lineas[indice];
    if (!linea) return;
    const maquinas = activos.filter((activo) => activo.linea_id === linea.id).length;
    if (maquinas > 0) {
      setLineaPendienteDeQuitar({ id: linea.id, maquinas });
      return;
    }
    quitarLinea(indice);
  }
  function cambiarActivo(indice, campo, valor) {
    setActivos((actuales) => actuales.map((activo, i) => i === indice ? { ...activo, [campo]: valor } : activo));
  }
  function agregarActivo() {
    if (activos.length >= 500) {
      setEstado('Tu plan permite registrar hasta 500 máquinas por planta.');
      return;
    }
    if (!lineas.length) return;
    setActivos((actuales) => {
      const nuevo = nuevoActivo(lineas, actuales);
      return nuevo ? [...actuales, nuevaMaquina(Number(nuevo.id.split('-')[1]), nuevo.linea_id)] : actuales;
    });
  }
  function quitarActivo(indice) { setActivos((actuales) => actuales.filter((_, i) => i !== indice)); }

  async function guardar(evento) {
    evento.preventDefault();
    const errorBorrador = validarBorradorPlanta(lineas, activos);
    if (errorBorrador) { setEstado(errorBorrador); return; }
    setGuardando(true); setEstado('Guardando la configuración de tu planta…');
    try {
      const sesion = leerSesionNavegador();
      const token = sesion.access_token;
      if (!token) throw new Error('Tu sesión expiró. Inicia sesión para continuar.');
      const respuesta = await fetchConSesion('/api/planta/configuracion', {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-downtimeos-planta': sesion.perfil?.planta_id || '' },
        body: JSON.stringify({ lineas, activos: activos.map((a) => ({ ...a, etapa_orden: Number(a.etapa_orden), tarifa_hora: Number(a.tarifa_hora) })) }),
      });
      const cuerpo = await respuesta.json();
      if (!respuesta.ok) throw new Error(cuerpo.error || 'No pudimos guardar la configuración.');
      borrarBorradorConfiguracion(claveBorrador);
      setEstado('Planta configurada. Ya puedes entrar a tu tablero.');
      setTimeout(() => location.assign('/equipo'), 500);
    } catch (error) {
      setEstado(error.message || 'No pudimos guardar la configuración. Intenta de nuevo.');
      setGuardando(false);
    }
  }

  if (!sesionLista) return <main className="auth-page"><section className="auth-card"><p role="status" className="auth-copy">Verificando tu sesión…</p></section></main>;

  return <main className="auth-page"><section className="auth-card onboarding-card">
    <div className="auth-card__top"><p className="auth-brand">DOWNTIME<span>OS</span></p><span className="auth-status"><i /> CONFIGURACIÓN INICIAL</span></div>
    <p className="auth-kicker">CONTROL DE PLANTA / PASO 2 DE 3</p>
    <h1>Configura tus líneas y máquinas</h1>
    <p className="auth-copy">Registra tus activos reales para que los tiempos y el impacto financiero tengan sentido. Todavía no hay datos de demostración en tu planta.</p>
    <form className="auth-form onboarding-form" onSubmit={guardar}>
      <div className="onboarding-section"><div><h2>Elige cómo empezar</h2><p>Una plantilla solo prepara una estructura editable. No incluye nombres de activos ni tarifas, y no guarda nada hasta que captures tus datos reales y pulses Guardar y continuar.</p></div>
        <button type="button" className="btn btn--secondary" onClick={() => cargarPlantilla('cero')}>Empezar desde cero</button>
        {Object.entries(PLANTILLAS).map(([clave, plantilla]) => <button key={clave} type="button" className="btn btn--secondary" onClick={() => cargarPlantilla(clave)}>{plantilla.nombre}</button>)}
      </div>
      <div className="onboarding-section"><div><h2>Líneas de producción</h2><p>Crea una línea por flujo de producción.</p></div>
        {lineas.map((linea, i) => <div className="onboarding-row onboarding-line" key={linea.id}>
          <label>Código<input value={linea.id} onChange={(e) => cambiarLinea(i, 'id', e.target.value.toUpperCase())} pattern="L-[0-9]{2}" required /></label>
          <label>Nombre de la línea<input value={linea.nombre} onChange={(e) => cambiarLinea(i, 'nombre', e.target.value)} placeholder="Ej. Ensamble final" required minLength={2} /></label>
          {lineaPendienteDeQuitar?.id === linea.id ? <div className="onboarding-confirm" role="alert">
            <p>Quitar {linea.id} también quitará {lineaPendienteDeQuitar.maquinas} {lineaPendienteDeQuitar.maquinas === 1 ? 'máquina' : 'máquinas'} de este borrador. Nada se guardará hasta que pulses “Guardar y continuar”.</p>
            <button type="button" className="btn btn--secondary" onClick={() => setLineaPendienteDeQuitar(null)}>Conservar línea</button>
            <button type="button" className="btn btn--secondary" onClick={() => quitarLinea(i)}>Quitar línea y máquinas</button>
          </div> : <button type="button" className="btn btn--secondary" onClick={() => solicitarQuitarLinea(i)} aria-label={`Quitar línea ${linea.id}`} disabled={lineas.length <= 1}>Quitar línea</button>}
        </div>)}
        <button type="button" className="btn btn--secondary" onClick={agregarLinea} disabled={lineas.length >= 30}>Agregar línea{lineas.length >= 30 ? ' (máximo 30)' : ''}</button>
      </div>
      <div className="onboarding-section"><div><h2>Máquinas y etapas</h2><p>Máquinas con el mismo nombre de etapa se consideran paralelas. Asigna el orden del proceso.</p></div>
        {activos.map((activo, i) => <fieldset className="onboarding-machine" key={`${i}-${activo.id}`}><legend>Máquina {i + 1}</legend>
          <div className="onboarding-row onboarding-machine-grid">
            <label>Código<input value={activo.id} onChange={(e) => cambiarActivo(i, 'id', e.target.value.toUpperCase())} pattern="[A-Z]-[0-9]{2}" required /></label>
            <label>Nombre<input value={activo.nombre} onChange={(e) => cambiarActivo(i, 'nombre', e.target.value)} placeholder="Ej. Prensa hidráulica 01" required minLength={2} /></label>
            <label>Línea<select value={activo.linea_id} onChange={(e) => cambiarActivo(i, 'linea_id', e.target.value)}>{lineas.map((l) => <option key={l.id} value={l.id}>{l.nombre || l.id}</option>)}</select></label>
            <label>Etapa<input value={activo.etapa} onChange={(e) => cambiarActivo(i, 'etapa', e.target.value)} placeholder="Ej. Corte" required minLength={2} /></label>
            <label>Orden de etapa<input type="number" min="1" max="99" value={activo.etapa_orden} onChange={(e) => cambiarActivo(i, 'etapa_orden', e.target.value)} required /></label>
            <label>Costo por hora (MXN)<input type="number" min="1" max="1000000" step="0.01" value={activo.tarifa_hora} onChange={(e) => cambiarActivo(i, 'tarifa_hora', e.target.value)} placeholder="Ej. 950" required /></label>
          </div>
          <label className="onboarding-check"><input type="checkbox" checked={activo.cuello_botella} onChange={(e) => cambiarActivo(i, 'cuello_botella', e.target.checked)} /> Es un activo crítico / cuello de botella</label>
          <button type="button" className="btn btn--secondary" onClick={() => quitarActivo(i)} aria-label={`Quitar máquina ${activo.id}`}>Quitar máquina</button>
        </fieldset>)}
        <button type="button" className="btn btn--secondary" onClick={agregarActivo} disabled={!lineas.length || activos.length >= 500}>Agregar máquina{activos.length >= 500 ? ' (máximo 500)' : ''}</button>
      </div>
      <button type="submit" className="btn btn--primary btn--block auth-submit" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar y continuar'}</button>
    </form>
    <p aria-live="polite" className="auth-state">{estado}</p>
    <p className="onboarding-footnote" role="status">{!claveBorrador
      ? 'No se pudo identificar tu planta para guardar un borrador local. Mantén esta página abierta hasta guardar la configuración.'
      : borradorGuardado
      ? 'Borrador guardado automáticamente en este navegador; todavía no se comparte ni se guarda en la planta.'
      : borradorIntentado
        ? 'No se pudo guardar el borrador en este navegador. Mantén esta página abierta hasta guardar la configuración.'
        : 'Guardando el borrador en este navegador… Todavía no se comparte ni se guarda en la planta.'}</p>
    <p className="onboarding-footnote">Podrás pedir ayuda para completar la configuración. Los activos con historial se archivan; no se borran.</p>
  </section></main>;
}
