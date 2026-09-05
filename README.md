# DowntimeOS — Landing Page & Lead Magnet

Landing con calculadora de "margen oculto" para un Micro-SaaS industrial que
traduce paros de máquina en pérdida monetaria en tiempo real (`$/minuto`).
Implementado según el PRD de la landing v1.0.0. El copy aprobado de las dos
secciones críticas está en [docs/copy-calculadora-y-precios.md](docs/copy-calculadora-y-precios.md).

El repo contiene **dos implementaciones del mismo producto**, con el frontend
(`public/`) compartido byte por byte:

| | Stack | Para qué sirve |
| :--- | :--- | :--- |
| **Producción** | Node.js + Serverless Functions de Vercel + Supabase (Postgres) | Deploy público |
| **Prototipo local** | Python (solo librería estándar) + `data/leads.json` | Demo offline, sin instalar nada |

Ambas exponen **el mismo contrato de API**, así que `public/` funciona con
cualquiera de las dos sin un solo cambio.

---

## A · Stack de producción (Node + Supabase + Vercel)

```bash
npm install
```

Requiere **Node.js 20+**. Luego:

1. **Base de datos.** En Supabase → SQL Editor, ejecuta `supabase/schema.sql`
   y después `supabase/seed.sql` (migra los registros de `data/leads.json`).
   ⚠️ Las 31 semillas se generaron con el modelo de cálculo anterior (sin el
   multiplicador de turnos y con factor 0.35), así que sus cifras no son
   comparables con las de un lead capturado hoy. Se conservan a propósito: ver
   la vista `leads_por_modelo` que crea la migración del 2026-09-04.
2. **Credenciales.** Copia `.env.example` como `.env.local` y llena
   `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`.
   ⚠️ La `service_role` key omite RLS: solo servidor, nunca en `public/`.
3. **Migraciones.** Si la base ya tiene datos, ejecuta lo que haya en
   `supabase/migraciones/` en orden de fecha **antes** de desplegar. Ahí van los
   cambios que `schema.sql` ya trae para instalaciones nuevas pero que una tabla
   poblada necesita aplicar aparte.
4. **Pruebas.** `npm test` (runner nativo de Node, sin dependencias).
5. **Local.** `npm run dev` (usa `vercel dev`) → `http://localhost:3000`.
6. **Deploy.** `vercel deploy`, registrando las mismas variables en
   Vercel → Settings → Environment Variables.

```text
├── api/                Serverless Functions
│   ├── health.js  config.js
│   └── leads/index.js  leads/stats.js
├── lib/                Lógica de negocio
│   ├── calculo.js      Fórmula financiera (autoridad)
│   ├── validacion.js   Reglas de campo + regla B2B
│   ├── repositorio.js  Acceso a Supabase
│   ├── supabase.js  entorno.js  http.js
├── public/demo/        Demo navegable de DowntimeCO (vistas por rol)
├── docs/               Copy aprobado de las secciones críticas
├── supabase/
│   ├── schema.sql      Tabla, constraints, vista, RLS
│   ├── seed.sql        Semilla idempotente
│   └── migraciones/    Cambios sobre una base ya poblada
└── test/               node --test
```

Detalles de arquitectura, invariantes y decisiones: **[HANDOFF.md](HANDOFF.md)**.

---

## B · Prototipo local (Python, sin dependencias)

Corre 100% local, sin build, sin `npm install` y sin `pip install`. Útil para
demostrar el producto sin internet ni cuenta de Supabase.

### Arranque rápido (un solo comando)

```bash
python server/main.py
```

Eso hace tres cosas: siembra `data/leads.json` si no existe, levanta la API en
`http://localhost:3000` y **abre el navegador automáticamente**.

En Windows también sirve `run.bat` (doble clic); en macOS/Linux, `./run.sh`.

| Bandera | Efecto |
| :--- | :--- |
| `--port 4000` | Cambia el puerto (default `3000`, o la variable `PORT`) |
| `--no-browser` | No abre el navegador |
| `--reseed` | Regenera los 30 leads semilla y descarta los capturados |

