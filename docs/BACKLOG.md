# Backlog

Owner: Helio Huerta · Dirección técnica: Kekas · Rama: `Angel_Dev`

Cómo usarlo: una historia por sesión de Claude Code. Estados: `Por hacer` · `En curso` · `Hecho`.
Una historia está hecha cuando cumple sus criterios y queda registrado el resultado (qué pasó, qué falló).

## Sprint actual: validar el MVP de punta a punta en local (pedido de Kekas)
Todo se prueba en Docker + Supabase Local, nunca contra producción. Guía manual: `docs/GUIA-PRUEBAS-USUARIO.md`.

| ID | Historia (punto de Kekas) | Estado |
| :--- | :--- | :--- |
| HIST-01 | Entorno local listo (requisito de todo lo demás) | Hecho |
| HIST-02 | E2E automático en base desechable | Hecho |
| HIST-03 | Registro, primera planta y configuración (puntos 1 y 2) | Hecho |
| HIST-04 | Roles y permisos con cuatro usuarios (punto 3) | Hecho |
| HIST-05 | Aislamiento entre empresas y límites del plan (puntos 4 y 5) | Hecho |
| HIST-06 | Paro en piso, reportes y notificaciones (punto 6) | Por hacer |
| HIST-07 | Suscripción corporativa con comprobante (punto 7) | Hecho |
| HIST-08 | Vencimiento, cancelación y exportación de datos (punto 8) | Por hacer |

## Hallazgos
Un solo registro de lo que se encontró probando. Estados: `Abierto` · `Confirmar con Kekas` · `Corregido`. Severidad: Alta (rompe datos/seguridad) · Media · Baja.

| ID | Sev. | Hallazgo | Historia | Estado |
| :--- | :--- | :--- | :--- | :--- |
| HAL-01 | Baja | `scripts/supabase-local.ps1` fallaba en Windows PowerShell 5.1 (stderr de la CLI tratado como error fatal). | HIST-01 | Corregido `63859c4` |
| HAL-02 | Baja | Test `estructura-archivo-sin-plan` fallaba con CRLF (`autocrlf`). | HIST-01 | Corregido `63859c4` |
| HAL-03 | Baja | El E2E buscaba el correo de recuperación por asunto en inglés; los correos están en español. | HIST-02 | Corregido `d47920c` |
| HAL-04 | Media | Los enlaces firmados de Storage (comprobantes y PDF) apuntaban a `host.docker.internal` y no abrían desde el navegador en Docker local. | HIST-07 | Corregido `0ae7c31` |
| HAL-05 | Baja | El tablero de Dirección llama a `POST /api/ia/resumen` al cargar; sin plan activo recibe 402 y deja 2 errores en consola. | HIST-03 | Abierto |
| HAL-06 | Baja | No hay botón "Cerrar sesión" en los tableros; solo `/activar` ofrece cambiar de cuenta. | HIST-04 | Abierto |
| HAL-07 | Baja | Los correos de invitación llegan con asunto "Confirma tu correo \| DowntimeOS", sin decir que es una invitación. | HIST-04 | Abierto |
| HAL-08 | Media | `/operaciones` muestra "IMPACTO DEL PERIODO · $X MXN" aunque la API no le manda tarifas. La política de dinero para Operaciones no está documentada. | HIST-04 | Confirmar con Kekas |
| HAL-09 | Media | Los planes solo limitan equipos y plantas (`max_activos`, `max_plantas`); no existe límite de usuarios, y una empresa sin plan activo puede invitar usuarios (201). | HIST-05 | Confirmar con Kekas |
| HAL-10 | Baja | "Guardar datos fiscales" guarda (verificado en BD) pero no vi mensaje de confirmación en pantalla. | HIST-07 | Abierto |

## Siguientes
| ID | Historia | Estado |
| :--- | :--- | :--- |
| HIST-09 | Aprobar/rechazar por WhatsApp con firma de Meta | Por hacer |
| HIST-10 | Revisar la brecha del despliegue de Vercel | Por hacer |
| HIST-11 | Rotar llaves compartidas por chat | Por hacer |
| HIST-12 | Alinear docs de la demo con la cascada gris | Por hacer |
| HIST-13 | Correo externo (SMTP/Resend) | Por hacer |
| HIST-14 | Staging para testers desde otras PCs | Por hacer |

