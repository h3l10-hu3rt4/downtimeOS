# DowntimeOS

MVP B2B para registrar paros de producción, asignar equipos por rol y consultar
su impacto financiero auditable (`$/minuto`). La app actual usa Next.js, React,
Supabase Auth y PostgreSQL; la demo DowntimeCO es un módulo separado para mostrar
el producto.

| Área | Rutas |
| :--- | :--- |
| Acceso y alta de cuenta | `/acceso`, `/registro`, `/recuperar`, `/activar` |
| Configuración y operación | `/configurar-planta`, `/direccion`, `/operaciones`, `/operador` |
| Equipo y cuenta | `/equipo`, `/plantas`, `/suscripcion` |
| Landing y demo | `/`, `/demo/` |
| Administración interna | `/administracion` |

La disponibilidad y configuración de producción deben verificarse por ambiente;
no se debe inferir que todos los flujos están listos por el estado de la landing.

Documentación técnica en [`docs/`](docs/): invariantes y trampas en
[HANDOFF](docs/HANDOFF.md), identidad visual en
[IDENTIDAD-VISUAL](docs/IDENTIDAD-VISUAL.md).

---

## Estado actual

| Área | Estado |
| :--- | :--- |
| App MVP | E2E integral revalidado el 2026-10-05 en Supabase Local desechable con 52 migraciones: cuenta/confirmación, dos empresas aisladas, configuración, pagos/piloto, recuperación, invitaciones para cuatro roles, operación, permisos y vencimiento. Se confirmó que el plan vencido bloquea nuevos paros pero permite cerrar el existente. No equivale a que testers reales hayan completado el recorrido ni a entrega de correo externo |
| Automatización | Revalidado el 2026-10-05: `node --test` (482/482), `npm run smoke` (20 rutas, 10 pantallas con estilos y 26 APIs protegidas), `npm run qa:ui:public` (10 verificaciones visuales/flujo sin escrituras) y build Docker correcto. `npm run docker:status` confirma app y Supabase saludables. La suite incluye reglas de pagos, roles y periodos con servicios simulados; el E2E integral previo pasó en Supabase desechable con Mailpit. Mailpit acredita correo local, no entrega externa por SMTP/Resend |
| Desarrollo local | La app Docker `http://localhost:3000` está saludable y conectada al Supabase Local de este repo; las 52 migraciones locales están aplicadas. Los datos persisten y no son de producción. La instancia es solo para esta PC: no la compartas por LAN. Las pestañas de `localhost:3001`/`3002` pueden pertenecer a servidores temporales ya detenidos |
| Integraciones en el contenedor local | Supabase y el panel administrativo están configurados. Las claves de IA y Meta están en `.env.local`, pero no se cargaron al contenedor: el análisis con Gemini/Anthropic no puede completarse y WhatsApp permanece desactivado aunque los interruptores estén activos en el archivo local. Para activarlas se requiere optar explícitamente por `-IADesdeEnvLocal` y/o `-WhatsAppDesdeEnvLocal`; WhatsApp puede enviar mensajes reales y la IA consume créditos |
| Pendiente para testers | Diabtrack tiene un piloto local Starter de una planta hasta el 2026-10-19; permite probar tableros en esta instalación. Los correos llegan a Mailpit, no a Gmail/Outlook. `localhost:3000` solo está disponible en esta PC; para probar desde otras PCs hace falta staging. SMTP externo/Resend, proveedores de WhatsApp/IA, rendimiento de carga y emisión fiscal siguen sin certificarse |
| Demo DowntimeCO | Módulo de demostración aparte; sus perfiles no equivalen a las cuentas reales de `/registro` |

Para levantar y recorrer el producto local, sigue la [guía para testers](docs/GUIA-PRUEBAS-USUARIO.md). No ejecutes `docker compose down -v` ni `supabase stop --no-backup`: eliminarían datos locales que quieras conservar.

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
> proteger nada. Las cuentas reales usan las pantallas de producto y Supabase
> Auth; no uses estas credenciales de demo para entrar a `/acceso`. El panel de
> **Administración** requiere sus credenciales de servidor configuradas.

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

