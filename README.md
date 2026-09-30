# DowntimeOS

Micro-SaaS B2B para PyMEs industriales que traduce los paros de máquina en
pérdida financiera auditable (`$/minuto`), sin cablear nada y sin tocar los PLCs.

**En producción:** [downtimeos.tech](https://downtimeos.tech) · Vercel + Supabase

| | Qué es | Ruta |
| :--- | :--- | :--- |
| **Landing** | Página de conversión: calculadora de margen oculto, precios, captura de leads y reporte PDF | `/` |
| **Demo DowntimeCO** | Planta simulada con tres perfiles y vistas distintas por rol, conectada a Supabase | `/demo/` |
| **Administración** | Panel privado: uso de IA, PDF y WhatsApp, interruptores de integraciones, auditoría de exposición y **lista de prospectos** | `/administracion` |
| **Aviso de privacidad** | Requisito de Meta para el número de WhatsApp | `/privacidad` |

Documentación técnica en [`docs/`](docs/): invariantes y trampas en
[HANDOFF](docs/HANDOFF.md), identidad visual en
[IDENTIDAD-VISUAL](docs/IDENTIDAD-VISUAL.md).

---

## Estado actual

| Área | Estado |
| :--- | :--- |
| Landing | Completa. Precios con selector **Semestral / Anual** (tarifa base × 6 o × 12) |
| Demo multi-rol | Completa y persistida en Supabase; si no hay API, cae a datos locales y lo avisa |
| IA | Conectada: **Gemini** o **Claude**, elegible por área desde Administración |
| Reportes PDF | Generados en el servidor (PDFKit) y guardados en Supabase Storage |
| WhatsApp | **Meta Cloud API** (Twilio como respaldo). Las plantillas se activan con `WHATSAPP_META_USE_TEMPLATES` una vez aprobadas por Meta |
| Administración | Acceso con sesión firmada, protegido en servidor por `middleware.js` |
| Dominio | `downtimeos.tech` y `www.downtimeos.tech` |

**Lo que todavía no existe:** captura de una planta real (los datos son una
simulación), autenticación real en la demo (ver abajo) y telemetría IoT (el plan
Enterprise la menciona en el copy, pero no hay firmware ni ingesta de sensores).

---

## Credenciales de la demo

Contraseña única para los tres perfiles: **`demo1234`**

| Perfil | Correo | Quién es | Qué ve |
| :--- | :--- | :--- | :--- |
| **AR** · Dirección y Finanzas | `angel@downtimeco.tech` | Ángel Ramírez | Pareto, tarifas, montos, IA financiera, reportes PDF y WhatsApp |
| **HH** · Operaciones y Mantenimiento | `helio@downtimeco.tech` | Helio Huerta | Mapa de líneas, bandeja de paros, MTTR/MTBF, IA operativa. Sin tarifas |
| **AG** · Operador de Piso | `alondra@downtimeco.tech` | Alondra González | Captura en 3 pasos. **Cero cifras de dinero** |

> ⚠️ **La demo no tiene autenticación real.** Usuarios y contraseña viajan en
> `public/demo/js/usuarios.js` y la separación entre vistas es una redirección
> del navegador. Sirve para enseñar el comportamiento por perfil, no para
> proteger nada. En producto se reemplaza por Supabase Auth con políticas de
> fila; no se le añaden capas de cliente. (El panel de **Administración** sí
> está protegido en el servidor.)

---

## La demo, perfil por perfil

**Operador de Piso** — Línea → Máquina → Estado. Los indicadores de paso son
botones, pero solo permiten **retroceder**: volver a Línea borra la máquina
elegida. Tras cada registro la pantalla regresa sola al Paso 1. No existe forma
de mostrar dinero en esta vista: `operador.js` no lee tarifas.

**Operaciones y Mantenimiento** — Arriba, el **Mapa de Líneas**: cada línea baja
nivel por nivel según la **etapa** de sus máquinas (las de una misma etapa van
en paralelo). Los paros se propagan **en cascada**: si cae un equipo con
respaldo en paralelo, va en ámbar y los demás siguen en verde; si cae la etapa
completa (su único equipo, o todos los paralelos) se vuelve cuello de botella en
rojo y **todo lo que queda aguas abajo pasa a rojo** porque ya no le llega
material. Las flechas de flujo solo corren donde hay producción real y se
detienen desde el primer corte hacia abajo. Debajo: KPIs,
Análisis con IA (desplegable), bandeja de solicitudes, activos, MTTR por turno y
bitácora. «Notificar a Brigada» manda el resumen de paros por WhatsApp.

**Dirección y Finanzas** — Filtro de fechas y turnos, Pareto de causas, impacto
por activo, Análisis con IA (desplegable), **Exportar Reporte Ejecutivo** y
**Enviar Reporte por WhatsApp**. Si generas el reporte y lo envías dentro de los
siguientes **5 minutos**, se reutiliza el mismo PDF en lugar de volver a gastar
tokens de IA.

**Sincronización.** Los tres tableros vuelven a leer la planta cada 10 s y al
volver a su pestaña. En el Operador eso nunca interrumpe una captura en curso, y
en Dirección no vuelve a llamar a la IA.

**Reglas del modelo de planta:**

- **Capacidad por etapa.** Las etapas van en serie; los equipos de una etapa
  van en paralelo. Con N equipos, el paro de uno quita 1/N de la capacidad y se
  cobra esa fracción de la tarifa de la línea. Una etapa de un solo equipo es
  cuello de botella: su paro detiene la línea completa.
- **Turnos.** T1 06–14 · T2 14–22 · T3 22–06. El T3 cruza la medianoche: un paro
  de las 02:00 del día 5 pertenece a la jornada del día 4.
- **Folios.** `L01-SR-C01-20260904-1425-A1`. El orden alfabético coincide con el
  cronológico.
- **El cronómetro corre desde que el operador reporta**, no desde que
  Mantenimiento valida. Validar solo oficializa la causa.

---

## Arranque local (sin instalar nada)

```bash
python local/server/main.py
```

Levanta `http://localhost:3000` y abre el navegador. Requisito único:
**Python 3.8+** (también `local/run.bat` en Windows o `local/run.sh`).

El servidor Python solo replica la API de **leads**. La demo abre en modo
**Local · datos de demostración** (datos en el navegador) y la IA, los PDF y
WhatsApp no están disponibles. Para probar contra Supabase real usa `npm run dev`.

| Bandera | Efecto |
| :--- | :--- |
| `--port 4000` | Cambia el puerto (default `3000`) |
| `--no-browser` | No abre el navegador |
| `--reseed` | Regenera los leads semilla |

---

## Producción (Node + Supabase + Vercel)

```bash
npm install     # Node 22.x
npm test        # 38 pruebas, runner nativo de Node
npm run dev     # vercel dev contra Supabase real
npm run deploy  # despliegue a producción
```

> ⚠️ **No hay despliegue automático.** Subir a `main` no actualiza
> `downtimeos.tech`: hay que correr `npm run deploy` después del push.

### 1 · Base de datos

En **Supabase → SQL Editor**, en este orden:

1. `supabase/EJECUTAR-TODO.sql` — factor 0.20, esquema y semilla de planta,
   integraciones (IA, PDF, WhatsApp) y capacidad por etapa. Es idempotente.
2. `supabase/migraciones/2026-09-06-proveedor-ia.sql` — selector de proveedor de
   IA por área.
3. `supabase/migraciones/2026-09-07-interruptores-integraciones.sql` —
   interruptores de IA / WhatsApp / PDF.

Detalle y diagnóstico de errores en
[supabase/ORDEN-DE-EJECUCION.md](supabase/ORDEN-DE-EJECUCION.md).

### 2 · Variables de entorno

Copia `.env.example` como `.env.local` y registra las mismas en **Vercel →
Settings → Environment Variables**. Tras cambiar una variable hay que volver a
desplegar.

| Grupo | Variables |
| :--- | :--- |
| Supabase | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (solo servidor, omite RLS) |
| Administración | `DASHBOARD_ADMIN_EMAIL`, `DASHBOARD_ADMIN_PASSWORD` |
| IA | `GEMINI_API_KEY`, `GEMINI_MODEL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `AI_FINANZAS_PROVIDER`, `AI_OPERACIONES_PROVIDER` |
| WhatsApp (Meta) | `WHATSAPP_PROVIDER=meta`, `META_WHATSAPP_ACCESS_TOKEN`, `META_WHATSAPP_PHONE_NUMBER_ID`, `META_WHATSAPP_VERIFY_TOKEN`, `META_WHATSAPP_WEBHOOK_SECRET`, `PUBLIC_APP_URL` |
| Destinatarios | `WHATSAPP_OPERACIONES_DESTINATARIO` (paros y brigada), `WHATSAPP_FINANZAS_DESTINATARIO` (reportes) |
| Comportamiento | `WHATSAPP_ALERTAS_ACTIVAS` (alerta automática al registrar un paro), `WHATSAPP_META_USE_TEMPLATES` (actívala solo con las 4 plantillas aprobadas), `REGLA_B2B_ACTIVA` |

Las plantillas de WhatsApp que hay que dar de alta en Meta están en
[docs/whatsapp-plantillas.md](docs/whatsapp-plantillas.md). Mientras
`WHATSAPP_META_USE_TEMPLATES=false`, Meta solo entrega a números que escribieron
al negocio en las últimas 24 horas.

---

## API

**Límite del plan Hobby de Vercel: 12 funciones. Hoy se usan 11.** Varias rutas
comparten función a propósito (se distinguen por método, forma del cuerpo o
reescritura en `vercel.json`); no las separes sin revisar el conteo.

| Ruta | Métodos | Qué hace |
| :--- | :--- | :--- |
| `/api/health` | `GET` | Público: solo `ok` y hora. El detalle de infraestructura (región, base, latencia, total de leads) solo con sesión de administración, y se ve en el panel. También atiende `/api/config` y la sesión de administración (reescrituras) |
| `/api/leads` | `GET` (admin) · `POST` | Lista de prospectos (solo con sesión de administración: trae datos de contacto) · alta pública desde la landing: valida → **recalcula** → guarda |
| `/api/leads/stats` | `GET` | Agregados para los contadores del hero |
| `/api/planta` | `GET` | Todo el estado de la planta en una llamada |
| `/api/planta/eventos` | `POST` `PATCH` `DELETE` | Alta, corrección y cancelación de paros |
| `/api/planta/estados` | `POST` | Cambio de estado de un activo (`RUN` / `STOP`) |
| `/api/planta/solicitudes` | `POST` `PATCH` `DELETE` | Bandeja de Mantenimiento |
| `/api/planta/reportes` | `POST` | Paro atómico desde piso **o** reporte ejecutivo en PDF (según el cuerpo) |
| `/api/ia/resumen` | `POST` · `GET` `PUT` | Análisis con IA · catálogo y selector de proveedor (admin) |
| `/api/whatsapp/alerta` | `GET` `POST` | Envíos manuales y webhooks de Meta/Twilio |
| `/api/observabilidad/uso` | `GET` `POST` | Métricas y interruptores del panel (admin) |

`POST /api/leads` **nunca confía en las cifras del cliente**: revalida y
recalcula toda la aritmética antes de guardar. Tampoco `eventos` recibe el
costo: lo calcula `lib/planta.js` con la tarifa que decide la base.

---

## Modelo de cálculo (calculadora de la landing)

```text
Minutos_Paro_Día  = Activos × Turnos × Minutos_Paro_Turno
Pérdida_Diaria    = (Minutos_Paro_Día / 60) × Costo_Hora_Máquina
Pérdida_Mensual   = Pérdida_Diaria × 25 días operativos
Pérdida_Anual     = Pérdida_Mensual × 12        (= 300 días hábiles)
Recuperación      = Pérdida_Anual × 0.20        (reducción de MTTR)
```

El factor **0.20** vive en cuatro lugares que cambian juntos: `lib/calculo.js`,
`local/server/calculo.py`, `public/js/calculator.js` y la restricción
`leads_ahorro_coherente` de `supabase/schema.sql`. Si cambias los tres primeros
sin migrar la cuarta, la base rechaza cada lead mientras la landing se ve bien.
Detalle en [docs/HANDOFF.md](docs/HANDOFF.md) §7.

Tipo de cambio `17.50 MXN/USD`; los límites de tarifa son por divisa.

---

## Estructura

```text
├── public/                     Todo lo que ve el visitante (sin build)
│   ├── index.html                Landing
│   ├── privacidad.html           Aviso de privacidad
│   ├── css/styles.css            Sistema visual (tokens + componentes)
│   ├── js/calculator.js          Fórmula y formato. Sin acceso al DOM
│   ├── js/app.js                 UI de la landing, precios, formularios, PDF
│   ├── administracion/           Pantalla de acceso del panel privado
│   ├── dashboard/apiGastos/      Panel de administración
│   └── demo/                     Demo DowntimeCO
│       ├── index.html              Acceso por perfil
│       ├── direccion.html · operaciones.html · operador.html
│       ├── css/demo.css
│       └── js/
│           ├── datos.js            ★ Modelo de planta + puente a Supabase
│           ├── usuarios.js         Usuarios, roles y permisos (maqueta)
│           ├── sesion.js           Sesión simulada y barra superior
│           ├── retroactivo.js      Captura de paros ya resueltos
│           └── direccion.js · operaciones.js · operador.js
├── api/                        Serverless Functions (11 de 12)
├── lib/
│   ├── calculo.js                ★ Autoridad de la fórmula financiera
│   ├── planta.js                 ★ Autoridad del costeo de paros
│   ├── integraciones.js          IA, PDF, caché de reportes y WhatsApp
│   ├── administracion.js         Sesión firmada del panel
│   ├── interruptores.js          Encendido/apagado de integraciones
│   └── validacion.js · repositorio.js · supabase.js · entorno.js · http.js
├── middleware.js               Protege /administracion y las rutas admin
├── supabase/                   Esquemas, semillas, migraciones y EJECUTAR-TODO.sql
├── scripts/                    Generadores de SQL
├── test/                       node --test, sin dependencias
├── local/                      Servidor Python para demo sin internet
└── docs/                       HANDOFF, identidad visual, copy y plantillas
```

---

## Stack

| | Herramienta |
| :--- | :--- |
| Frontend | HTML + CSS + JavaScript ES5, sin framework ni build · Inter y JetBrains Mono |
| Backend | Node 22 en Serverless Functions de Vercel (plan Hobby, 60 s por función) |
| Base de datos | Supabase (PostgreSQL + Storage) · `@supabase/supabase-js` |
| IA | `@google/genai` (Gemini) · `@anthropic-ai/sdk` (Claude) |
| PDF | `pdfkit` en el servidor |
| Mensajería | Meta WhatsApp Cloud API (Twilio de respaldo) |
| Pruebas | `node --test` |

---

## Telemetría de la landing

Los eventos van a `window.dataLayer`. Conectar PostHog o GTM es sustituir el
cuerpo de `track()` en `public/js/app.js`.

`view_landing_page` · `hero_ticker_interacted` · `calculator_slider_changed` ·
`calculator_preset_selected` · `currency_switched` · `calculator_pdf_gate_open` ·
`calculator_pdf_requested` · `role_tab_switched` · `pricing_period_switched` ·
`pricing_pilot_clicked` · `request_audit_click` · `request_audit_submit` ·
`scroll_milestone`