## Detalle del sprint

### HIST-01 · Entorno local listo
- WSL2 y Docker Desktop funcionando. Hecho el 2026-10-06.
- `npm install`, Supabase Local arriba y `npx supabase migration list --local --workdir .` sin diferencias.
- `npm run docker:local` deja la app en http://localhost:3000 y `npm run docker:status` la marca saludable.
- Mailpit abre en http://localhost:54324.

**Resultado (2026-10-06):** todo verde. 52 migraciones sin diferencias, app saludable en :3000, Mailpit responde, `npm test` 488/488.
Hallazgos corregidos: (1) `scripts/supabase-local.ps1` fallaba en PowerShell 5.1 porque el stderr de la CLI se volvía error fatal; (2) `test/estructura-archivo-sin-plan.test.js` fallaba con CRLF (autocrlf). Nota: si Edge u otro proceso ocupa el puerto 54322, `supabase start` falla con "ports are not available"; cerrar el proceso y reintentar.

### HIST-02 · E2E automático
Correr primero, en una base nueva: crea datos y no los borra, y el preflight falla si la base no está vacía.
- `.\scripts\e2e-mvp-local.ps1 -SupabaseWorkdir . -ConfirmDisposableDatabase`.
- Anotar qué suites pasan y leer las líneas `NO EJECUTADO` (correo y aprobación administrativa pueden omitirse).
- Una segunda corrida exige otra base desechable.

**Resultado (2026-10-06):** 2ª corrida en verde, código 0, todas las suites PASS (RLS/PostgREST, registro y confirmación por Mailpit, 2 empresas aisladas, suscripción/pago/comprobante PDF/panel admin, recuperación de contraseña, límite Starter, invitaciones de los 4 roles, ciclos de paro con aprobación/descarte/retiro, 64 ciclos sin colisión de folios, vencimiento de plan).
NO EJECUTADO: UI autenticada por rol en Edge (requiere `-VisualQA`/`MVP_E2E_BROWSER=1`); transición automática por calendario; cargas 10k/100k; CFDI/retención; proveedores externos (WhatsApp, PDF, IA, SMTP).
La 1ª corrida falló en recuperación de contraseña por un patrón de asunto en inglés en `scripts/e2e-mvp-local.mjs` (corregido en `d47920c`) y exigió `db reset`. Quedaron datos de prueba en la base (titulares A y B del 2026-10-06): una nueva corrida requiere otro reset.

### HIST-03 · Registro, primera planta y configuración
- Registrar una empresa y su primera planta; el flujo lleva directo al asistente de configuración, sin pasos intermedios.
- Dato de Kekas: el asistente está en http://localhost:3000/configurar-planta y el correo de verificación llega ahí al poner el correo (en local, a Mailpit).
- Dar de alta líneas, etapas y máquinas reales con su costo/hora; verificar que el cálculo de pérdidas usa esos costos.

**Resultado (2026-10-06):** hecho en el navegador integrado contra la app local (:3000). Empresa "Manufacturas HIST03", planta "Planta Norte", titular hist03-titular@example.test (credenciales en `.env.hist03.local`, ignorado por git).
- Registro → correo de confirmación en Mailpit → al abrir el enlace, la app va directo a `/configurar-planta` (paso 2 de 3) y al guardar a `/equipo` (paso 3 de 3). Sin pasos intermedios.
- Asistente: plantilla "máquinas paralelas" editada a 1 línea (L-01), 4 máquinas en 2 etapas (Corte 2×$1,200/h, Prensado 2×$800/h), M-01 como cuello de botella. La base lo persistió idéntico (`planta_activos`, `planta_lineas`).
- Costo: el tablero de Dirección muestra "costo de un paro" = tarifa de la línea ($4,000/h) × capacidad perdida de la etapa (1/2 por equipos gemelos) = $2,000/h para las 4 máquinas. Es el modelo de `tarifaAplicable` en `public/demo/js/datos.js`, no un error.
- Dirección no puede abrir `/operador` (redirige a `/direccion?bloqueado=operador`), como debe ser.
**Pendiente:** verificar el costo con un paro real (lo reporta un Operador, requiere invitarlo: HIST-04/HIST-06). El servidor es quien recalcula la cifra final.
**Observación:** el tablero de Dirección llama a `POST /api/ia/resumen` al cargar y recibe 402 si la empresa no tiene plan activo (2 errores en consola). Revisar si es esperado o conviene no llamarlo sin plan.