## Desarrollo local

El flujo de la app actual requiere Docker Desktop, Node.js 22, dependencias npm y
Supabase Local. En una instalación nueva, desde la raíz del repositorio:

```powershell
npm install
.\scripts\supabase-local.ps1 start
npx supabase migration list --local --workdir .
npm run docker:local
```

El lanzador fuerza Mailpit como destino local para confirmaciones, invitaciones
y recuperación, e ignora cualquier `MAIL_*` heredada o presente en `.env.local`.
Abre `http://localhost:54324` para consultar los mensajes de prueba. Resend y la
entrega a Gmail/Outlook quedan pendientes para una etapa posterior: no agregues
credenciales de Resend ni cambies el SMTP local ahora. Para habilitarlo después
habrá que verificar el dominio/remitente, guardar la clave en el entorno seguro,
configurar SMTP de Supabase Auth y probar confirmación, invitación, recuperación
y avisos de suscripción de extremo a extremo.

La primera inicialización aplica la cadena versionada de migraciones de
`supabase/migrations`; puede tardar varios minutos y descarga imágenes de
Supabase. `migration list` es una consulta de solo lectura: confirma que la
cadena versionada local coincide con el historial de ese Supabase antes de
probar. La app queda en `http://localhost:3000`.

**No levantes `npm run dev` directamente con el `.env.local` actual:** ese
archivo contiene una URL de Supabase alojada, mientras que el Docker local se
configura explícitamente contra Supabase Local/QA. Usa `npm run docker:local`
para evitar que las pruebas del navegador apunten por accidente al proyecto
remoto. Para el equipo, tampoco compartas esa base QA mientras sus puertos
auxiliares sigan publicados en todas las interfaces.

`docker-local.ps1` selecciona automáticamente el proyecto Supabase del repo
solo si está activo. Si solo encuentra el stack histórico de `%LOCALAPPDATA%`,
se detiene y exige que indiques explícitamente `-SupabaseWorkdir`; nunca lo usa
por fallback. Para trabajo de equipo, usa un proyecto/datos locales desechables,
no el Supabase histórico. El lanzador no crea, reinicia ni borra bases. Acepta
`-ComposeArgs ps` para consultar el contenedor, pero rechaza otros comandos
distintos del `up -d --build` predeterminado y `ps`.

El modo `ps` consulta directamente Docker por las etiquetas de este checkout;
no necesita ejecutar Supabase CLI, interpolar Compose ni cargar claves. Muestra
por separado la app y el Supabase local, y sigue siendo de solo lectura. Para
levantar la app, el script sí valida y carga temporalmente las claves del
Supabase local; nunca toma claves remotas de `.env.local`.

```powershell
.\scripts\docker-local.ps1 -ComposeArgs ps
```

No ejecutes `docker compose` directamente sin haber cargado primero las
variables locales que exige el archivo Compose.

El panel interno y la aprobación manual de pagos usan únicamente
`DASHBOARD_ADMIN_EMAIL` y `DASHBOARD_ADMIN_PASSWORD` de `.env.local`. El comando
`npm run docker:local` pasa solo esas dos variables al contenedor local; no
carga el resto de `.env.local`. No pongas estas credenciales en el repositorio
ni reutilices las de producción. Si quieres levantar la app sin ese panel,
ejecuta `scripts/docker-local.ps1` directamente sin `-AdminDesdeEnvLocal`.

Para habilitar Meta en una prueba local de forma explícita, usa
`-WhatsAppDesdeEnvLocal` al levantar la app:

```powershell
.\scripts\docker-local.ps1 -WhatsAppDesdeEnvLocal
```

Esta opción solo pasa la lista permitida de variables de WhatsApp desde
`.env.local`; no importa las claves de Supabase, Resend ni IA. Las variables se
restauran en PowerShell al terminar el lanzador. Si
`WHATSAPP_ALERTAS_ACTIVAS=true`, registrar paros puede enviar mensajes reales a
los destinatarios configurados: úsala solo cuando quieras probar esa entrega.

