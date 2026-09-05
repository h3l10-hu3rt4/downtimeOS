# HANDOFF TÉCNICO — Prototipo DowntimeOS

> Documento de traspaso para otro agente/desarrollador que continúe este proyecto.
> Describe **qué está construido, cómo está construido, qué invariantes no se
> deben romper y qué sigue**. Fecha de corte: 2026-09-04.

---

## 1. Contexto

Prototipo funcional de la **Landing Page + Lead Magnet de DowntimeOS**, un
Micro-SaaS B2B que traduce paros de máquina en pérdida monetaria en tiempo real
(`$/minuto`). Es un entregable académico (Ideación y Prototipado, TEC) que debe
**correr 100% local** y demostrarse en vivo ante un profesor.

Documentos fuente (fuera de este repo, en OneDrive del autor):
`prd.md` (PRD de la landing, normativo), `downtimeOS.md` (producto),
`branding.md` (posicionamiento), `prompt prd.md` (instrucciones de construcción).

**Estado: completo y verificado end-to-end.** No hay trabajo a medias.

> 🚚 **DOS IMPLEMENTACIONES.** Las secciones 2 a 13 describen el prototipo local
> (Python), que sigue siendo la referencia ejecutable sin internet. Los artefactos
> de producción (Node + Supabase + Vercel) están en la **§14**. Lee la §14 antes
> de tocar nada relacionado con el deploy.

> 📌 **Trabajo sin mergear.** El PRD de la landing v1.0.0, las correcciones de
> copy y la demo por rol viven en la rama `feat/landing-prd-v1`. `main` —y por
> tanto lo desplegado en Vercel— sigue con la landing anterior. Lo que cambió:
>
> | Fecha | Cambio | Dónde |
> | :--- | :--- | :--- |
> | 2026-09-03 | Landing reconstruida según el PRD v1.0.0 | `public/`, §7 |
> | 2026-09-03 | Los minutos de paro se declaran por turno **y** por máquina | los tres motores, §7 |
> | 2026-09-04 | Demo navegable de DowntimeCO con vistas por rol | `public/demo/`, **§15** |
> | 2026-09-04 | Retorno unificado en 20% de MTTR (antes 35% y 15%) | §7 + **migración SQL** |
> | 2026-09-04 | Zero-Hardware en planes base, telemetría opcional en Enterprise | `public/index.html` |

---

## 2. Restricciones del entorno (importante)

> Aplican a la **ejecución local** del prototipo Python. La rama de migración
> (§14) sí usa Node, pero se ejecuta en Vercel, no en esta máquina.

| Restricción | Detalle |
| :--- | :--- |
| **No hay Node.js** | `node` y `npm` NO existen en la máquina. No propongas Next.js, Vite, Tailwind CLI ni nada que requiera `npm install`. |
| **Python 3.11.9** | Es el único runtime disponible. Se invoca como `python`. |
| **Solo librería estándar** | No hay Flask ni FastAPI instalados (`uvicorn` sí, pero no se usa). El servidor es `http.server`. **No agregues dependencias sin avisar al usuario.** |
| **Windows 11** | Shell principal PowerShell 5.1; también hay Git Bash. Rutas con espacios. |
| Proceso | El servidor aparece en el task manager como `python3.11.exe`, no como `python.exe`. |

---

## 3. Arranque

```bash
python server/main.py
```

Siembra `data/leads.json` si falta, sirve en `http://localhost:3000` y abre el
navegador. Banderas: `--port N`, `--host`, `--no-browser`, `--reseed`
(regenera las 30 semillas y descarta lo capturado).

Equivalentes: `run.bat` (Windows), `./run.sh` (Unix). `requirements.txt` existe
solo para documentar que no hay dependencias.

---

## 4. Mapa de archivos

