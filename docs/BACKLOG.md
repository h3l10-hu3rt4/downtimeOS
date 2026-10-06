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
| HIST-06 | Paro en piso, reportes y notificaciones (punto 6) | Parcial: falta solo WhatsApp |
| HIST-07 | Suscripción corporativa con comprobante (punto 7) | Hecho |
| HIST-08 | Vencimiento, cancelación y exportación de datos (punto 8) | Hecho |

## Hallazgos
Un solo registro de lo que se encontró probando. Estados: `Abierto` · `Confirmar con Kekas` · `Corregido`. Severidad: Alta (rompe datos/seguridad) · Media · Baja.

| ID | Sev. | Hallazgo | Historia | Estado |
| :--- | :--- | :--- | :--- | :--- |
| HAL-01 | Baja | `scripts/supabase-local.ps1` fallaba en Windows PowerShell 5.1 (stderr de la CLI tratado como error fatal). | HIST-01 | Corregido `63859c4` |
| HAL-02 | Baja | Test `estructura-archivo-sin-plan` fallaba con CRLF (`autocrlf`). | HIST-01 | Corregido `63859c4` |
| HAL-03 | Baja | El E2E buscaba el correo de recuperación por asunto en inglés; los correos están en español. | HIST-02 | Corregido `d47920c` |
| HAL-04 | Media | Los enlaces firmados de Storage (comprobantes y PDF) apuntaban a `host.docker.internal` y no abrían desde el navegador en Docker local. | HIST-07 | Corregido `0ae7c31` |
| HAL-05 | Baja | El tablero de Dirección llama a `POST /api/ia/resumen` al cargar; sin plan activo recibe 402 y deja 2 errores en consola. | HIST-03 | Abierto |
| HAL-06 | Baja | El tablero de Dirección no tiene botón "Cerrar sesión" (Operador y Operaciones sí tienen "Salir"). | HIST-04 | Abierto |
| HAL-07 | Baja | Los correos de invitación llegan con asunto "Confirma tu correo \| DowntimeOS", sin decir que es una invitación. | HIST-04 | Abierto |
| HAL-08 | Media | Operaciones ve dinero real ("Impacto del periodo", "Acumulado" por equipo, campos de costo en `/api/planta`). **Decisión del owner (2026-10-06): es correcto.** Solo el personal de piso (Operador) no debe ver dinero; Operaciones, Finanzas y Dirección sí. | HIST-04/06 | Cerrado: es el comportamiento esperado |
| HAL-09 | Media | Los planes no limitan usuarios: solo limitan equipos (`max_activos`) y plantas (`max_plantas`), y una empresa sin plan activo puede invitar usuarios (201). **Registrado por el owner (2026-10-06):** hoy los planes no limitan usuarios. | HIST-05 | Registrado: sin límite de usuarios por ahora |
| HAL-11 | Baja | Al cerrar un paro corto el panel dice "Paro de 00:00" pero el servidor registra 1 min (redondeo). | HIST-06 | Abierto |
| HAL-12 | Baja | La tableta del Operador muestra "Confirmado en el servidor en 17 s"; sin investigar si es la latencia real del registro o el tiempo desde el reporte. | HIST-06 | Abierto |
| HAL-13 | Alta | El análisis de IA y el PDF filtraban el periodo por día UTC (`hasta`+`T23:59:59.999Z`), no por jornada: un paro de la madrugada del 6 (jornada del 5) quedaba fuera y el reporte afirmaba "cero paros" con $167 en 4 eventos en el tablero. | HIST-06 | Corregido `e7f5321` |
| HAL-14 | **Alta** | **No hay mejora inmediata de Starter a Pro.** "Renovar" solo programa el cambio al fin del periodo, aunque el aviso de límite dice "Amplía tu plan". Starter no incluye IA ni PDF mensual (solo exportación), así que un cliente que quiere Pro hoy no puede obtenerlo sin esperar a que venza. Para las pruebas hubo que vencer el Starter en la base local. Destacado por el owner → historia HIST-15. | HIST-06 | Corregido en HIST-15 |
| HAL-15 | Media | Cada carga de `/direccion` dispara `POST /api/ia/resumen` (razonamiento alto, ~3,400 tokens) sin que el usuario lo pida: recargar la página repetidamente gasta créditos. | HIST-06 | Abierto |
| HAL-10 | Baja | "Guardar datos fiscales" guarda (verificado en BD) pero no vi mensaje de confirmación en pantalla. | HIST-07 | Abierto |