**Requisito único:** Python 3.8+. No hay dependencias externas; `server/requirements.txt`
existe solo para documentar esa ausencia.

### Prueba de humo en 30 segundos

1. Abre `http://localhost:3000` y mira el ticker del hero acumulando pérdida.
2. Mueve los sliders de la calculadora → las cifras se recalculan al instante.
3. Clic en **Generar Reporte Ejecutivo para Dirección (PDF)**.
4. Escribe un correo `@gmail.com` → **rechazado** por la regla B2B.
5. Cámbialo por uno corporativo → se guarda el lead y se abre el reporte imprimible.
6. Verifica la persistencia en `http://localhost:3000/api/leads`.
7. Abre `http://localhost:3000/demo/` y entra como operador: registra un paro y
   vuelve a entrar como CEO para verlo con precio.

---

### Arquitectura de 3 capas (versión Python)

```text
├── data/
│   └── leads.json          Capa 3 · Persistencia (30 semillas + nuevos)
├── public/                 Capa 1 · Presentación
│   ├── index.html            Landing completa (7 secciones del PRD)
│   ├── css/styles.css        Sistema visual industrial + animaciones
│   └── js/
│       ├── calculator.js     Fórmula y formateo monetario (sin DOM)
│       └── app.js            Ticker, estado de UI, fetch, validación
├── server/                 Capa 2 · Middleware / API
│   ├── main.py               HTTP server + ruteo + estáticos
│   ├── calculo.py            Fuente de verdad de la fórmula
│   ├── validacion.py         Reglas de campo + regla B2B
│   ├── store.py              Lectura/escritura atómica del JSON
│   └── seed_data.py          Roster de los 30 registros semilla
├── server/requirements.txt
├── run.bat / run.sh
└── README.md
```

### Capa 1 — Frontend
Secciones implementadas: header flotante con anclas y CTA `[Auditoría]`, hero con
**ticker financiero en vivo** de la sierra `C-01` (`requestAnimationFrame`, se pausa
con la pestaña oculta), matriz retadora vs. MES tradicionales, calculadora reactiva
con switch MXN/USD y benchmarks por tipo de celda, showcase de interfaces por rol,
caso de demostración DowntimeCO, precios con la separación Zero-Hardware / telemetría
opcional, bloque de aislamiento OT, FAQ, formulario de piloto de 14 días y footer
técnico.

Además, en `public/demo/` vive la **demo navegable de DowntimeCO** (ver más abajo).

Tailwind entra por CDN según el PRD, **con `preflight` desactivado**: la
identidad visual vive en `styles.css`, así que la página se ve igual aunque el
CDN no cargue. Verificado sin desbordamiento horizontal en 375 / 768 / 1440 px.

### Capa 2 — API

| Método | Ruta | Descripción |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Estado del servidor, uptime y salud de la persistencia |
| `GET` | `/api/leads` | Lista completa. Filtros: `?estatus=NUEVO&limite=10` |
| `GET` | `/api/leads/stats` | Agregados: total, por estatus, pérdida anual promedio |
| `GET` | `/api/config` | Constantes del modelo y límites de los inputs |
| `POST` | `/api/leads` | Alta de lead: valida → recalcula → persiste |

`POST /api/leads` **nunca confía en las cifras del cliente**: revalida los
campos y recalcula toda la aritmética financiera con `calculo.py` antes de
guardar. Devuelve `201` con el lead creado, o `400` con un mapa `errores`
campo → mensaje que el frontend pinta bajo cada input.

Reglas aplicadas (RF-03):
* Obligatorios: nombre (≥3), empresa, correo, teléfono; ciudad si el origen es `AUDITORIA`.
* Correo con formato válido y **regla B2B**: se rechazan `@gmail.com`,
  `@hotmail.com`, `@outlook.com`, `@yahoo.*` y 20 dominios públicos más
  (lista en `validacion.py`; desactivable con `REGLA_B2B_ACTIVA = False`).