```text
├── data/
│   └── leads.json          Capa 3. Estructura {meta:{...}, leads:[...]}
├── public/                 Capa 1 (servida estáticamente por main.py)
│   ├── index.html          Landing completa: 8 secciones + 2 modales
│   ├── css/styles.css      Sistema visual completo (tokens del PRD + componentes)
│   ├── js/
│   │   ├── calculator.js   Math + formateo. SIN acceso al DOM. window.DowntimeCalc
│   │   └── app.js          Ticker, estado UI, fetch, validación cliente, reporte
│   └── demo/               Demo navegable de DowntimeCO (§15)
│       ├── index.html      Acceso simulado con tres cuentas
│       ├── direccion.html  operaciones.html  operador.html
│       ├── css/demo.css    Shell de aplicación (hereda los tokens de styles.css)
│       └── js/
│           ├── datos.js    FUENTE ÚNICA de la planta simulada
│           ├── sesion.js   Cuentas, permisos por rol y guarda de página
│           └── direccion.js  operaciones.js  operador.js
├── server/                 Capa 2
│   ├── main.py             HTTP handler, ruteo, CORS, estáticos, CLI
│   ├── calculo.py          AUTORIDAD de la fórmula y de los límites
│   ├── validacion.py       Reglas de campo + regla B2B. Lanza ErrorValidacion
│   ├── store.py            I/O atómico del JSON, seeding, lock, stats
│   └── seed_data.py        ROSTER de 30 tuplas + construir_semilla()
├── docs/
│   └── copy-calculadora-y-precios.md   Copy aprobado de las secciones críticas
├── supabase/
│   ├── schema.sql          Instalación nueva
│   ├── seed.sql            Semilla (cifras del modelo anterior, ver §7)
│   └── migraciones/        Cambios sobre una base ya poblada
├── README.md               Documentación de usuario
├── HANDOFF.md              Este archivo
├── requirements.txt / run.bat / run.sh
```

Responsabilidades, para no mezclar capas:

- `calculator.js` **no toca el DOM**; `app.js` no contiene fórmulas.
- `main.py` no contiene reglas de negocio: delega en `calculo`/`validacion`/`store`.
- `store.py` es el único módulo que abre archivos.
- El frontend **nunca** lee `data/leads.json`; solo habla HTTP.
- La demo (`public/demo/`) **no llama a la API**: vive en `localStorage`. No puede
  ensuciar Supabase ni `leads.json` por diseño.

---

## 5. Contrato de datos (`data/leads.json`)

```jsonc
{
  "meta": { "proyecto": "...", "version_esquema": "1.0", "actualizado": "ISO-Z", "total": 30 },
  "leads": [ /* ver esquema abajo */ ]
}
```

Esquema de un lead (idéntico para semillas y para capturas nuevas):

| Campo | Tipo | Origen |
| :--- | :--- | :--- |
| `id` | `"LEAD-2026-0001"` | Asignado por `store._siguiente_id()` |
| `nombre`, `puesto`, `empresa`, `sector` | string | Formulario (saneado) |
| `email`, `telefono` | string | Formulario (normalizado: correo a minúsculas, teléfono a 10 dígitos) |
| `ciudad`, `parque_industrial` | string | Formulario |
| `maquinas`, `turnos` | int | Formulario / calculadora |
| `horas_operacion_dia` | int | Derivado: `turnos × 8` |
| `tarifa_hora`, `minutos_paro_dia` | float | Formulario / calculadora |
| `divisa` | `"MXN" \| "USD"` | Switch de la calculadora |
| `perdida_diaria`, `perdida_mensual`, `perdida_anual`, `ahorro_proyectado` | float | **Recalculados en servidor** |
| `perdida_anual_mxn` | float | Normalizado a MXN para comparar leads entre divisas |
| `costo_por_minuto` | float | `tarifa_hora × maquinas / 60` |
| `origen` | `"CALCULADORA" \| "AUDITORIA"` | Atributo `data-origen` del `<form>` |
| `estatus` | `"NUEVO" \| "AUDITORIA_SOLICITADA"` | Derivado de `origen` |
| `utm` | objeto `{utm_source, utm_medium, utm_campaign}` | Query string de la landing |
| `notas` | string | Opcional |
| `created_at` | ISO-8601 UTC con `Z` | Asignado por `store.agregar_lead()` |

---

## 6. API (Capa 2)