## Siguientes
| ID | Historia | Estado |
| :--- | :--- | :--- |
| HIST-09 | Aprobar/rechazar por WhatsApp con firma de Meta | Por hacer |
| HIST-10 | Revisar la brecha del despliegue de Vercel | Por hacer |
| HIST-11 | Rotar llaves compartidas por chat | Por hacer |
| HIST-12 | Alinear docs de la demo con la cascada gris | Hecho |
| HIST-13 | Correo externo (SMTP/Resend) | Por hacer |
| HIST-14 | Staging para testers desde otras PCs | Por hacer |
| HIST-15 | **Mejora inmediata de Starter a Pro (prioritaria)** | Hecho |

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
| Operaciones | /operaciones | /operaciones, /plantas | /direccion y /operador redirigen; /equipo, /suscripcion, /estructura bloqueados. API sin tarifas (solo mientras no hay eventos; ver HAL-08) | Ver HAL-08 |
| Operador | /operador | /operador, /plantas | /direccion y /operaciones redirigen; /equipo, /suscripcion, /estructura bloqueados | **No**: sin $ ni MXN en pantalla ni en API (único rol sin dinero, por decisión del owner) |

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

**Resultado parcial (2026-10-06):** flujo del paro completo en la UI sobre la empresa A (Starter activo). **No ejecutado: PDF con IA ni WhatsApp** (gastan créditos y envían mensajes reales; esperan decisión del owner).
- **Operador** (`/operador`): línea L-01 → máquina M-03 → Paro → causa "Ruptura de herramental". Queda `solicitud pendiente` y M-03 en STOP **desde la hora del reporte del operador** (10:07:05), sin dinero en pantalla. "Salir" cierra sesión.
- **Operaciones**: ve la solicitud ("1 abierta"), M-03 en ámbar en el mapa (sus gemelas absorben: "50% de capacidad restante") y "Acumulado $33 MXN" a 1 min. "Sí, aprobar" valida (requiere `window.confirm`; el pulso en vivo vuelve caducas las referencias del DOM). Cierre con Panel de Captura → RUN.
- **Evento** (servidor): M-03, 2.00 min, tarifa aplicada $2,000/h (= $4,000/h de la línea × 1/2 por gemelos), costo $66.67 = 2/60×2000. Inicio = hora del reporte del operador, no de la validación. La solicitud queda `cerrada` y la máquina en RUN.
- **Cascada del mapa** (M-01 y M-02 detenidas = etapa Corte completa): M-01/M-02 en **rojo**, M-03/M-04 (etapa aguas abajo) en **gris**; coincide con el invariante. Al cerrar: 2 eventos de 1 min × $2,000/h = $33.33 c/u (suman $4,000/h = tarifa de la línea).
- **Dirección**: costo del periodo $133 MXN (3 eventos, 0.1 h), ≈ $8 USD, recuperable $27 (20%), causa "Ruptura de herramental" 100%, impacto por activo M-03 $67 / M-02 $33 / M-01 $33. Todo coincide con la base.
- **Dinero por rol con datos reales**: Operador → REST 403 y 0 campos de $ en `/api/planta`; Operaciones/Finanzas/Dirección → campos de costo en la API; ningún rol lee costos directo por REST (403).
- **Aislamiento con eventos**: se repitió el script de HIST-05; A ve sus 3 eventos y 6 estados, B ve 0 eventos, 0 filas ajenas, anónimo 401.
- **PDF con IA (2026-10-06, autorizado por el owner):** empresa A reactivada con Starter y luego **Pro anual** (Starter no incluye IA/PDF; HAL-14: se venció el Starter en la base y se solicitó Pro por el flujo normal, activado desde `/administracion`). Proveedor Gemini `gemini-3.5-flash-lite`, ~7,200 tokens en total (4 llamadas). PDF de 1 página guardado en el bucket privado `reportes`.
  - 1ª corrida: el PDF decía "cero paros ni costos" con $167 en el tablero → bug de periodo UTC (HAL-13, corregido y con test `periodo-por-jornada`).
  - 2ª corrida (tras el arreglo): el análisis menciona línea L-01, turno T3 y ruptura de herramental como causa principal, y M-03 con el mayor costo por evento ($66.67); coherente con la base. Copia local en `salidas/reporte-ejecutivo-hist06.pdf` (sin versionar).