* Teléfono de 10 dígitos tolerando espacios, guiones y lada `+52` / `+52 1`.
* El servidor asigna `id` (`LEAD-2026-NNNN`), `created_at` ISO-8601 UTC y
  `estatus` (`NUEVO` o `AUDITORIA_SOLICITADA` según el formulario de origen).

### Capa 3 — Persistencia
`data/leads.json` se escribe de forma **atómica**: archivo temporal en el mismo
directorio → `flush` + `fsync` → `os.replace()`. Un corte a media escritura
nunca deja el JSON truncado. Todas las operaciones pasan por un `RLock`, y el
servidor es multihilo. Si el archivo falta, está vacío o corrupto, se respalda
y se regenera con la semilla.

Las 30 semillas son plantas verosímiles de México/LATAM (inyección de plástico,
CNC, estampado Tier 2, agroindustria, empaque…) con roles del ICP y valores en
rango: 3–45 máquinas, 1–3 turnos, $830–$4,450 MXN/hr. Sus cifras financieras
**no están escritas a mano**: se derivan con el mismo motor que usa la API.

---

## Demo navegable de DowntimeCO (`public/demo/`)

Cuatro páginas con **separación real de vistas por rol**, servidas por cualquiera
de las dos implementaciones. Abre `/demo/`:

| Página | Cuenta | Qué ve |
| :--- | :--- | :--- |
| `index.html` | — | Acceso con las tres cuentas |
| `direccion.html` | `ceo@downtimeco.com` | Pareto, tarifas hora-máquina, bitácora con montos, reporte PDF |
| `operaciones.html` | `gerente@downtimeco.com` | Estado del piso, MTTR/MTBF, leaderboard por turno, despacho |
| `operador.html` | `operador@downtimeco.com` | Tableta táctil, registro en 3 toques, **cero cifras de dinero** |

Contraseña de las tres: `demo1234`, visible en la pantalla de acceso.

**No es autenticación.** Las cuentas y la contraseña viajan en el JavaScript que
descarga el navegador y la guarda entre vistas es una redirección de cliente:
sirve para enseñar *cómo se comporta* el producto con perfiles diferenciados, no
para proteger nada. Cuando esto pase a producto, `demo/js/sesion.js` se reemplaza
por Supabase Auth; no se "endurece".

**Datos.** `demo/js/datos.js` es la fuente única: ocho activos en cuatro etapas y
26 paros de los últimos 30 días. La sierra `C-01` es el cuello de botella, así que
sus paros se valoran a la **tarifa de línea** (la suma de las ocho estaciones,
$19,750 MXN/hr) y no a la suya. De ahí sale el Registro #01: 255 min = $4,796 USD.
Las cifras del showcase por rol de la landing salen de este mismo dataset.

Los paros que el operador captura van a `localStorage`, **no a la API**: la demo no
escribe en Supabase ni en `leads.json`. Un paro registrado en la tableta aparece
en el tablero del gerente y en el Pareto de dirección del mismo navegador. Se
reinicia desde la pantalla de acceso.

---

## Modelo de cálculo (compartido por ambas implementaciones)

```text
Minutos_Paro_Día  = Máquinas × Turnos × Minutos_Paro_Turno
Pérdida_Diaria    = (Minutos_Paro_Día / 60) × Tarifa_Horaria
Pérdida_Mensual   = Pérdida_Diaria × 25 días operativos
Pérdida_Anual     = Pérdida_Mensual × 12 meses     (= 300 días hábiles)
Ahorro_Proyectado = Pérdida_Anual × 0.20           (reducción de MTTR)
```

Los minutos se declaran **por turno y por máquina**: dos turnos duplican la
exposición diaria del mismo activo. El horizonte anual se conserva en dos
escalones (25 × 12 = 300) porque el esquema de Postgres valida la invariante
`perdida_anual = perdida_mensual × 12`.

### El factor de recuperación: 20%, y por qué

DowntimeOS acorta la **detección y el despacho** de la brigada, no la reparación
física, que depende del personal técnico y del refaccionario. Por eso solo se
proyecta el extremo conservador del rango. Una versión anterior sostenía a la vez
un 35% y un 15% sin fundamento; se unificaron en este factor.

