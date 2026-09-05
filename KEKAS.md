# KEKAS — Guía de incorporación al equipo

> Para quien acaba de entrar al proyecto **DowntimeOS** y necesita saber, en una
> sola lectura: dónde estamos, qué hace cada pieza, dónde encaja la IA que
> todavía no existe, y con qué herramientas se trabaja.
>
> Léelo completo antes de tocar código. Después, `HANDOFF.md` tiene el detalle
> técnico y los invariantes que no se deben romper.

---

## 1. Qué es DowntimeOS en una frase

Un Micro-SaaS B2B para PyMEs industriales que **convierte los paros de máquina
en pérdida financiera auditable** (`$/minuto`), sin cablear nada, sin tocar los
PLCs y desplegándose en menos de 48 horas sobre tabletas comerciales.

La tesis comercial es que el software no compite con un MES: compite con la
bitácora de papel. No promete transformación digital, promete un número que hoy
la planta no tiene.

---

## 2. Dónde estamos hoy

El repositorio contiene **dos entregables funcionales y verificados**:

| Entregable | Qué es | Estado |
| :--- | :--- | :--- |
| **Landing pública** (`public/`) | Página de conversión con calculadora de margen oculto, captura de leads y reporte en PDF | Completa |
| **Demo multi-rol** (`public/demo/`) | Simulación navegable de la planta DowntimeCO con tres perfiles y separación real de vistas | Completa |

Y **dos implementaciones del backend** que exponen el mismo contrato de API, así
que `public/` funciona igual con cualquiera de las dos:

| Backend | Stack | Para qué |
| :--- | :--- | :--- |
| Producción | Node + Serverless Functions de Vercel + Supabase | Deploy público |
| Prototipo local | Python (solo librería estándar) + `data/leads.json` | Demostrar sin internet, con un comando |

### Lo que NO existe todavía

- **Aplicación real de planta.** La demo es una maqueta: los datos son
  simulados y viven en `localStorage`. No hay captura real ni base de eventos.
- **Autenticación.** El acceso de la demo es una redirección de JavaScript con
  las contraseñas en claro. Ver §6.
- **IA.** Hay un contenedor listo y una redacción simulada. Ver §5.
- **Telemetría IoT.** El plan Enterprise la ofrece en el copy; no hay firmware
  ni ingesta de sensores.
- **WhatsApp Cloud API.** Las notificaciones son `alert()` de demostración.

---

## 3. Arquitectura en tres capas

```
CAPA 1 · PRESENTACIÓN          CAPA 2 · API              CAPA 3 · PERSISTENCIA
public/                        api/ + lib/               Supabase (Postgres)
  index.html   landing           /api/health               tabla public.leads
  demo/        simulación        /api/config               vista leads_stats
                                 /api/leads    (GET/POST)
                                 /api/leads/stats
                               server/ (espejo Python)   data/leads.json
```

**Regla que no se rompe:** el cliente nunca decide una cifra financiera. El
`POST /api/leads` revalida los campos y **recalcula toda la aritmética** con
`lib/calculo.js` antes de guardar. Lo que el navegador calcula es solo para que
la calculadora responda al instante sin red.

---

## 4. Árbol de carpetas