| Método | Ruta | Notas |
| :--- | :--- | :--- |
| `GET` | `/api/health` | `ok`, uptime, ruta del archivo, stats. Responde `503` si la persistencia falla. |
| `GET` | `/api/leads` | Query opcional `?estatus=NUEVO&limite=10`. Orden: `created_at` descendente. |
| `GET` | `/api/leads/stats` | `total`, `por_estatus`, `perdida_anual_agregada_mxn`, `perdida_anual_promedio_mxn`, `maquinas_totales`. |
| `GET` | `/api/config` | Constantes del modelo y límites. Útil si el frontend deja de hardcodearlos. |
| `POST` | `/api/leads` | `201` + `{ok, mensaje, lead}` · `400` + `{ok:false, error, errores:{campo:mensaje}}` |

CORS abierto (`*`) a propósito, por ser prototipo local. Body máximo 64 KB.
Todo texto sale con `charset=utf-8` (ver `DowntimeHandler.guess_type`).

**Regla no negociable:** `POST /api/leads` ignora las cifras financieras que
manda el cliente y las **recalcula** con `calculo.calcular()`. Un frontend
manipulado no puede inyectar montos falsos. Si agregas campos derivados, hazlo
del lado del servidor.

---

## 7. Modelo de cálculo

```text
Minutos_Paro_Día  = Máquinas × Turnos × Minutos_Paro_Turno
Pérdida_Diaria    = (Minutos_Paro_Día / 60) × Tarifa_Horaria
Pérdida_Mensual   = Pérdida_Diaria × 25 días operativos
Pérdida_Anual     = Pérdida_Mensual × 12 meses      (= 300 días hábiles)
Ahorro_Proyectado = Pérdida_Anual × 0.20            (reducción de MTTR)
```

Constantes: `DIAS_OPERATIVOS=25`, `MESES=12`, `DIAS_HABILES_ANIO=300`,
`FACTOR_MITIGACION=0.20`, `TIPO_CAMBIO_USD=17.50`, `HORAS_POR_TURNO=8`.

Dos decisiones que conviene entender antes de tocar nada:

**Los minutos son por turno y por máquina.** Tres turnos triplican la exposición
diaria del mismo activo. Los leads capturados antes del 2026-09-03 se calcularon
sin ese multiplicador: tienen la misma tarifa y minutos pero una pérdida anual
menor, y no son comparables sin corregirlos.

**El horizonte anual se conserva en dos escalones.** El copy habla de "300 días
hábiles", pero el código sigue haciendo 25 × 12 porque el esquema de Postgres
valida la invariante `perdida_anual = perdida_mensual × 12`. Colapsarlo en una
sola multiplicación rompería esa restricción.

### El factor de recuperación es 0.20 y está en CUATRO lugares

DowntimeOS acorta la **detección y el despacho** de la brigada, no la reparación
física. Por eso se proyecta el extremo conservador. Una versión anterior sostenía
a la vez un 35% y un 15% sin fundamento; se unificaron el 2026-09-04.

> ⚠️ **El cuarto espejo es una restricción de la base, y es el que rompe
> producción.** `leads_ahorro_coherente` en `supabase/schema.sql` lleva el factor
> escrito dentro. Si cambias los tres motores y no migras la restricción, la base
> rechaza **cada** `POST /api/leads` mientras la landing se ve perfectamente bien.
> El ejemplo resuelto está en `supabase/migraciones/2026-09-04-factor-mttr-20.sql`.

### Invariante crítico: los espejos

La fórmula, los límites y la lista de dominios genéricos viven **duplicados** a
propósito (servidor = autoridad, cliente = reactividad instantánea sin red).
Si tocas uno, toca todos:

| Concepto | Producción | Prototipo local | Cliente |
| :--- | :--- | :--- | :--- |
| Fórmula y constantes | `lib/calculo.js` | `server/calculo.py` | `public/js/calculator.js` (`MODELO`) |
| Límites por divisa | `lib/calculo.js` | `calculo.LIMITES_TARIFA` | `calculator.js` (`LIMITES_TARIFA`) |
| Dominios B2B rechazados | `lib/validacion.js` | `validacion.DOMINIOS_GENERICOS` | `app.js` (`DOMINIOS_GENERICOS`) |
| Normalización de teléfono | `lib/validacion.js` | `validacion.normalizar_telefono` | `app.js` (`normalizarTelefono`) |
| **Factor de recuperación** | los tres de arriba | | **+ `supabase/schema.sql`** |

