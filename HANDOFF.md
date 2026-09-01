# HANDOFF TÉCNICO — Prototipo DowntimeOS

> Documento de traspaso para otro agente/desarrollador que continúe este proyecto.
> Describe **qué está construido, cómo está construido, qué invariantes no se
> deben romper y qué sigue**. Fecha de corte: 2026-08-28.

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

> 🚚 **MIGRACIÓN EN CURSO → Vercel + Supabase + Node.js.** Las secciones 2 a 13
> describen el prototipo local (Python), que sigue siendo la referencia
> funcional y ejecutable. Los artefactos de la migración están descritos en la
> **§14**, al final. Lee la §14 antes de tocar nada relacionado con el deploy.

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
│   ├── index.html          Landing completa, 7 secciones del PRD + 2 modales
│   ├── css/styles.css      Sistema visual completo (778 líneas)
│   └── js/
│       ├── calculator.js   Math + formateo. SIN acceso al DOM. window.DowntimeCalc
│       └── app.js          Ticker, estado UI, fetch, validación cliente, reporte
├── server/                 Capa 2
│   ├── main.py             HTTP handler, ruteo, CORS, estáticos, CLI
│   ├── calculo.py          AUTORIDAD de la fórmula y de los límites
│   ├── validacion.py       Reglas de campo + regla B2B. Lanza ErrorValidacion
│   ├── store.py            I/O atómico del JSON, seeding, lock, stats
│   └── seed_data.py        ROSTER de 30 tuplas + construir_semilla()
├── README.md               Documentación de usuario
├── HANDOFF.md              Este archivo
├── requirements.txt / run.bat / run.sh
```

Responsabilidades, para no mezclar capas:

- `calculator.js` **no toca el DOM**; `app.js` no contiene fórmulas.
- `main.py` no contiene reglas de negocio: delega en `calculo`/`validacion`/`store`.
- `store.py` es el único módulo que abre archivos.
- El frontend **nunca** lee `data/leads.json`; solo habla HTTP.

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

## 7. Modelo de cálculo (PRD §4.3)

```text
Pérdida_Diaria    = Máquinas × (Minutos_Paro / 60) × Tarifa_Horaria
Pérdida_Mensual   = Pérdida_Diaria × 25 días operativos
Pérdida_Anual     = Pérdida_Mensual × 12 meses
Ahorro_Proyectado = Pérdida_Anual × 0.35
```

Constantes: `DIAS_OPERATIVOS=25`, `MESES=12`, `FACTOR_MITIGACION=0.35`,
`TIPO_CAMBIO_USD=17.50`, `HORAS_POR_TURNO=8`.

### ⚠️ Inconsistencia conocida del PRD

El escenario Gherkin de la §6 afirma que 8 máquinas × 2 turnos × $1,500 MXN/hr
× 30 min dan **$1,200,000** anuales. La fórmula normativa de la §4.3 da
**$1,800,000** (y $630,000 de ahorro). Se implementó **la fórmula**, no el
Gherkin. Para alinearlo al Gherkin habría que cambiar `DIAS_OPERATIVOS` en los
dos espejos. **No "arregles" esto en silencio**: es una decisión documentada.

### Invariante crítico: los espejos

La fórmula, los límites y la lista de dominios genéricos viven **duplicados** a
propósito (servidor = autoridad, cliente = reactividad instantánea sin red).
Si tocas uno, toca el otro:

| Concepto | Servidor | Cliente |
| :--- | :--- | :--- |
| Fórmula y constantes | `server/calculo.py` | `public/js/calculator.js` (`MODELO`) |
| Límites por divisa | `calculo.LIMITES_TARIFA` | `calculator.js` (`LIMITES_TARIFA`) |
| Dominios B2B rechazados | `validacion.DOMINIOS_GENERICOS` | `app.js` (`DOMINIOS_GENERICOS`) |
| Normalización de teléfono | `validacion.normalizar_telefono` | `app.js` (`normalizarTelefono`) |

Alternativa futura: que `app.js` consuma `GET /api/config` al arrancar y elimine
la duplicación de constantes. No se hizo para que la landing siga calculando
aunque la API esté caída.

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
- Escenario Gherkin en la UI → `$1,800,000 MXN` / `$630,000 MXN`.
- Switch de divisa: 1500 MXN → 85.71 USD → 1500 MXN (ida y vuelta exacto).
- Modal lead magnet completo: rechazo B2B → correo corporativo → lead guardado
  → reporte generado.
- Formulario de auditoría con `+52 844 123 4567` y 34 equipos → el valor del
  formulario pisa el de la calculadora, estatus `AUDITORIA_SOLICITADA`.
- Layout sin desbordamiento horizontal en 375 / 768 / 1440 px.
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

Eventos de telemetría ya emitidos: `view_landing_page`, `interact_calculator`
(debounce 300 ms), `currency_switched`, `submit_lead_magnet`,
`request_audit_click`, `request_audit_submit`, `scroll_milestone`,
`request_report_click`, `video_modal_open`.

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

⚠️ **Lo que NO está verificado:** nada se ha ejecutado contra Vercel ni contra
una instancia real de Supabase, porque no hay Node ni proyecto creado en esta
máquina. Falta correr `npm test`, `vercel dev` y el deploy.

### 14.5 Pasos pendientes para completar la migración

1. Crear el proyecto en Supabase y correr `supabase/schema.sql`, luego
   `supabase/seed.sql`, en el SQL Editor.
2. `npm install` y `npm test` (debe pasar en verde).
3. `.env.local` con `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`;
   `vercel dev` para probar en `localhost:3000` con el mismo frontend.
4. `vercel deploy`, registrar las mismas variables en el dashboard y verificar
   `/api/health` en producción.
5. Recién entonces decidir si `server/` se archiva o se conserva como demo
   offline.