```text
├── public/                     CAPA 1 · todo lo que ve el visitante
│   ├── index.html                Landing: 9 secciones + 2 modales
│   ├── css/styles.css            Sistema visual (tokens del PRD + componentes)
│   ├── js/
│   │   ├── calculator.js         Fórmula y formato monetario. SIN acceso al DOM
│   │   └── app.js                Ticker, estado de UI, fetch, validación, PDF
│   └── demo/                   Demo multi-rol de la planta DowntimeCO
│       ├── index.html            Acceso: tres perfiles (AH · AG · HH)
│       ├── direccion.html        Vista de Dirección y Finanzas
│       ├── operaciones.html      Vista de Operaciones y Mantenimiento
│       ├── operador.html         Tableta de piso
│       ├── css/demo.css          Shell de aplicación (hereda los tokens)
│       └── js/
│           ├── datos.js          ★ FUENTE ÚNICA DE VERDAD de la simulación
│           ├── usuarios.js       Tabla de usuarios, roles y permisos
│           ├── sesion.js         Sesión simulada, guarda de rol, barra superior
│           ├── retroactivo.js    Modal de captura retroactiva (compartido)
│           ├── direccion.js      Gráficas, acordeones, resumen IA, reporte PDF
│           ├── operaciones.js    Bandeja, tablero por línea, panel de captura
│           └── operador.js       Flujo de 3 pasos y log de sesión
│
├── api/                        CAPA 2 · Serverless Functions de Vercel
│   ├── health.js                 Estado del servicio y latencia a Postgres
│   ├── config.js                 Constantes del modelo y límites de inputs
│   └── leads/
│       ├── index.js              GET lista · POST alta (valida → recalcula → guarda)
│       └── stats.js              Agregados para los contadores del hero
│
├── lib/                        CAPA 2 · lógica de negocio, sin HTTP
│   ├── calculo.js                ★ AUTORIDAD de la fórmula financiera
│   ├── validacion.js             Reglas de campo y regla B2B de dominios
│   ├── repositorio.js            Acceso a Supabase (único que habla con la BD)
│   ├── supabase.js               Cliente configurado
│   ├── entorno.js                Lectura y validación de variables de entorno
│   └── http.js                   Ruteo, parseo de cuerpo y respuestas JSON
│
├── server/                     CAPA 2 · espejo en Python, para demo offline
│   ├── main.py                   Servidor HTTP, ruteo, estáticos, CLI
│   ├── calculo.py                Espejo de lib/calculo.js
│   ├── validacion.py             Espejo de lib/validacion.js
│   ├── store.py                  Escritura atómica del JSON
│   └── seed_data.py              Roster de las 30 semillas
│
├── supabase/                   CAPA 3
│   ├── schema.sql                Instalación nueva: tabla, constraints, vista, RLS
│   ├── seed.sql                  Semilla idempotente
│   └── migraciones/              Cambios sobre una base YA poblada
│
├── data/leads.json             CAPA 3 del prototipo local
├── test/                       node --test, sin dependencias
├── docs/                       Copy aprobado de las secciones críticas
├── README.md                   Cómo correrlo
├── HANDOFF.md                  Detalle técnico e invariantes
└── KEKAS.md                    Este archivo
```

Los dos archivos marcados con ★ son los que concentran las decisiones. Si vas a
cambiar algo de fondo, empieza leyéndolos.

---

## 5. Dónde va la IA

Hoy **no hay ningún modelo conectado**. Lo que existe es el hueco, ya dibujado y
alimentado con datos reales del tablero, para que enchufar el modelo sea cambiar
el origen del texto y no rediseñar la pantalla.

### 5.1 Lo que ya está construido

En la vista de Dirección (`public/demo/direccion.html`) hay una tarjeta con:

- Insignia `✨ AI Plant Intelligence Summary (GPT-4o / Claude API Ready)`
- Un párrafo redactado en el cliente por `redactarResumen()` en
  `public/demo/js/direccion.js`
- Un botón **Regenerar análisis con IA** que rota entre tres redacciones

**El texto se compone con las mismas cifras que muestra el tablero**, así que no
puede contradecirlo. Esa es la propiedad que hay que conservar cuando entre el
modelo de verdad.

### 5.2 Los dos reportes que faltan

La IA tiene dos consumidores distintos, con horizontes y verbos distintos. No es
el mismo reporte con otro formato:

#### Reporte A · Supervisor de piso — **estatus actual**

- **Horizonte:** el turno en curso. Minutos, no meses.
- **Pregunta que responde:** ¿qué está mal *ahora* y a qué le entro primero?
- **Entrada:** estado vivo de los activos, solicitudes de paro abiertas con su
  cronómetro corriendo, MTTR del turno, cuál de los cuellos de botella está
  detenido.