Alternativa futura: que `app.js` consuma `GET /api/config` al arrancar y elimine
la duplicación de constantes. No se hizo para que la landing siga calculando
aunque la API esté caída.

### Desglose mano de obra / margen (solo cliente)

El panel de resultados separa la mano de obra absorbida del margen de contribución
no generado. La proporción sale del benchmark seleccionado —cada preset de
`calculator.js` trae su `manoObra` por divisa— y cae a 0.35 si la tarifa se capturó
a mano. **Vive solo en el navegador**: no es una columna de Postgres, así que el
reporte PDF la reconstruye aplicando la proporción a la cifra que devolvió el
servidor, que sigue siendo la autoridad.

---

## 8. Reglas de validación (RF-03)

Implementadas en `server/validacion.py`, espejadas en `app.js`:

- `nombre` ≥ 3 caracteres; `empresa` ≥ 2; ambos obligatorios.
- `email`: formato válido **y regla B2B** — se rechazan 24 dominios públicos
  (`gmail`, `hotmail`, `outlook`, `yahoo`, `icloud`, `proton`…). Desactivable
  con `REGLA_B2B_ACTIVA = False`.
- `telefono`: 10 dígitos tras normalizar; tolera espacios, guiones, paréntesis
  y lada `+52` / `+52 1`.
- `ciudad`: obligatoria solo si `origen == "AUDITORIA"`.
- Saneamiento: se eliminan nulos, se colapsan espacios y se truncan cadenas
  (160 caracteres; 500 para `notas`).

Los errores se devuelven como mapa `campo → mensaje` y `app.js` los pinta bajo
cada input (`.err.is-visible` + `.input.is-error`).

---

## 9. Decisiones de diseño (y por qué)

1. **Tailwind por CDN con `corePlugins.preflight = false`.** El PRD exige
   Tailwind, pero su preflight resetea `h1…h6` a `font-size: inherit` y, al
   inyectarse en runtime *después* de `styles.css`, ganaba la cascada y
   destruía la tipografía. Con preflight apagado, la identidad visual vive
   íntegra en `styles.css` y la página se ve igual aunque el CDN no cargue.
2. **Escritura atómica.** `store._escribir_atomico()`: temporal en el mismo
   directorio → `flush` + `fsync` → `os.replace()`. Todo bajo `threading.RLock`
   porque el servidor es `ThreadingHTTPServer`. Un corte a media escritura no
   trunca el JSON. Si el archivo llega corrupto, se respalda como
   `leads.corrupto-<timestamp>.json` y se re-siembra.
3. **Límites de tarifa por divisa** (`MXN 100–200,000`, `USD 5–12,000`). Un piso
   único pensado en pesos mutilaba cualquier tarifa en dólares. Además, USD
   conserva 2 decimales para que el ida y vuelta MXN → USD → MXN sea exacto.
4. **Semillas derivadas, no hardcodeadas.** `seed_data.ROSTER` contiene solo los
   datos cualitativos (empresa, rol, ciudad, máquinas, turnos, tarifa, minutos);
   las cifras financieras las produce `calculo.calcular()`. Imposible que la
   semilla y la API se contradigan.
5. **Ticker con `requestAnimationFrame`**, con guarda `delta < 2s` para que al
   volver de una pestaña oculta no dé un salto absurdo (RF-01: 60fps sin
   bloquear el hilo principal).

---

## 10. Estado de verificación

Probado en vivo contra el servidor corriendo, no solo por inspección:

- `GET /api/health` → `ok:true`, 30 leads, 15 `NUEVO` / 15 `AUDITORIA_SOLICITADA`.
- `POST` válido → `201` con folio, timestamp y estatus correctos.
- `POST` inválido (gmail + campos vacíos) → `400` con los 4 errores esperados.
- Valores por defecto en la UI (5 activos × 2 turnos × 25 min × $1,200 MXN) →
  fuga anual `$1,500,000 MXN`, recuperación `$300,000 MXN` (factor 0.20 exacto
  confirmado contra la API), desglose `$525,000` de mano de obra y `$975,000`
  de margen.
- Switch de divisa: 1500 MXN → 85.71 USD → 1500 MXN (ida y vuelta exacto).
- Modal lead magnet completo: rechazo B2B → correo corporativo → lead guardado
  → reporte generado.
