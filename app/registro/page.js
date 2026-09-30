'use client';
import { useState } from 'react';
export default function Registro() {
  const [estado, setEstado] = useState('');
  async function enviar(evento) {
    evento.preventDefault(); setEstado('Creando empresa y planta…');
    const datos = Object.fromEntries(new FormData(evento.currentTarget));
    const respuesta = await fetch('/api/cuenta', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ accion:'registro', ...datos }) });
    const cuerpo = await respuesta.json();
    if (!respuesta.ok) return setEstado(cuerpo.error || 'No fue posible crear la cuenta.');
    setEstado('Cuenta creada. Ahora inicia sesión para configurar tus máquinas.');
    evento.currentTarget.reset();
  }
  return <main style={estilos.main}><section style={estilos.tarjeta}><p style={estilos.marca}>DOWNTIME<span>OS</span></p><h1>Configura tu primera planta</h1><p style={estilos.texto}>Crea la cuenta de Dirección. Después podrás invitar a Operaciones y a los operadores de piso.</p><form onSubmit={enviar} style={estilos.form}><input name="empresa" placeholder="Empresa" required style={estilos.input}/><input name="planta" placeholder="Planta principal" required style={estilos.input}/><input name="nombre" placeholder="Tu nombre" required style={estilos.input}/><input name="email" type="email" placeholder="correo@empresa.com" required style={estilos.input}/><input name="password" type="password" minLength="10" placeholder="Contraseña de al menos 10 caracteres" required style={estilos.input}/><button style={estilos.boton}>Crear empresa</button></form><p aria-live="polite" style={estilos.estado}>{estado}</p><p style={estilos.texto}><a href="/acceso">Ya tengo una cuenta</a>.</p></section></main>;
}
const estilos={main:{minHeight:'100vh',display:'grid',placeItems:'center',background:'#06080b',color:'#f4f4f0',fontFamily:'Inter,Arial,sans-serif',padding:24},tarjeta:{width:'min(500px,100%)',padding:36,border:'1px solid #303940',borderRadius:18,background:'#10151a'},marca:{fontWeight:800,letterSpacing:1},texto:{color:'#aeb8c2',lineHeight:1.6},form:{display:'grid',gap:12,marginTop:24},input:{padding:'14px 16px',background:'#080b0e',border:'1px solid #3a444d',borderRadius:8,color:'#fff'},boton:{padding:'14px 16px',background:'#ffb627',border:0,borderRadius:8,fontWeight:800,color:'#06080b',cursor:'pointer'},estado:{minHeight:20,color:'#ffcb61'}};