- **Salida esperada:** dos o tres frases accionables.
  *«C-01 lleva 74 min detenida y arrastra a las otras siete estaciones de L-01.
  Es el tercer paro por herramental en nueve días: revisa el stock de discos
  antes de cerrar el turno.»*
- **Dónde va:** vista de Operaciones (`operaciones.html`), encima de la bandeja
  de solicitudes.
- **Frecuencia:** en cada refresco del tablero, o al abrir un paro nuevo.

#### Reporte B · Finanzas y Dirección — **estatus general y acciones**

- **Horizonte:** el rango que elija en el filtro de fecha y turno.
- **Pregunta que responde:** ¿dónde se está yendo el margen y qué decisión lo
  detiene?
- **Entrada:** Pareto de causas, costo por activo, comparativo por línea y por
  turno, recuperable proyectado al 20 % de MTTR.
- **Salida esperada:** un párrafo de diagnóstico **y una lista corta de acciones
  con su valor esperado en pesos**, que es lo que hoy no genera la versión
  simulada.
  *«Concentración: 4 causas explican el 89 %. Acción 1: stock preventivo de
  discos para C-01 (impacto estimado $158,000 al periodo). Acción 2: SMED en
  M-01/M-02 ($33,396).»*
- **Dónde va:** vista de Dirección, en la tarjeta que ya existe, y en el reporte
  ejecutivo imprimible.
- **Frecuencia:** bajo demanda, con el botón de regenerar.

### 5.3 Cómo conectarlo sin romper lo que funciona

1. **El modelo nunca calcula cifras.** Recibe los agregados ya calculados por
   `datos.js` y solo redacta. Si el modelo aritmetiza, el tablero y el texto se
   contradicen tarde o temprano, y el texto es el que la gente lee.
2. **La llamada va del lado del servidor**, en una Serverless Function nueva
   (p. ej. `api/resumen.js`). La llave de la API de Anthropic o de OpenAI no
   puede vivir en `public/`, igual que la `service_role` de Supabase.
3. **El punto de enganche ya está aislado:** `redactarResumen()` en
   `direccion.js`. Cambia su cuerpo por un `fetch` a esa función y el resto de
   la vista no se entera.
4. **Deja siempre un texto de respaldo.** Si el modelo tarda o falla, la tarjeta
   debe caer a la redacción local, no quedarse vacía: es una pantalla de
   dirección, no un widget.

---

## 6. Advertencia sobre la seguridad de la demo

La demo **no tiene autenticación** y no debe presentarse como si la tuviera.

- Los tres usuarios y la contraseña (`demo1234`) están en
  `public/demo/js/usuarios.js`, que el navegador descarga en claro.
- La separación entre vistas es un `location.replace()` del lado del cliente.
  Cualquiera se la salta con las herramientas de desarrollo.

Sirve para **enseñar cómo se comporta** el producto con perfiles diferenciados.
Cuando esto pase a producto, `sesion.js` y `usuarios.js` **se reemplazan** por
Supabase Auth con políticas de fila: no se les añaden capas de cliente. Un
candado de navegador al que se le van poniendo parches termina pareciendo seguro
sin serlo, que es peor que la maqueta honesta que hay hoy.

La pantalla de acceso lo dice explícitamente y las tres vistas llevan el badge
«Datos simulados». **Si alguna vez quitas esa advertencia, la demo pasa a ser
una maqueta que finge seguridad.**

---

## 7. Inventario de tecnologías, APIs y herramientas

### 7.1 Lo que se usa hoy

| Categoría | Herramienta | Versión / nota | Dónde |
| :--- | :--- | :--- | :--- |
| Runtime | Node.js | 22.x (`engines` en `package.json`) | API de producción |
| Runtime | Python | 3.8+, solo librería estándar | Prototipo local |
| Hosting | Vercel | CLI 59.x, deploy por `npm run deploy` | `vercel.json` |
| Base de datos | Supabase (PostgreSQL) | `@supabase/supabase-js` ^2.45 | `lib/supabase.js` |
| Frontend | HTML + CSS + JavaScript ES5 | Sin build, sin framework | `public/` |
| CSS utilitario | Tailwind vía CDN | `preflight` desactivado | `public/index.html` |
| Tipografías | Inter + JetBrains Mono | Google Fonts | Todas las páginas |
| Pruebas | `node --test` | Nativo, cero dependencias | `test/` |
| Variables | dotenv | ^16.4 | `lib/entorno.js` |
| Gráficas | Ninguna | SVG y CSS a mano | `direccion.js` |
| PDF | Ninguna | `window.print()` sobre un documento generado | `app.js`, `direccion.js` |