- Formulario de auditoría con `+52 844 123 4567` y 34 equipos → el valor del
  formulario pisa el de la calculadora, estatus `AUDITORIA_SOLICITADA`.
- Layout sin desbordamiento horizontal en 375 / 768 / 1024 / 1440 px; CLS 0 y
  recálculo completo de la calculadora en 0.19 ms por evento.
- Demo por rol: el operador registra un paro de 74 min sin ver una sola cifra de
  dinero; el mismo evento aparece en la bitácora de dirección a `$24,358 MXN`.
  Escribir a mano la URL de dirección con sesión de operador redirige de vuelta.
- `0` errores de consola.

**La versión Python no tiene suite de pruebas automatizada.** La versión Node
migrada sí: `test/calculo.test.js` y `test/validacion.test.js` (ver §14).

---

## 11. Fuera de alcance (sustituciones conscientes)

| PRD pide | Aquí hay | Punto de extensión |
| :--- | :--- | :--- |
| PDF en cliente (RF-06) | Ventana con reporte formateado + `window.print()` (*Guardar como PDF*) | `generarReporte()` en `app.js` |
| Video demo (RF-05) | Modal con placeholder y desglose del guion | `#modalVideo` en `index.html` |
| Webhook a CRM / HubSpot | El `POST` termina en el JSON local | `_crear_lead()` en `main.py` |
| WhatsApp Cloud API | No implementado | mismo punto |
| PostHog / GTM | Eventos a `window.dataLayer` + consola | `track()` en `app.js` |
| Next.js / Astro + Vercel | HTML estático + `http.server` | — (bloqueado: no hay Node) |

Eventos de telemetría ya emitidos: `view_landing_page`, `hero_ticker_interacted`,
`calculator_slider_changed` (debounce 300 ms), `calculator_preset_selected`,
`currency_switched`, `calculator_pdf_gate_open`, `calculator_pdf_requested`,
`role_tab_switched`, `pricing_pilot_clicked`, `request_audit_click`,
`request_audit_submit`, `scroll_milestone`, `video_modal_open`. La tabla
completa con sus parámetros está en el README.

---

## 12. Próximos pasos sugeridos (priorizados)

1. ~~**Pruebas automatizadas**~~ — hecho para la rama Node (§14). Si se sigue
   manteniendo la versión Python, replicar los mismos vectores con `unittest`
   de stdlib.
2. **Panel de leads** (`public/leads.html`) que consuma `GET /api/leads` y los
   muestre en tabla con filtro por estatus. Vuelve la demo mucho más vendible
   que enseñar JSON crudo.
3. **Trampa de foco en los modales.** Hoy se enfoca el primer input y `Escape`
   cierra, pero `Tab` puede salirse del modal. Accesibilidad incompleta.
4. **Eliminar la duplicación de constantes** haciendo que `app.js` hidrate desde
   `GET /api/config`, con los valores actuales como respaldo si la API falla.
5. **Paginación / `offset`** en `GET /api/leads` si la base crece.
6. **Exportar a CSV** (`GET /api/leads.csv`) para el equipo comercial.
7. **Migrar a SQLite** solo si se requiere concurrencia real o multiusuario; el
   JSON es adecuado para el alcance actual y es parte del entregable.

⚠️ **`http.server` es un servidor de desarrollo.** No lo expongas a internet.
Para producción, el PRD contempla Next.js/Astro en Vercel — lo que exigiría un
entorno con Node.

---

## 13. Convenciones del código

- **Idioma:** identificadores, funciones y comentarios en español. Los
  identificadores y comentarios van **sin acentos** (evita problemas de
  codificación); las cadenas visibles al usuario **sí llevan acentos**.
- Sin framework, sin build, sin transpilación. JS en ES5+ con `var`, envuelto en
  IIFE. CSS con custom properties en `:root` y clases tipo BEM (`.bloque__elemento`).
- Cada módulo Python arranca con un docstring que explica su rol en la capa.
- Al editar Python: **reinicia el servidor** (no hay autoreload).
  Al editar JS/CSS: recarga forzada del navegador (los estáticos van con
  `Cache-Control: no-cache`, pero el navegador a veces insiste).

---

## 14. Migración a Vercel + Supabase + Node.js