- **Incidente de entorno:** Docker Desktop cayó (`containerd: bus error`) porque C: tenía 1.6 GB libres; se extendió C: con 45 GB sin asignar. Tras reiniciar: datos intactos (14 usuarios, 72 eventos), pero la red de Docker quedó a medias (hubo que `supabase stop`/`start`) y la imagen de la app quedó con un `package.json` dañado (se resolvió con `docker compose build --no-cache`). Detalle en `CLAUDE.md`.
- **Pendiente para cerrar:** WhatsApp (requiere `-WhatsAppDesdeEnvLocal` y manda mensajes reales a los números de `.env.local`; decisión del owner).

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
- Exportación de datos: **sí existe** (corrección a la nota anterior): `GET /api/planta/exportacion` entrega la bitácora en bloques (el botón "Descargar historial CSV" de Dirección). Solo Dirección y Finanzas; funciona incluso con plan vencido o cancelado (portabilidad) si el plan incluye la función; cada exportación se audita.

**Resultado (2026-10-06):** todo PASS, con sesiones reales de la empresa A (script sobre la API + estado en la base). El botón CSV de la UI no se pulsó; se probó el endpoint que usa.
- **Exportación (plan activo):** el titular exporta 3 filas con `costo_mxn`; Finanzas también; Operador y Operaciones → 403; cada exportación queda en `planta_auditoria` (`bitacora_exportada`).
- **Cancelación:** el titular la solicita → `cancelacion_programada` "al final del periodo contratado"; `termina_en` no cambia (2027-10-06). Con la cancelación programada el Operador sigue reportando paros (201), Dirección lee la planta y aún se dan de alta equipos: no se corta el acceso antes del fin del periodo.
- **Vencimiento** (fechas forzadas al pasado en la base local, igual que el E2E): al consultar la suscripción se materializa `vencida`; un paro nuevo → 402 "no tiene un plan activo"; **cerrar el paro ya abierto → 200** (RUN, con folio y evento); altas de estructura → 402; la exportación sigue → 200 con el evento de cierre incluido; Dirección sigue leyendo su historial; se puede solicitar un plan nuevo (201).
- **Estado en que queda la empresa A**: plan Starter `vencida` y una solicitud nueva `OC-RENOVACION-HIST08` pendiente. Para completar HIST-06 (PDF/WhatsApp) hay que reactivarla desde `/administracion/suscripciones`.
- No hay un flujo de "exportar todo y borrar la cuenta": la exportación es solo la bitácora de paros.

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

**Resultado (2026-10-06):** hecho. Corregidos `README.md` (vista de Operaciones), `docs/HANDOFF.md` §15.7 (tabla de la cascada) y `docs/IDENTIDAD-VISUAL.md` (fila del Mapa de Líneas, que también decía rojo). Ahora coinciden con `D.cascadaDeLinea()` y `test/cascada-mapa.test.js`: paro total = rojo; lo funcional aguas abajo = gris «A la espera»; un paro propio conserva su color. Solo documentación, sin cambios de código.