Vive en **cuatro espejos que deben cambiarse juntos** (el cuarto es el que suele
olvidarse y rompe producción):

| Archivo | Rol |
| :--- | :--- |
| `lib/calculo.js` | Autoridad en producción: es lo que se persiste en Supabase |
| `server/calculo.py` | Autoridad en el prototipo local |
| `public/js/calculator.js` | Reactividad instantánea en el navegador, sin red |
| `supabase/schema.sql` | Restricción `leads_ahorro_coherente`: **si el factor cambia y esta no se migra, la base rechaza cada alta de lead** |

Los límites por divisa y la lista de dominios B2B están duplicados igual. Ver
la tabla de espejos en [HANDOFF.md](HANDOFF.md) §7.

> ### ⚠️ Cambiar el factor exige una migración
> El factor de recuperación está escrito **dentro de una restricción de Postgres**
> (`leads_ahorro_coherente`). Cambiarlo solo en los motores hace que la base
> rechace cada `POST /api/leads` en producción, con la landing aparentemente
> correcta. Hay un ejemplo resuelto en `supabase/migraciones/2026-09-04-factor-mttr-20.sql`:
> reemplaza la restricción como `not valid` para que los leads calculados con el
> modelo anterior se conserven sin reescribirse.

**Divisas.** El tipo de cambio es `17.50 MXN/USD` (`TIPO_CAMBIO_USD`). Los
límites de tarifa son por divisa —MXN `100–200,000`, USD `5–12,000`— para que un
piso pensado en pesos no mutile una tarifa en dólares; el ida y vuelta
MXN → USD → MXN regresa al valor original.

---

## Telemetría

Los eventos se emiten a `window.dataLayer` y a la consola:

| Evento | Cuándo | Parámetros |
| :--- | :--- | :--- |
| `view_landing_page` | Carga de la página | UTM de origen |
| `hero_ticker_interacted` | Hover o clic en el ticker del hero, una sola vez | `machine_id`, `seconds_on_hero` |
| `calculator_slider_changed` | Cambio de máquinas, turnos o minutos (*debounce* 300 ms) | `machines_count`, `shifts`, `downtime_minutes`, `currency` |
| `calculator_preset_selected` | Clic en un benchmark de costo hora-máquina | `preset`, `tarifa_hora` |
| `currency_switched` | Cambio MXN ↔ USD | `divisa`, `tarifa_hora` |
| `calculator_pdf_gate_open` | Apertura del formulario del reporte | `calculated_annual_loss`, `currency` |
| `calculator_pdf_requested` | Envío exitoso del formulario | `company_domain`, `calculated_annual_loss`, `currency` |
| `role_tab_switched` | Cambio de pestaña en el showcase por rol | `selected_role`, `dwell_time_ms` |
| `pricing_pilot_clicked` | Clic en el CTA de un plan | `plan_context`, `source_section` |
| `request_audit_click` / `request_audit_submit` | CTA y alta del piloto de 14 días | `ubicacion` / `lead_id`, `empresa` |
| `scroll_milestone` | Profundidad 25 / 50 / 75 / 100% | `profundidad` |

Enganchar PostHog o GTM es sustituir el cuerpo de `track()` en `app.js`.

---

## Alcance del prototipo

Implementado según el PRD, con estas sustituciones propias de un entorno local:

* **Reporte PDF (RF-06):** se genera en el cliente sin librerías externas —abre
  una ventana con el reporte formateado y dispara *Imprimir → Guardar como PDF*.
* **Video demo (RF-05):** el modal reserva el espacio del reproductor con el
  desglose del guion; no hay archivo de video en el repo.
* **Webhook a CRM / WhatsApp Cloud API:** el `POST` termina en la persistencia y
  no sale de ahí. El punto de integración es `crearLead()` en `lib/repositorio.js`
  (producción) y `_crear_lead()` en `server/main.py` (prototipo local).
* **Autenticación de la demo:** `public/demo/` simula el acceso por rol en el
  navegador. El producto lo resolvería con Supabase Auth y políticas de fila.
* **CORS** está abierto (`*`) por ser un prototipo local de desarrollo.
