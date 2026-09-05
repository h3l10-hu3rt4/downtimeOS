# DowntimeOS — Landing, calculadora de margen oculto y demo multi-rol

Micro-SaaS B2B para PyMEs industriales que traduce los paros de máquina en
pérdida financiera auditable (`$/minuto`), sin cablear nada y sin tocar los PLCs.

El repositorio contiene **dos entregables** y **dos implementaciones del
backend** con el mismo contrato de API:

| | Qué es |
| :--- | :--- |
| **Landing** `public/` | Página de conversión: calculadora, captura de leads y reporte en PDF |
| **Demo** `public/demo/` | Simulación navegable de la planta DowntimeCO con tres perfiles y separación de vistas por rol |

| Backend | Stack | Para qué |
| :--- | :--- | :--- |
| Producción | Node 22 + Serverless Functions de Vercel + Supabase | Deploy público |
| Prototipo local | Python, solo librería estándar, `data/leads.json` | Demostrar sin internet ni instalación |

¿Entras nuevo al proyecto? Empieza por **[KEKAS.md](KEKAS.md)**.
¿Vas a tocar el código? Lee **[HANDOFF.md](HANDOFF.md)** antes.

---

## Arranque rápido (sin instalar nada)

```bash
python server/main.py
```

Siembra los datos si faltan, levanta la API en `http://localhost:3000` y abre el
navegador. Requisito único: **Python 3.8+**. En Windows también sirve doble clic
en `run.bat`; en macOS y Linux, `./run.sh`.

| Bandera | Efecto |
| :--- | :--- |
| `--port 4000` | Cambia el puerto (default `3000`, o la variable `PORT`) |
| `--no-browser` | No abre el navegador |
| `--reseed` | Regenera los leads semilla y descarta los capturados |

Rutas:

- **Landing** → `http://localhost:3000/`
- **Demo por rol** → `http://localhost:3000/demo/`
- **Leads capturados** → `http://localhost:3000/api/leads`

---

## Credenciales de la demo

Contraseña única para los tres perfiles: **`demo1234`**

| Perfil | Correo | Quién es | Qué ve |
| :--- | :--- | :--- | :--- |
| **AH** | `alex@downtimeco.tech` | Alejandro Huerta | Pareto, tarifas, montos, exportación |
| **AG** | `alondra@downtimeco.tech` | Alondra González | Tablero, MTTR/MTBF, bandeja de paros. Sin tarifas |
| **HH** | `helio@downtimeco.tech` | Helio Huerta | Semáforo táctil. **Cero cifras de dinero** |

> ⚠️ **La demo no tiene autenticación real.** Las credenciales viajan en el
> JavaScript que descarga el navegador y la separación entre vistas es una
> redirección de cliente. Sirve para enseñar el comportamiento del producto con
> perfiles diferenciados, no para proteger nada. Ver `KEKAS.md` §6.

---

## Stack de producción (Node + Supabase + Vercel)

```bash
npm install
```

Requiere **Node.js 20+**. Luego:

1. **Base de datos.** En Supabase → SQL Editor, ejecuta `supabase/schema.sql` y
   después `supabase/seed.sql`.
   ⚠️ Las 31 semillas se generaron con el modelo de cálculo anterior (sin
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
6. **Deploy.** `npm run deploy`, registrando las mismas variables en
   Vercel → Settings → Environment Variables.

**El orden importa:** migración → merge → deploy. Al revés, producción queda
rota en silencio.

---

## API

| Método | Ruta | Descripción |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Estado del servidor, uptime y salud de la persistencia |
| `GET` | `/api/config` | Constantes del modelo y límites de los inputs |
| `GET` | `/api/leads` | Lista. Filtros: `?estatus=NUEVO&limite=10&desde=0` |
| `GET` | `/api/leads/stats` | Agregados: total, por estatus, pérdida anual promedio |
| `POST` | `/api/leads` | Alta de lead: valida → recalcula → persiste |

`POST /api/leads` **nunca confía en las cifras del cliente**: revalida los campos
y recalcula toda la aritmética financiera antes de guardar. Devuelve `201` con el
lead creado, o `400` con un mapa `errores` campo → mensaje que el frontend pinta
bajo cada input.

Reglas de validación:

- Obligatorios: nombre (≥3), empresa, correo, teléfono; ciudad si el origen es
  `AUDITORIA`.
- Correo con formato válido y **regla B2B**: se rechazan `@gmail.com`,
  `@hotmail.com`, `@outlook.com`, `@yahoo.*` y 20 dominios públicos más.
- Teléfono de 10 dígitos tolerando espacios, guiones y lada `+52` / `+52 1`.
- El servidor asigna folio, `created_at` y estatus. Nunca el cliente.

---

## Modelo de cálculo

```text
Minutos_Paro_Día  = Activos × Turnos × Minutos_Paro_Turno
Pérdida_Diaria    = (Minutos_Paro_Día / 60) × Costo_Hora_Máquina
Pérdida_Mensual   = Pérdida_Diaria × 25 días operativos
Pérdida_Anual     = Pérdida_Mensual × 12 meses     (= 300 días hábiles)
Recuperación      = Pérdida_Anual × 0.20           (reducción de MTTR)
```

Los minutos se declaran **por turno y por máquina**: dos turnos duplican la
exposición diaria del mismo activo. El horizonte anual se conserva en dos
escalones (25 × 12 = 300) porque el esquema de Postgres valida la invariante
`perdida_anual = perdida_mensual × 12`.

### El factor de recuperación: 20 %, y por qué

DowntimeOS acorta la **detección y el despacho** de la brigada, no la reparación
física, que depende del personal técnico y del refaccionario. Por eso solo se
proyecta el extremo conservador del rango.

Vive en **cuatro espejos que deben cambiarse juntos** (el cuarto es el que suele
olvidarse y rompe producción):

| Archivo | Rol |
| :--- | :--- |
| `lib/calculo.js` | Autoridad en producción: es lo que se persiste en Supabase |
| `server/calculo.py` | Autoridad en el prototipo local |
| `public/js/calculator.js` | Reactividad instantánea en el navegador, sin red |
| `supabase/schema.sql` | Restricción `leads_ahorro_coherente`: **si el factor cambia y esta no se migra, la base rechaza cada alta de lead** |

> ### ⚠️ Cambiar el factor exige una migración
> Hay un ejemplo resuelto en
> `supabase/migraciones/2026-09-04-factor-mttr-20.sql`: reemplaza la restricción
> como `not valid` para que los leads calculados con el modelo anterior se
> conserven sin reescribirse.

**Divisas.** Tipo de cambio `17.50 MXN/USD`. Los límites de tarifa son por
divisa —MXN `100–200,000`, USD `5–12,000`— para que un piso pensado en pesos no
mutile una tarifa en dólares; el ida y vuelta MXN → USD → MXN regresa al valor
original.

---

## Demo multi-rol de DowntimeCO

Cuatro páginas con separación real de vistas, servidas por cualquiera de las dos
implementaciones. Abre `/demo/`.

**La planta.** Dos líneas y doce activos. Cada línea tiene su propio cuello de
botella —`C-01` en la Línea 01, `R-01` en la Línea 02— y esos activos no tienen
equipo redundante: cuando se detienen, se detiene su línea completa, así que su
paro se valora a la **tarifa de la línea** (la suma de sus estaciones) y no a la
suya. De ahí sale el Registro #01 del PRD: 255 min × $19,750/h = $4,796 USD.

**Turnos.** T1 06:00–14:00 · T2 14:00–22:00 · T3 22:00–06:00. Como el T3 cruza la
medianoche, un paro de las 02:00 del día 5 pertenece a la **jornada** del día 4.
Sin esa corrección, un filtro por fechas partiría cada turno nocturno en dos.

**Folios.** `L01-SR-C01-20260904-1425-A1` — línea, tipo de máquina, activo, fecha
en `YYYYMMDD`, hora en `HHMM` y un hash de dos caracteres. El formato es
deliberado: el orden lexicográfico coincide con el cronológico, así que ordenar
como texto plano basta.

**Persistencia.** Lo que se captura en la demo va a `localStorage`, **no a la
API**: no ensucia Supabase ni `leads.json`, funciona sin conexión y se reinicia
desde la pantalla de acceso. El efecto secundario es el mejor momento de la
demostración: un paro registrado en la tableta aparece en el tablero del gerente
y en el Pareto de dirección del mismo navegador.

---

## Telemetría

Los eventos se emiten a `window.dataLayer` y a la consola. Enganchar PostHog o
GTM es sustituir el cuerpo de `track()` en `app.js`.

| Evento | Cuándo |
| :--- | :--- |
| `view_landing_page` | Carga de la página |
| `hero_ticker_interacted` | Hover o clic en el ticker del hero, una sola vez |
| `calculator_slider_changed` | Cambio de activos, turnos o minutos (*debounce* 300 ms) |
| `calculator_preset_selected` | Clic en un benchmark de costo hora-máquina |
| `currency_switched` | Cambio MXN ↔ USD |
| `calculator_pdf_gate_open` / `calculator_pdf_requested` | Apertura y envío del formulario del reporte |
| `role_tab_switched` | Cambio de pestaña en el showcase por rol |
| `pricing_pilot_clicked` | Clic en el CTA de un plan |
| `request_audit_click` / `request_audit_submit` | CTA y alta del piloto de 14 días |
| `scroll_milestone` | Profundidad 25 / 50 / 75 / 100 % |

---

## Alcance: sustituciones conscientes

- **Reporte PDF:** se genera en el cliente sin librerías —se arma un documento
  imprimible y se dispara *Imprimir → Guardar como PDF*.
- **Video demo:** el modal reserva el espacio del reproductor con el desglose del
  guion; no hay archivo de video en el repo.
- **Webhook a CRM / WhatsApp Cloud API:** el `POST` termina en la persistencia.
  El punto de integración es `crearLead()` en `lib/repositorio.js` (producción) y
  `_crear_lead()` en `server/main.py` (prototipo local).
- **Autenticación de la demo:** simulada en el navegador. El producto lo
  resolvería con Supabase Auth y políticas de fila.
- **IA:** hay contenedor y redacción simulada; no hay modelo conectado. Ver
  `KEKAS.md` §5.
- **CORS** está abierto (`*`) en el prototipo local por ser de desarrollo.