`public/` **no se tocó**: sigue byte por byte igual que en la versión local. La
API nueva respeta el mismo contrato de URLs y de JSON, así que la landing
funciona en Vercel sin un solo cambio en el frontend.

### 14.1 Artefactos nuevos

```text
├── api/                      Serverless Functions (reemplazan server/main.py)
│   ├── health.js               GET  /api/health
│   ├── config.js               GET  /api/config
│   └── leads/
│       ├── index.js            GET/POST /api/leads
│       └── stats.js            GET  /api/leads/stats
├── lib/
│   ├── calculo.js            ← puerto 1:1 de server/calculo.py
│   ├── validacion.js         ← puerto 1:1 de server/validacion.py
│   ├── repositorio.js        ← reemplaza server/store.py (Supabase)
│   ├── supabase.js             Cliente con service_role (solo servidor)
│   └── http.js                 CORS, JSON, wrapper `ruta()` con manejo de errores
├── supabase/
│   ├── schema.sql              Tabla `leads`, constraints, índices, vista, RLS
│   └── seed.sql                31 registros migrados desde data/leads.json
├── test/                     node --test (sin dependencias)
├── package.json  vercel.json  .env.example  .gitignore
```

`server/` y `data/leads.json` **se conservan**: son el prototipo demostrable sin
internet y la fuente de la semilla. No los borres hasta que el deploy esté
validado.

### 14.2 Correspondencia de capas

| Local (Python) | Migrado (Node/Vercel) |
| :--- | :--- |
| `main.py` ruteo + estáticos | `api/**` + `outputDirectory: public` en `vercel.json` |
| `calculo.py` | `lib/calculo.js` |
| `validacion.py` | `lib/validacion.js` |
| `store.py` (JSON atómico) | `lib/repositorio.js` + Postgres |
| `store._siguiente_id()` | `DEFAULT` con secuencia en la columna `folio` |
| `store.estadisticas()` | vista `public.leads_stats` |
| `_escribir_atomico()` + `RLock` | transacción de `INSERT` |

### 14.3 Decisiones que NO se deben deshacer

1. **`folio` se expone como `id`.** La PK real es un `uuid`, pero
   `lib/repositorio.js → aLeadPublico()` devuelve `id: folio` porque
   `public/js/app.js` imprime "Folio LEAD-2026-0031" en el reporte PDF. Si
   cambias el mapeo, rompes el frontend.
2. **`horas_operacion_dia` es `GENERATED ALWAYS`** en Postgres. Incluirla en un
   `INSERT` provoca el error `428C9`. `crearLead()` la elimina del payload a
   propósito.
3. **`perdida_anual_mxn` se persiste, no se deriva.** Congela el tipo de cambio
   vigente al capturar. Convertirla en columna generada ataría el histórico a un
   FX fijo.
4. **La lista de dominios B2B vive en código**, no en una tabla: cambia seguido
   y no vale un round-trip a la base por request.
5. **RLS habilitado sin políticas.** Las llaves `anon`/`authenticated` no pueden
   nada; la API usa `service_role`, que omite RLS. Si algún día insertas desde el
   navegador, pierdes la validación B2B y el recálculo de montos.
6. **Redondeo medio-arriba.** Python usa redondeo bancario; el puerto JS usa
   medio-arriba (convención contable). Diferencia de centavos solo en empates
   exactos, documentada en el encabezado de `lib/calculo.js`.

### 14.4 Estado y verificación

Los dos módulos portados se ejecutaron en un motor JS real y se compararon
campo por campo contra la salida de `server/calculo.py` y
`server/validacion.py`: **9 casos de cálculo + 5 de validación, 0 discrepancias**
(incluye acotado de rangos, decimales periódicos, divisa USD y los mapas de
error). `supabase/seed.sql` se auditó contra cada `CHECK` del esquema: los 31
registros pasan.

**Ejecutado en Node 24 + desplegado en Vercel (2026-09-01):**

- `npm test` → **21/21 en verde**, exit code 0.
- Proyecto Vercel: `try1`, equipo `team4-g101`. Producción:
  <https://try1-five-silk.vercel.app>