**Por qué no hay framework ni build:** la demo tiene que abrirse con un solo
comando, sin red y sin `npm install`, porque se presenta en vivo. Cada
dependencia que se añada hay que justificarla contra esa restricción.

### 7.2 APIs propias

| Método | Ruta | Qué hace |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Estado del servicio, uptime, latencia a Postgres |
| `GET` | `/api/config` | Constantes del modelo y límites de los inputs |
| `GET` | `/api/leads` | Lista de leads. Filtros: `?estatus=&limite=&desde=` |
| `GET` | `/api/leads/stats` | Agregados para los contadores del hero |
| `POST` | `/api/leads` | Alta: valida → **recalcula** → persiste. `201` o `400` con mapa de errores |

### 7.3 APIs de terceros

| Servicio | Estado | Notas |
| :--- | :--- | :--- |
| Supabase REST | **En uso** | Vía `supabase-js`. La `service_role` key omite RLS: solo servidor |
| Google Fonts | **En uso** | Inter y JetBrains Mono |
| Tailwind CDN | **En uso** | Advierte en consola que no es para producción; migrar si crece |
| Anthropic / OpenAI | **Pendiente** | Ver §5. Va del lado del servidor |
| WhatsApp Cloud API (Meta) | **Pendiente** | Hoy son `alert()` de demostración |
| Telemetría IoT | **Pendiente** | Clamps de corriente y acelerómetros del plan Enterprise |

### 7.4 Comandos que vas a usar

```bash
python server/main.py        # demo local completa en :3000, sin dependencias
npm test                     # 23 pruebas del motor de cálculo y validación
npm run dev                  # vercel dev, contra Supabase real
npm run deploy               # despliegue a producción
```

Banderas útiles del servidor local: `--port 4000`, `--no-browser`, `--reseed`.

---

## 8. Las cinco cosas que romperías sin querer

1. **El factor de recuperación (0.20) vive en CUATRO lugares**, y el cuarto es
   una restricción de Postgres. Cambiarlo solo en los motores hace que la base
   rechace cada alta de lead en producción con la landing viéndose bien.
   Detalle en `HANDOFF.md` §7.
2. **La fórmula está espejada** en `lib/calculo.js`, `server/calculo.py` y
   `public/js/calculator.js`. Si tocas una, toca las tres.
3. **`operador.js` no puede mostrar dinero.** No importa formateadores de moneda
   ni lee `tarifa`: no tiene forma de imprimir un peso aunque alguien lo
   intentara. Consérvalo así.
4. **Las cifras del showcase de la landing salen del dataset de la demo.** Si
   editas los eventos de `datos.js`, recalcula y actualiza el HTML, o las dos
   superficies empiezan a contar historias distintas.
5. **El cronómetro de un paro corre desde que el operador lo reporta**, no desde
   que Mantenimiento lo valida. Si alguna vez lo «arreglas» para que espere a la
   validación, la planta deja de medir justo los paros peor atendidos.

---

## 9. Por dónde empezar tu primera semana

1. Corre `python server/main.py` y recorre la demo con los tres perfiles.
2. Lee `public/demo/js/datos.js` completo. Es el modelo mental del producto.
3. Lee `lib/calculo.js` y corre `npm test`.
4. Lee `HANDOFF.md` §7 (modelo de cálculo) y §15 (demo).
5. Elige una de las tres tareas abiertas: el reporte A de la IA, la migración de
   Tailwind CDN a build, o la autenticación real con Supabase Auth.