### HIST-04 · Roles y permisos
- Invitar a Dirección, Finanzas, Operaciones y Operador (correos en Mailpit) y entrar con cada uno.
- Registrar para cada rol qué pantallas y acciones ve y cuáles se le bloquean; el Operador no ve dinero.

**Resultado (2026-10-06):** empresa "Manufacturas HIST03" (titular + 4 invitados `hist03-<rol>@example.test`, credenciales en `.env.hist03.local`, ignorado por git). Las 4 invitaciones se enviaron desde `/equipo`, llegaron a Mailpit y se aceptaron con su enlace + contraseña propia. Cada rol aterriza en su pantalla.

| Rol | Aterriza en | Pantallas que abre | Bloqueado | Dinero |
| :--- | :--- | :--- | :--- | :--- |
| Titular (Dirección+Finanzas) | /direccion | todo (equipo, suscripción, estructura) | — | Sí |
| Dirección (sin delegación) | /direccion | /direccion, /estructura (edición completa), /plantas | /equipo y /suscripcion (aviso "requiere autorización"); /operaciones y /operador redirigen | Sí (API trae tarifas) |
| Finanzas | /direccion | /direccion, /plantas | /estructura ("Solo Dirección puede cambiar…"), /equipo, /suscripcion; /operaciones y /operador redirigen. API estructura 403 | Sí |
| Operaciones | /operaciones | /operaciones, /plantas | /direccion y /operador redirigen; /equipo, /suscripcion, /estructura bloqueados. API sin tarifas | Ver nota 1 |
| Operador | /operador | /operador, /plantas | /direccion y /operaciones redirigen; /equipo, /suscripcion, /estructura bloqueados | **No**: sin $ ni MXN en pantalla ni en API |

API con el token de cada rol: `/api/planta/equipo`, `/api/planta/suscripcion` → 403 para los 4 invitados; `/api/planta/estructura` → 200 solo Dirección, 403 en Finanzas/Operaciones/Operador; `/api/planta` incluye tarifas solo para Dirección y Finanzas. `/administracion` siempre lleva al login administrativo aparte. `/plantas` solo lista la planta propia.

**Notas / a confirmar:**
1. `/operaciones` muestra la tarjeta "IMPACTO DEL PERIODO · $X MXN" (hoy $0, sin eventos), aunque la API no le manda tarifas. La política de dinero para Operaciones no está en HANDOFF: confirmar con Kekas si debe verlo o no (el invariante solo prohíbe al Operador).
2. La restricción de pantallas es del lado cliente (las páginas responden 200 y redirigen tras cargar la sesión); lo que protege los datos es el 403/redacción de la API, que sí se comprobó.
3. No hay botón "Cerrar sesión" en los tableros; solo `/activar` ofrece cambiar de cuenta.
4. Los correos de invitación llegan con asunto "Confirma tu correo | DowntimeOS", sin indicar que es una invitación.
5. Falta probar acciones por rol con datos reales (paro, aprobación): HIST-06.

### HIST-05 · Aislamiento y límites del plan
- Crear dos empresas y comprobar que ninguna ve datos, eventos, máquinas ni reportes de la otra (también por URL directa y por API).
- Verificar que los límites del plan activo (plantas, usuarios, etc.) se aplican.