- Verificado en producción: `/` sirve la landing, `GET /api/config` → 200 con
  las constantes correctas, y `POST /api/leads` con datos inválidos → **400 con
  el mapa completo de errores por campo** (la regla B2B funciona en producción).

**Migración COMPLETA y verificada contra producción real:**

| Endpoint | Resultado |
| :--- | :--- |
| `GET /api/health` | 200 · `ok:true` · 31 leads · latencia a Postgres 87–312 ms |
| `GET /api/leads/stats` | 200 · 31 total · 15 `NUEVO` / 16 `AUDITORIA_SOLICITADA` |
| `GET /api/leads` | 200 · `folio` expuesto como `id` correctamente |
| `POST /api/leads` (válido) | **201** · folio nuevo · montos recalculados en servidor |
| `POST /api/leads` (inválido) | 400 · mapa de errores por campo · regla B2B activa |

Prueba end-to-end desde la landing desplegada: el formulario de auditoría
capturó un lead real y devolvió su folio, con las cifras recalculadas en el
servidor coincidiendo exactamente con las del navegador. Cero errores de consola.

> Esa verificación es del despliegue original (2026-09-01), anterior al cambio de
> fórmula. **Lo desplegado hoy en Vercel sigue siendo la landing previa al PRD**:
> el trabajo vive en la rama `feat/landing-prd-v1` y no se ha mergeado. Antes de
> desplegarla hay que ejecutar `supabase/migraciones/2026-09-04-factor-mttr-20.sql`
> (ver §7), o cada alta de lead será rechazada por la base. Los leads de prueba se borraron: la base quedó en los 31
de la semilla (la secuencia de folios va en 34, así que el próximo será
`LEAD-2026-0035` — es normal, las secuencias no se reciclan).

### 14.4.1 Trampas del despliegue (ya resueltas — no repetir)

1. **`requirements.txt` en la raíz hacía que Vercel detectara Python** y
   fallara con "No python entrypoint found". Se movió a `server/` y se agregó
   `.vercelignore`. Como el ajuste ya había quedado guardado en el proyecto,
   además hizo falta `"framework": null` en `vercel.json`.
2. **`"runtime": "nodejs20.x"` en `functions` es inválido**: esa clave es solo
   para runtimes de comunidad (`now-php@1.0.0`). Para Node, Vercel lo infiere y
   la versión sale de `engines.node` en package.json (ahora `22.x`).
3. **`vercel.json` rechaza claves de comentario** (`"// nota": "..."`).
4. **No canalices valores a `vercel env add` desde PowerShell**: antepone un BOM
   (U+FEFF) al valor. La variable se guarda corrupta y la función revienta con
   `Cannot convert argument to a ByteString ... value of 65279`. Usa bash con
   `printf '%s' 'valor' | npx vercel env add ...`.
5. **Los previews del equipo están tras Deployment Protection**: devuelven
   HTTP 200 con la página "Login – Vercel", no tu app. Verifica siempre contra
   el alias de producción.
6. El CLI fijado en `^37` no veía la sesión de `vercel login` (v59 guarda las
   credenciales en otra ruta). `package.json` ya apunta a `^59`.
7. `vercel link` no pudo conectar el repo de GitHub (falta dar acceso a la app
   de Vercel en ese repositorio), así que **no hay auto-deploy en cada push**;
   los despliegues son por CLI hasta que se conecte.

### 14.5 Pendientes (ya no bloquean nada)

1. **Conectar el repo de GitHub en Vercel** para tener auto-deploy en cada
   push. Hoy los despliegues son por CLI: `npx vercel deploy --prod --yes`.
2. **Renombrar el proyecto** en Vercel: se llama `try1` porque el CLI tomó el
   nombre de la carpeta.
3. **Rotar la `service_role` key** una última vez (las dos anteriores pasaron
   por un chat) y actualizarla solo en Vercel y en `.env.local`.
4. Decidir si `server/` se archiva o se conserva como demo offline. Hoy sigue
   siendo el único camino para demostrar el producto sin internet.
5. **Mergear `feat/landing-prd-v1`** y desplegar, ejecutando antes la migración
   de `supabase/migraciones/`. Mientras tanto, producción sirve la landing
   anterior al PRD.