### HIST-13 y HIST-14
- Correo externo: verificar dominio/remitente, configurar SMTP de Supabase Auth y probar confirmación, invitación y recuperación.
- Staging: entorno aislado con acceso y correo de prueba; no exponer el Docker local ni los puertos de Supabase.

### HIST-15 · Mejora inmediata de Starter a Pro (prioritaria)
- Hallazgo HAL-14: con un plan activo no se puede pasar a otro plan hasta que termina el periodo; "renovar" programa el siguiente ciclo y el aviso de límite ("Amplía tu plan") promete algo que hoy no existe.
- Definir con Kekas la regla comercial: ¿cambio inmediato con prorrateo del pago, o pago nuevo y activación manual desde `/administracion`? ¿Qué pasa con el periodo ya pagado de Starter?
- Implementar el flujo (solicitud de mejora → pago/comprobante → activación) sin vencer la suscripción actual, conservando la auditoría, y probarlo con el titular y con el panel admin.
- Criterio: un titular con Starter activo solicita Pro, el admin lo activa y el titular obtiene IA y PDF mensual de inmediato, sin esperar al vencimiento. Añadir tests y registrar el resultado aquí.

**Regla comercial (owner, 2026-10-06):** Pro se solicita y paga por el flujo normal; al activarlo reemplaza a Starter de inmediato; **sin prorrateo** (se cobra el periodo completo de Pro y el tiempo restante de Starter no se acredita ni se reembolsa).

**Resultado (2026-10-06):** hecho. `npm test` 500/500.
- Migración `20261006000100_mejora_inmediata_plan.sql`: RPC `organizacion_mejorar_plan` (solo plan pagado vigente → plan superior; importe = precio de lista completo), columna `mejora_de_suscripcion_id`, estado nuevo `reemplazada`, y `organizacion_admin_resolver_solicitud` cierra el plan vigente y activa el nuevo en la misma transacción. Una mejora no se puede convertir en piloto; sí se puede rechazar (Starter sigue igual).
- API: acción `mejorar` en `POST /api/planta/suscripcion`. UI: en `/suscripcion`, elegir un plan superior al vigente cambia el formulario a "Mejorar plan ahora" y explica que no hay prorrateo; el panel admin marca la solicitud como "mejora inmediata" y el botón dice "Confirmar pago y reemplazar el plan vigente". Elegir el mismo plan o uno menor sigue siendo una renovación al fin del periodo.
- Auditoría: `mejora_plan_solicitada` y `mejora_pago_verificado_plan_reemplazado` (guarda el plan reemplazado y su fecha de fin original).
- Validación local por API con `node scripts/qa/mejora.mjs` (empresa B, 31 comprobaciones, todo PASS): con Starter la IA responde 403; al solicitar Pro el importe es 1788 USD (anual completo) y Starter sigue activo; tras validar el admin, Starter queda `reemplazada`, Pro `activa` desde ese instante por 12 meses y el candado de IA deja pasar (503 por llaves vacías, sin gastar créditos). `aislamiento.mjs` sigue en PASS.
- No se tocó WhatsApp. La app local se levantó sin `-WhatsAppDesdeEnvLocal` ni `-IADesdeEnvLocal`.
- **No ejecutado:** revisión visual de `/suscripcion` con sesión en el navegador integrado (el entorno bloqueó leer las credenciales de prueba para escribirlas en el formulario); la página compila y responde 200. PDF mensual real con Pro (usa el mismo candado `exigirPlanActivo` que la IA). El E2E automático no cubre la mejora.
- Pendiente menor: si existe un próximo periodo ya contratado (renovación pagada), la mejora se rechaza hasta cancelarlo; no hay reembolso automático de nada (gestión manual, como hasta ahora).