**Resultado (2026-10-06):** dos empresas reales, A "Manufacturas HIST03" (Planta Norte, Starter activo) y B "Empresa B HIST05" (Planta Sur, sin plan), ambas con los mismos códigos `L-01`/`M-01` para detectar cruces. Además existen en la base las empresas del E2E.
- **Aislamiento: todo PASS** (script con sesión real de cada titular). La API con la planta ajena en `x-downtimeos-planta` devuelve 403 en `/api/planta`, `estado-vivo`, `equipo`, `suscripcion` y `estructura`, sin datos ajenos; escribir en la planta ajena (POST estructura, PATCH/DELETE `planta_activos`, INSERT `planta_lineas`) → 403 y 0 filas afectadas. Lectura directa por PostgREST de las 14 tablas `planta_*`: 0 filas de otra planta; `plantas` y `organizaciones` muestran 1 fila. Sin sesión: 401.
- **Límites (Starter activo):** el equipo 5 entra (201) y el 6 se rechaza `409 PLAN_ASSET_LIMIT`; archivar uno libera lugar. Segunda planta → `403 "no incluida en el plan"`. Empresa B sin plan: alta de equipo y de planta → 402.
- No hay límite de usuarios en el modelo de planes (HAL-09). Eventos y reportes se re-probarán con datos reales al cerrar HIST-06.
- Quedaron M-05 y M-06 archivados en la empresa A (pruebas de límite).

### HIST-06 · Paro, reportes y notificaciones
- Registrar un paro como Operador, validarlo como Operaciones y cerrarlo; revisar costos y mapa.
- Generar el reporte PDF con IA (requiere `-IADesdeEnvLocal`; consume créditos).
- Confirmar notificaciones por WhatsApp (requiere `-WhatsAppDesdeEnvLocal`; envía mensajes reales a los números configurados).

### HIST-07 · Suscripción corporativa
- Solicitar un plan, adjuntar orden de compra o comprobante y activarlo manualmente desde `/administracion`.

**Resultado (2026-10-06):** flujo completo en la UI sobre la empresa A. Admin de prueba generado para el contenedor (credenciales en `.env.hist03.local`); no se usó el admin de `.env.local`.
- Titular A solicita Starter anual con orden de compra `OC-HIST03-001` (USD 588, estado "En revisión", pago pendiente), guarda datos fiscales (RFC genérico, persistido en `organizacion_facturacion`) y adjunta un PDF de comprobante (estado `comprobante_recibido`).
- En `/administracion/suscripciones` el admin ve la solicitud, abre el comprobante por enlace temporal y pulsa "Confirmar pago externo y activar" (pide `window.confirm`). Resultado: suscripción `activa` del 2026-10-06 al 2027-10-06, pago `verificado`, con `verificado_por_admin` y fecha.
- El titular ve "STARTER · Activa · Acceso hasta 6 oct 2027" con opciones de renovar y cancelar.
- Bug corregido en el camino: HAL-04 (enlaces firmados). Para el admin local se recreó el contenedor con credenciales de prueba (`DOWNTIMEOS_LOCAL_DASHBOARD_ADMIN_*`).

### HIST-08 · Vencimiento, cancelación y exportación
- Vencimiento: un plan vencido bloquea nuevos paros pero deja cerrar el abierto.
- Cancelación: se programa al fin del periodo pagado y no corta el acceso antes.
- Exportación de datos: no encuentro nada que la implemente en el repo ni en las docs. Confirmar con Kekas si debe existir; si falta, crear una historia propia.

## Detalle de los siguientes

### HIST-09 · WhatsApp con firma de Meta
- Obtener `META_WHATSAPP_APP_SECRET` de Kekas (falta en su `.env.local`); sin ella el webhook rechaza los mensajes.
- Un rechazo con firma válida deshace el paro; con firma inválida o ausente responde 403.

### HIST-10 · Brecha del despliegue de Vercel
- Leer los commits "clarify live deployment security gap" y "confirm active Vercel deployment root cause".
- Decidir: apagar, proteger o retirar el despliegue. No desplegar nada sin autorización.

### HIST-11 · Rotar llaves
- Rotar: Supabase service role, Anthropic, Gemini, Twilio, token de Meta y contraseña de administración.
- Actualizar `.env.local` y los secretos del entorno de despliegue.

### HIST-12 · Docs de la demo
- README y HANDOFF §15.7 dicen que lo de aguas abajo pasa a rojo; la regla vigente es gris "A la espera".

### HIST-13 y HIST-14
- Correo externo: verificar dominio/remitente, configurar SMTP de Supabase Auth y probar confirmación, invitación y recuperación.
- Staging: entorno aislado con acceso y correo de prueba; no exponer el Docker local ni los puertos de Supabase.