Para habilitar Gemini/Anthropic localmente, usa la opción independiente
`-IADesdeEnvLocal`:

```powershell
.\scripts\docker-local.ps1 -IADesdeEnvLocal
```

El lanzador valida que cada proveedor seleccionado tenga su llave y no imprime
ni conserva las variables temporales al terminar. Las llaves no se cargan sin
esta opción. La app solo contacta al proveedor cuando se solicita un análisis;
esa acción envía los datos usados para el reporte al proveedor de IA elegido.

Resend no se pasa al contenedor local ni configura correos de autenticación. La
implementación de entrega externa queda pendiente; durante el MVP, las pruebas
de correo se hacen exclusivamente en Mailpit.

### E2E local

El E2E crea usuarios Auth, empresas, configuración, invitaciones, pagos y
archivos sintéticos; **no los elimina al terminar**. Ejecútalo únicamente
contra una instancia Supabase Local desechable y vacía, no contra el stack
histórico ni una base compartida. Desde PowerShell, después de iniciar el
Supabase del repo y verificar su historial:

```powershell
.\scripts\e2e-mvp-local.ps1 -SupabaseWorkdir . -ConfirmDisposableDatabase
```

El preflight falla cerrado si encuentra usuarios, organizaciones ajenas,
registros en tablas operativas/de tenant o archivos en los buckets privados de
comprobantes/reportes, y lo hace antes de crear fixtures. Un resultado E2E no es
repetible sobre la misma base porque los datos sintéticos se conservan; prepara
otro entorno realmente desechable para una nueva corrida. No uses `supabase db
reset`, `docker compose down -v` ni `prune` como método de limpieza de una base
que contenga datos que quieras conservar. Lee las líneas `NO EJECUTADO` del
resumen: el runner puede omitir cobertura de correo y aprobación administrativa
si esos servicios/credenciales no están disponibles.

### Modo estático histórico (landing/demo)

El servidor Python de abajo solo sirve para la landing y la demo local antigua;
no levanta la app actual de cuentas, equipos ni suscripciones.

```bash
python local/server/main.py
```

Levanta `http://localhost:3000` y abre el navegador. Requisito único:
**Python 3.8+** (también `local/run.bat` en Windows o `local/run.sh`).

El servidor Python solo replica la API de **leads**. La demo abre en modo
**Local · datos de demostración** (datos en el navegador) y la IA, los PDF y
WhatsApp no están disponibles. No uses `npm run dev` para probar el producto:
puede heredar el destino de Supabase definido en `.env.local`. Para una prueba
local aislada sigue la [guía para testers](docs/GUIA-PRUEBAS-USUARIO.md), que usa
Docker y Supabase Local. Usa `npm run dev` solo en un entorno configurado
deliberadamente y después de verificar a qué proyecto de Supabase apunta.

| Bandera | Efecto |
| :--- | :--- |
| `--port 4000` | Cambia el puerto (default `3000`) |
| `--no-browser` | No abre el navegador |
| `--reseed` | Regenera los leads semilla |

---

## Despliegue posterior al MVP

El destino elegido para desplegar el producto terminado es **DigitalOcean**.
No se hará despliegue en Vercel; el dominio publicado allí no forma parte del
flujo de pruebas ni del criterio de finalización del MVP. La preparación del
despliegue en DigitalOcean se abordará después de que el equipo valide el MVP.

Para probar ahora, usa la instalación local con Docker descrita en
[la guía para testers](docs/GUIA-PRUEBAS-USUARIO.md). Para pruebas coordinadas
desde varias computadoras se necesitará un entorno de prueba aislado; no expongas
el Docker local ni sus puertos de Supabase a la red.

```bash
npm install
npm test
npm run build
```

Antes del despliegue posterior al MVP se definirán y verificarán la imagen
Docker, persistencia y respaldos de PostgreSQL, secretos, SMTP, HTTPS, tareas
programadas y controles de acceso en el entorno de DigitalOcean. No se debe
inferir que el despliegue está listo solo porque `npm run build` pasa.

