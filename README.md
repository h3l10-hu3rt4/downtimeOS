# DowntimeOS — Landing Page & Lead Magnet

Landing con calculadora de "margen oculto" para un Micro-SaaS industrial que
traduce paros de máquina en pérdida monetaria en tiempo real (`$/minuto`).
Implementado según `PRD_Landing_DowntimeOS.md`.

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
2. **Credenciales.** Copia `.env.example` como `.env.local` y llena
   `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`.
   ⚠️ La `service_role` key omite RLS: solo servidor, nunca en `public/`.
3. **Pruebas.** `npm test` (runner nativo de Node, sin dependencias).
4. **Local.** `npm run dev` (usa `vercel dev`) → `http://localhost:3000`.
5. **Deploy.** `vercel deploy`, registrando las mismas variables en
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
├── supabase/
│   ├── schema.sql      Tabla, constraints, vista, RLS
│   └── seed.sql        Semilla idempotente
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
2. Mueve los sliders de la calculadora → las cifras cambian en `< 0.01 ms`.
3. Clic en **Descargar Plan de Mitigación Personalizado en PDF**.
4. Escribe un correo `@gmail.com` → **rechazado** por la regla B2B.
5. Cámbialo por uno corporativo → se guarda el lead y se abre el reporte imprimible.
6. Verifica la persistencia en `http://localhost:3000/api/leads`.

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
Secciones implementadas: navbar sticky con anclas y CTA `[Auditoría 30 Días]`,
hero con **ticker SCADA en vivo** (`requestAnimationFrame`, se pausa con la
pestaña oculta), matriz comparativa vs. MES tradicionales, calculadora reactiva
con switch MXN/USD, modal de captura (lead magnet), casos de éxito en formato
de 3 pilares, formulario de cierre de auditoría, FAQ y footer con estado de la API.

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

## Modelo de cálculo (compartido por ambas implementaciones)

```text
Pérdida_Diaria    = Máquinas × (Minutos_Paro / 60) × Tarifa_Horaria
Pérdida_Mensual   = Pérdida_Diaria × 25 días operativos
Pérdida_Anual     = Pérdida_Mensual × 12 meses
Ahorro_Proyectado = Pérdida_Anual × 0.35
```

Vive en **tres espejos que deben cambiarse juntos**:

| Archivo | Rol |
| :--- | :--- |
| `lib/calculo.js` | Autoridad en producción: es lo que se persiste en Supabase |
| `server/calculo.py` | Autoridad en el prototipo local |
| `public/js/calculator.js` | Reactividad instantánea en el navegador, sin red |

Los límites por divisa y la lista de dominios B2B están duplicados igual. Ver
la tabla de espejos en [HANDOFF.md](HANDOFF.md) §7.

> ### ⚠️ Inconsistencia detectada en el PRD
> El escenario Gherkin de la §6 afirma que 8 máquinas × 2 turnos × $1,500 MXN/hr
> × 30 min arrojan **$1,200,000 MXN** anuales y $420,000 de ahorro. Con la
> fórmula normativa de la §4.3 esos mismos inputs dan **$1,800,000** y
> **$630,000** (8 × 0.5 h × 1500 = $6,000/día × 25 × 12).
>
> Se implementó la **fórmula de la §4.3**, por ser el algoritmo especificado.
> Para alinear el prototipo al Gherkin basta ajustar `DIAS_OPERATIVOS` en
> `server/calculo.py` y en `public/js/calculator.js`.

**Divisas.** El tipo de cambio es `17.50 MXN/USD` (`TIPO_CAMBIO_USD`). Los
límites de tarifa son por divisa —MXN `100–200,000`, USD `5–12,000`— para que un
piso pensado en pesos no mutile una tarifa en dólares; el ida y vuelta
MXN → USD → MXN regresa al valor original.

---

## Telemetría

Los eventos del PRD §4.1 se emiten a `window.dataLayer` y a la consola:
`view_landing_page`, `interact_calculator` (con *debounce* de 300 ms),
`currency_switched`, `submit_lead_magnet`, `request_audit_click` y
`scroll_milestone` (25/50/75/100%). Enganchar PostHog o GTM es sustituir el
cuerpo de `track()` en `app.js`.

---

## Alcance del prototipo

Implementado según el PRD, con estas sustituciones propias de un entorno local:

* **Reporte PDF (RF-06):** se genera en el cliente sin librerías externas —abre
  una ventana con el reporte formateado y dispara *Imprimir → Guardar como PDF*.
* **Video demo (RF-05):** el modal reserva el espacio del reproductor con el
  desglose del guion; no hay archivo de video en el repo.
* **Webhook a CRM / WhatsApp Cloud API:** el `POST` termina en `data/leads.json`.
  El punto de integración es `_crear_lead()` en `server/main.py`.
* **CORS** está abierto (`*`) por ser un prototipo local de desarrollo.