6. Decidir qué hacer con las 31 semillas: se calcularon con el modelo anterior
   (sin turnos, factor 0.35) y arrastran el promedio que muestra el hero. La
   vista `leads_por_modelo` permite separarlas; regenerarlas es la otra opción.

### 14.6 Contrato con `public/`: un campo legacy

`public/js/app.js` pinta el badge del footer con `persistencia.archivo`, campo
que en la era JSON era la ruta del archivo. La API nueva devuelve `tabla`, así
que el badge mostraba **"API OK · undefined"**. Se agregó `archivo` como alias en
`api/health.js`. Si algún día se toca esa respuesta, ese campo no se puede quitar
sin romper el footer.

(`public/` dejó de ser intocable: se reescribió por completo el 2026-09-03 para
el PRD de la landing. El alias se conserva igual porque `app.js` sigue leyéndolo.)

---

## 15. Demo navegable de DowntimeCO (`public/demo/`)

Añadida el 2026-09-04. Convierte el "RBAC Visualizer" del PRD —que en la landing
son tres pestañas de HTML estático— en cuatro páginas con separación real de
vistas por rol. Se sirve igual desde `main.py` y desde Vercel; no necesita build.

### Cuentas

| Cuenta | Rol | Página | Ve montos | Ve tarifas | Exporta |
| :--- | :--- | :--- | :---: | :---: | :---: |
| `ceo@downtimeco.com` | `direccion` | `direccion.html` | Sí | **Sí** | Sí |
| `gerente@downtimeco.com` | `operaciones` | `operaciones.html` | Sí | No | No |
| `operador@downtimeco.com` | `operador` | `operador.html` | **No** | No | No |

Contraseña de las tres: `demo1234`.

### Esto NO es autenticación

Las cuentas y la contraseña están en `demo/js/sesion.js`, que el navegador
descarga en claro, y la guarda entre vistas es un `location.replace()`. Cualquiera
se lo salta con las herramientas de desarrollo.

**No intentes endurecerlo.** Sirve para enseñar *cómo se comporta* el producto con
perfiles diferenciados; cuando esto pase a producto, `sesion.js` se reemplaza por
Supabase Auth con políticas de fila, donde la decisión la toma el servidor. Un
candado de cliente al que se le añaden capas solo parece seguro.

La pantalla de acceso lo dice explícitamente y las tres vistas llevan el badge
"Demo · Datos simulados". Si alguna vez se quita esa advertencia, la demo pasa a
ser una maqueta que finge seguridad, que es exactamente el problema.

### Modelo de datos

`demo/js/datos.js` es la fuente única: ocho activos en cuatro etapas y 26 paros de
los últimos 30 días, fechados en relativo para que la demo siempre se vea reciente.

El costeo tiene una regla que vale la pena entender: la sierra `C-01` es el cuello
de botella y **no tiene equipo redundante**, así que sus paros se valoran a la
tarifa de línea —la suma de las ocho estaciones, `$19,750 MXN/hr`— y no a la suya.
Los demás activos tienen gemelo en su etapa y se valoran a la propia. De ahí sale
el Registro #01 que cita el PRD: `255 min × $19,750 = $4,796 USD`.

Las cifras del showcase por rol de la landing (Pareto, MTTR, costo del periodo)
salen de este mismo dataset. Si cambias los eventos, **recalcula y actualiza el
HTML de la landing**, o las dos superficies empiezan a contar historias distintas.

### Persistencia

Los paros que el operador captura van a `localStorage`, no a la API. Es deliberado:
la demo no escribe en Supabase ni en `leads.json`, funciona sin conexión y se
reinicia desde la pantalla de acceso. El efecto secundario es el mejor momento de
la demostración: un paro registrado en la tableta aparece en el tablero del gerente
y en el Pareto de dirección **del mismo navegador**.

### Permisos

Están en un solo objeto por cuenta (`verMontos`, `verTarifas`, `exportar`,
`registrarParo`) y cada vista **pregunta** en vez de asumir, así que mover una
capacidad de un rol a otro es una línea en `sesion.js`.

`operador.js` va un paso más allá: no importa ningún formateador de moneda ni lee
`tarifa` en ninguna parte. No tiene forma de mostrar un peso aunque alguien lo
intentara, que es más robusto que confiar en no haberlo escrito.