### Base de datos

**La única cadena soportada para una instalación nueva es `supabase/migrations`,
ejecutada por Supabase CLI en un proyecto local desechable.** `supabase/migraciones`,
`EJECUTAR-TODO.sql` y `ORDEN-DE-EJECUCION.md` contienen material de evolución
histórica, no son una ruta alternativa para instalar el MVP actual. No copies
ni ejecutes esos SQL desde el Dashboard/SQL Editor. `supabase start` tampoco
vacía un volumen existente: antes de E2E verifica historial y datos, y detente
si no son los del proyecto limpio. No ejecutes `supabase db reset`, `docker
compose down -v` ni comandos de prune sobre una base/volumen que debas conservar.
El detalle y los riesgos conocidos están en
[supabase/ORDEN-DE-EJECUCION.md](supabase/ORDEN-DE-EJECUCION.md) y
[docs/MVP-CUENTAS-SUSCRIPCIONES.md](docs/MVP-CUENTAS-SUSCRIPCIONES.md). La cadena
de instalación solo debe ejecutarse automáticamente en un proyecto Supabase
vacío y desechable; conserva y respalda cualquier instancia que tenga datos.

### 2 · Variables de entorno

Copia `.env.example` como `.env.local` para el trabajo local. Las variables del
entorno DigitalOcean se configurarán de forma segura al preparar ese despliegue;
no se suben secretos al repositorio.

| Grupo | Variables |
| :--- | :--- |
| Supabase | `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (solo servidor, omite RLS; `SUPABASE_SERVICE_ROLE_KEY` es compatibilidad legacy) |
| Correo de autenticación | Confirmación, invitaciones y recuperación salen por **SMTP de Supabase Auth**. En local el destino es siempre Mailpit (`localhost:54324`). Resend/SMTP externo y la entrega real quedan pendientes para una etapa posterior. |
| Administración | `DASHBOARD_ADMIN_EMAIL`, `DASHBOARD_ADMIN_PASSWORD` |
| Avisos de suscripción | `CRON_SECRET`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL` (variables para integración futura; el Compose local no las acepta todavía) |
| IA | `GEMINI_API_KEY`, `GEMINI_MODEL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `AI_FINANZAS_PROVIDER`, `AI_OPERACIONES_PROVIDER` |
| WhatsApp (Meta) | `WHATSAPP_PROVIDER=meta`, `META_WHATSAPP_ACCESS_TOKEN`, `META_WHATSAPP_PHONE_NUMBER_ID`, `META_WHATSAPP_VERIFY_TOKEN`, `META_WHATSAPP_APP_SECRET`, `PUBLIC_APP_URL` |
| Destinatarios | `WHATSAPP_OPERACIONES_DESTINATARIO` (paros y brigada), `WHATSAPP_FINANZAS_DESTINATARIO` (reportes) |
| Comportamiento | `WHATSAPP_ALERTAS_ACTIVAS` (alerta automática al registrar un paro), `WHATSAPP_META_USE_TEMPLATES` (actívala solo con las 4 plantillas aprobadas), `REGLA_B2B_ACTIVA` |

Las plantillas de WhatsApp que hay que dar de alta en Meta están en
[docs/whatsapp-plantillas.md](docs/whatsapp-plantillas.md). Mientras
`WHATSAPP_META_USE_TEMPLATES=false`, Meta solo entrega a números que escribieron
al negocio en las últimas 24 horas.

---

## API

Las rutas API de Next.js se enrutan mediante el adaptador catch-all de este
repositorio. La configuración de `vercel.json` se conserva por compatibilidad
histórica, pero Vercel no es el destino elegido para publicar el MVP.

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
| Frontend | Next.js App Router, React, JavaScript, CSS y páginas HTML de la demo histórica |
| Backend | Node.js 22, rutas API de Next.js y adaptador catch-all HTTP |
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
