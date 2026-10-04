# MVP DowntimeOS · cuentas, planta y suscripciones

Este documento distingue el comportamiento objetivo del MVP, lo que ya está
preparado en código y lo que todavía requiere una decisión o una prueba real.
Las migraciones `20261003000200` y `20261003000300` están aplicadas en el
Supabase Local de desarrollo (historial actual 36/36 alineado). Esto no implica
que estén aplicadas en Supabase remoto ni reemplaza la validación del ambiente
al que se vaya a desplegar.

> **Vigencia:** las cifras 36/36 y otros totales dentro de las notas siguientes
> son snapshots históricos. La comparación más reciente está registrada al
> final de este documento; no uses el primer párrafo para decidir si una base
> local está actualizada.

> **Estado vigente (2026-10-04, revalidado):** `http://localhost:3000` está
> conectado al Supabase Local del repositorio (`54321`, **52 migraciones**, hasta
> `20261004000500`) y Mailpit local (`54324`). El E2E integral pasó en un stack
> desechable con las 51 migraciones; no se repitió sobre la base persistente,
> donde hay cuentas/datos y el preflight aborta antes de escribir. La app y el
> Supabase principal están saludables. En la base persistente hay **0 de 4
> suscripciones vigentes**, por lo que no se pueden probar nuevas capturas
> operativas ni ediciones posteriores de estructura hasta activar un plan o
> piloto. El guardado de la configuración inicial sí está permitido antes del
> plan. El flujo Auth local envía a Mailpit, no a Gmail/Outlook; los asuntos de
> invitaciones pueden ser genéricos y no permiten clasificarlas solo por asunto.
> No se ha completado la inspección visual de rutas privadas con una sesión
> autenticada en el contenedor activo.

## Recorrido esperado de un cliente

1. La persona crea una cuenta de empresa con correo de trabajo y contraseña.
2. Confirma el correo y queda como **propietaria de la cuenta** y Dirección de
   la primera planta. No se inventan líneas, máquinas ni paros de producción.
3. Configura líneas, máquinas, tarifa/costo por hora, etapas y cuellos de
   botella con sus datos reales.
4. Invita al equipo con el rol adecuado. Cada invitación tiene vínculo seguro
   para crear su propia contraseña.
5. Solicita piloto acordado o plan pagado; el acceso operativo requiere una
   suscripción vigente.
6. En el MVP de cobro manual, la empresa paga por transferencia/OC y DowntimeOS
   confirma el pago antes de activar. Luego el equipo opera bajo permisos y
   límites de su plan.

## Matriz del MVP

| Área | Regla propuesta | Situación actual |
| --- | --- | --- |
| Registro / inicio | Una identidad por persona; correo confirmado; acceso por membresía a una o más plantas. Recuperar contraseña con enlace seguro. | E2E integral aprobado en Supabase Local desechable con 46 migraciones: alta transaccional, confirmación local, login, onboarding y recuperación. La QA persistente está en 45 y el histórico en 40; el E2E no se ejecutó sobre ninguno de ellos. `/activar` también termina de forma recuperable si se abre sin callback. **No equivale a probar entrega externa:** Auth envía a Mailpit. |
| Propiedad y administración de cuenta | Quien registró la empresa conserva la titularidad y siempre mantiene el control final. Puede delegar y revocar administración de cuenta a miembros activos; el delegado administra miembros regulares, pero no puede cambiar al titular ni a otros delegados. La propiedad legal no se transfiere desde el panel. | Migración incluida en las 45/45 de QA y pruebas automatizadas de delegación; el E2E fresco no cubrió inspección visual autenticada del panel. La base histórica `54321` aún no tiene esta migración. |
| Dirección de planta | Una o más personas pueden tener rol Dirección y administrar datos/configuración de planta. | Invitación/aceptación y autorización de rol Dirección comprobadas en E2E API/Auth; paneles heredados y acciones en navegador con sesión real aún pendientes. |
| Finanzas | Varias personas pueden consultar reportes financieros y, si se les asigna, administrar facturación. Sin administración de equipo por defecto. | E2E verificó invitación, permisos financieros y redacción por rol; falta recorrido visual autenticado de facturación. |
| Operaciones | Varias personas pueden atender paros, solicitudes, causas y estructura de su planta según permiso. | E2E verificó invitación y transiciones operativas desde API; revisión visual de las pantallas autenticadas y acciones de estructura sigue pendiente. |
| Operadores | Capturan/reportan paros; no son administradores de cuenta ni ven importes o tarifas. | E2E verificó invitación, permisos/redacción de datos y ciclo de reportes; la UI autenticada de tableta aún necesita revisión visual. |
| Planta y activos | La empresa puede tener varias plantas solo según el plan/cotización. Cada planta tiene sus propias líneas, máquinas, etapas, tarifas, usuarios e historial. | Esquema actual y límites pasan pruebas automatizadas; E2E probó onboarding y aislamiento entre dos empresas. El recorrido completo multi-planta y la UI de mover/editar activos no están certificados; decidir traslado/edición detallada. |
| Historial | Archivar un activo/línea lo retira de la operación actual, conserva eventos y no permite archivar equipo con paro/reportes abiertos. | Hay cobertura automatizada, pero la corrida E2E fresca no recorrió archivo/restauración; falta prueba integrada antes de darlo por certificado. |
| Suscripción | Periodos contratables semestral/anual; Enterprise cotiza desde tres plantas; cupos aplicados en servidor. El precio mensual solo es una equivalencia, no una periodicidad ofrecida. | E2E verificó solicitud, cancelación, pago/renovación manual y límite Starter; el cron/calendario de producción no se ejecutó. No hay cobro automático. Impuestos y aviso de cancelación todavía requieren definición comercial. |
| Pago MVP | Solicitud con orden de compra/referencia, registro de pago pendiente, validación manual y activación auditada; cancelación efectiva al fin del periodo. | E2E verificó solicitud, comprobante privado, aprobación local, cancelación y renovación. No hay checkout con tarjeta ni conciliación bancaria; revisión visual autenticada por rol admin sigue pendiente. |
| Datos fiscales | RFC, razón social, correo CxP, domicilio y referencia de CxP. | Captura/almacenamiento existen; no se verificó visualmente en sesión autenticada ni genera CFDI ni sustituye facturación contable. |
| Privacidad / auditoría | Aislamiento por empresa/planta, autorización servidor, no devolver costos al rol de piso, bitácora de cambios relevantes. | E2E verificó aislamiento entre dos empresas, RLS/PostgREST y permisos/redacción por rol; faltan carga, revisión externa y pruebas de penetración. Definir retención, borrado y acceso de soporte. |
| Correo transaccional | Confirmación, invitación y recuperación deben ser confiables y permitir reenviar enlaces. | E2E verificó los flujos con Mailpit local; Auth de QA e histórico usa Inbucket local. `RESEND_API_KEY` y `RESEND_FROM_EMAIL` no están configuradas; la entrega a Gmail/Outlook no funciona ni está verificada hasta configurar SMTP externo/dominio. |

## Planes y límites actualmente documentados

Los valores que hoy se reflejan en el catálogo/copy son USD y deben validarse
antes de venderlos. No se cambian por decisión técnica:

| Plan | Precio publicado | Límite/funciones documentadas |
| --- | --- | --- |
| Starter | Equivalente USD 49/mes · USD 294 semestral · USD 588 anual | Una planta, hasta 5 activos; exportación CSV del historial y portabilidad. |
| Pro | Equivalente USD 149/mes · USD 894 semestral · USD 1,788 anual | Una planta, hasta 20 activos, IA/WhatsApp y PDF mensual. |
| Enterprise | Equivalente USD 299/mes por planta · USD 1,794 semestral · USD 3,588 anual | Cotización mínima de tres plantas; activos sin límite, ERP e integraciones avanzadas. |

Los precios por mes son equivalencias, no planes mensuales ofrecidos. Las únicas
periodicidades contratables son semestral y anual. Estos importes se deducen de
los equivalentes publicados en la landing;
deben confirmarse comercialmente antes de cobrar. La moneda, IVA/impuestos,
conversión a MXN, qué significa exactamente
“WhatsApp”, límites de usuarios, soporte incluido y vigencia de cada precio
deben confirmarse en el contrato/cotización. Ningún número debe presentarse como
final hasta confirmar que coincide con la oferta comercial vigente.

## Pendientes que bloquean una salida comercial completa

1. **Aplicar y verificar las migraciones:** aplica el orden descrito en
   `supabase/ORDEN-DE-EJECUCION.md`, incluyendo
   `2026-10-02-delegacion-administracion-cuenta.sql` y
   `2026-10-02-comprobantes-suscripcion.sql`, después del esquema multitenant,
   RLS y bitácora indicados en
   `supabase/ORDEN-DE-EJECUCION.md`. No se ha ejecutado sobre una base remota.
   Los perfiles históricos que aún no tengan empresa/planta necesitan una
   asignación explícita; no se deben meter usuarios de varias empresas en la
   planta técnica `LEGACY` por conveniencia porque eso rompería el aislamiento.
2. **Auth/email:** allowlist de `/activar` y `/recuperar` para localhost y
   dominio final; SMTP autenticado (SPF/DKIM/DMARC); probar alta, confirmación,
   invitación, reenvío, expiración y recuperación.
3. **Decidir cobro:** continuar con transferencia + OC y verificación humana, o
   integrar checkout (proveedor, país, moneda, comisiones, contracargos y
   webhooks). No almacenar datos de tarjeta en DowntimeOS. El comprobante
   privado ya puede adjuntarse opcionalmente; definir cómo se comunican las
   instrucciones bancarias seguras y si la evidencia será obligatoria.
4. **Decidir CFDI:** quién factura, sistema fiscal y momento de emisión; los
   campos RFC actuales solo recopilan datos y no emiten facturas.
5. **Alinear términos:** el copy tiene condiciones de cancelación con aviso de
   30 días y también cancelación al final del periodo; decidir una regla única.
   Definir si el piloto de 14 días es estándar, por cliente o por cotización.
6. **Terminar estructura:** está disponible el alta y archivo sin borrar
   historia; falta decidir si en MVP se permite editar código/nombre, tarifa,
   etapa y mover activos, y quién aprueba esos cambios (el costo histórico queda
   congelado por evento).
7. **Soporte y ciclo de vida:** transferencia del propietario, baja de empresa,
   exportación/retención de datos, recuperación manual y acceso auditado de
   soporte. Definir cupo de usuarios por plan o confirmar que no habrá, límites
   de invitaciones pendientes, rate limits/anti-bot en registro y acceso, y
   política de sesiones/dispositivos.
8. **Renovación:** implementada en `2026-10-01-renovacion-suscripcion.sql`.
   La solicitud anticipada crea una nueva suscripción y pago pendiente. Tras
   verificación humana, las fechas quedan encadenadas sin solapar el periodo
   vigente. No hay cargo/renovación automática. Falta aplicar y probar esta
   migración en staging antes de dar la función por operativa. Después hay
   que aplicar `2026-10-01-endurecimiento-final-mvp.sql`, que bloquea una
   renovación duplicada sobre otro periodo futuro ya contratado.
9. **Prueba integral conectada:** dos empresas aisladas; owner, Dirección,
   Finanzas, Operaciones y Operador; invitación/revocación; equipos/límites;
   permisos de costos; solicitud, pago, activación, vencimiento/cancelación;
   PDF/WhatsApp y recuperación de contraseña.

## Criterio de “MVP listo”

No basta con compilar. Se considera listo cuando la migración correcta está
aplicada, SMTP y URLs están configurados, el recorrido de alta a producción y
de pago se completa en un entorno de prueba, los permisos se validan desde API
y consultas directas, y se resuelven los puntos comerciales 3–5 anteriores.

## Plan de trabajo consolidado

### Fase 1 — Identidad, propiedad y equipo

1. Dejar una sola persona propietaria por cuenta; solo ella administra usuarios,
   plantas y permisos de facturación. La propiedad no se delega desde el MVP.
2. Separar identidad global de membresías por planta: la misma persona puede ser
   Finanzas en una planta y Operaciones en otra.
3. Mantener la membresía inactiva hasta aceptar una invitación válida; aceptar
   solo la invitación/planta del enlace, no todas las invitaciones del correo.
4. Dar permisos de Dirección, Finanzas, Operaciones y Operador por función. El
   permiso de facturación es explícito; Operaciones/Operador no ven tarifas ni
   costos ni siquiera consultando REST directamente.
5. Probar cambio de rol, reenvío, invitación duplicada, acceso ya existente,
   revocación de una sesión activa y elección de planta cuando el usuario tiene
   varias.

### Fase 2 — Alta de planta y operación real

1. Después de confirmar el correo, guiar a la persona a configurar líneas,
   máquinas, etapas, tarifas y cuellos de botella; no precargar una planta
   ficticia ni paros demo en la cuenta real.
2. Permitir corregir/archivar estructura sin eliminar la historia. Definir si
   también se podrá editar códigos, mover máquinas y quién autoriza tarifas.
3. Aplicar límites de activos/plantas dentro de transacciones SQL, también ante
   altas simultáneas. Dar un camino de ajuste si la planta excede el plan antes
   de comprarlo.
4. Probar captura, atención y validación de paros por rol; mantener el costo
   histórico congelado al momento del evento.

### Fase 3 — Suscripción, cobro y ciclo de vida

1. Empezar con transferencia/orden de compra y validación humana, si confirmas
   que ese es el MVP. No guardar tarjetas ni presentar esto como checkout
   automático.
2. Mostrar con claridad: solicitud recibida → datos/instrucciones de pago →
   comprobante recibido (si se habilita carga) → pago verificado → plan activo.
   Definir si será obligatorio subir evidencia o bastará una OC registrada.
3. Mantener piloto separado de un cobro: concederlo no debe dejar un pago
   fantasma pendiente. Cancelar solicitudes y planes debe ser atómico y auditado.
4. La renovación manual anticipada está implementada: una cuenta con periodo
   vigente puede solicitar el siguiente periodo, elegir plan/periodicidad y
   registrar una OC/referencia. Se crea un pago pendiente; el equipo valida
   manualmente y entonces la RPC programa el intervalo contiguo, sin solaparlo
   con el vigente. No hay cargo automático. La migración
   `2026-10-01-renovacion-suscripcion.sql` debe aplicarse antes de usarla.
5. Unificar las condiciones públicas y técnicas: periodos semestral/anual y
   precio mensual equivalente, cancelación y aviso, duración del piloto,
   Enterprise mínimo de tres plantas, cupo de usuarios, impuestos, moneda y
   conversión. No cambiar esos compromisos sin aprobación.
6. Los campos RFC/domicilio solo recopilan datos. Confirmar quién emite CFDI,
   cuándo y con qué sistema antes de vender “facturación” como automática.

### Fase 4 — Seguridad, privacidad y soporte

1. Aplicar y comprobar aislamiento entre organizaciones/planta, roles en cada
   endpoint, políticas RLS, privilegios de columnas y vistas agregadas. La API
   no es la única barrera: también se prueban consultas directas con JWT.
2. Verificar firma HMAC del webhook de Meta con el App Secret; el Verify Token
   es otro valor. Configurar ambos secretos localmente y en el host de despliegue.
3. Auditar altas/bajas/cambios de usuario, pago, plan, factura y acceso de
   soporte. Definir retención, exportación, baja de cuenta y transferencia del
   propietario.
4. Configurar SMTP con dominio autenticado y límites antiabuso/rate limits para
   registro, recuperación, invitaciones y envío repetido de mensajes.

### Fase 5 — Capacidad y liberación

1. Mantener el refresco pedido de 5 s, pero medir en staging con varias sesiones
   y pestañas; reducir llamadas/payload si latencia, DB o cuota se degradan.
   La revisión de código encontró que cada refresco vuelve a descargar hasta
   500 eventos junto con el estado vivo, aunque la tabla solo pagina 10 filas
   en el navegador. El tráfico repetido está demostrado; la degradación real
   aún no está medida. Antes de escalar, separar estado vivo e historial,
   paginar el historial en servidor y medir el endpoint de métricas.
2. Paginar historiales grandes y medir 10 mil/100 mil eventos; hoy no hay prueba
   de carga que certifique capacidad de producción.
3. Ejecutar pruebas automatizadas y manuales con dos organizaciones y todos los
   roles; incluir confirmación/recuperación de correo, callbacks reales, pago,
   vencimiento y cancelación.
4. Probar primero en un proyecto Supabase de staging. Respaldar antes de migrar;
   aplicar a producción solo tras verificar esquema, RLS y reversión.
5. Definir acceso al vencer: decidir expresamente si se conserva lectura y
   corrección de bitácora mientras se bloquean nuevas capturas y funciones
   premium. Hoy las rutas aplican reglas distintas.
6. Caducidad de invitaciones (72 horas ya implementadas tanto en el enlace como
   en la transacción SQL); verificar reenvío e invalidación con Supabase real.
7. Estado visible y cron de vencimiento/avisos de 7 y 1 día implementados en
   código. Falta configurar `CRON_SECRET`, `RESEND_API_KEY` y
   `RESEND_FROM_EMAIL` en Vercel, validar remitente/dominio en Resend y probar
   el envío de punta a punta en staging. En local se invoca manualmente con
   Bearer; Vercel Cron es un proceso de deployment.
8. Verificar que los límites de activos por organización coincidan en todas las
   plantas y se apliquen también con altas simultáneas en SQL.

### Implementación técnica ya avanzada en esta rama

La rama local ya contiene pantallas/API para cuentas, onboarding, equipo,
estructura, plantas y suscripciones; RPC para transiciones atómicas; renovación
de sesión; CSV con keyset; callbacks con origen seguro; filtrado financiero en
la API; firma HMAC Meta; y nuevas migraciones. Las revisiones paralelas
encontraron y se corrigieron defectos de concurrencia en cupos, onboarding,
paro/archivo y conversión de piloto. La última verificación local pasó 139
pruebas, `npm run build` y `npm run smoke` (13 rutas). Esto no certifica las migraciones, correos,
callbacks ni permisos efectivos en Supabase: las nuevas migraciones siguen sin
ejecutarse/probarse en staging o producción.

La revisión paralela también detectó y corrigió una política REST obsoleta
sobre perfiles históricos, la posibilidad de encadenar renovaciones duplicadas
y la falta de cancelación explícita de un periodo futuro confirmado. El alta de
empresa/planta se volvió transaccional mediante una RPC y se añadieron
estructuras de configuración editables como borradores. En la verificación del
2026-10-01 pasaron 180 pruebas y `npm run build`. Las 20 migraciones hasta
`2026-10-02-integridad-tenant-planta.sql` están instaladas en una base Supabase
local aislada. Se comprobaron además el bucket privado, RLS de comprobantes y
rutas locales. Esto no prueba SMTP, webhooks externos ni comportamiento bajo
carga; no se aplicó ninguna migración a Supabase remoto ni se hizo despliegue.

El runner opt-in `scripts/e2e-mvp-local.mjs` y su lanzador PowerShell
`scripts/e2e-mvp-local.ps1` ejercitan Auth/API contra una instancia local
desechable sin leer `.env.local` ni llamar URLs no locales. El 01-octubre se
corrigió la ambigüedad PostgREST introducida por la FK compuesta:
`resolverPerfil` fija explícitamente la relación tenant/planta. En la última
verificación local pasaron 233 pruebas unitarias, `npm run build`, y el smoke
HTTP de 18 rutas. El E2E conectado pasó registro/login, dos tenants aislados,
configuración transaccional, solicitud/cancelación de pago pendiente, carga
privada de PDF, aprobación administrativa, cuota Starter, recuperación por
Mailpit, vencimiento de plan, cuatro roles, permisos de facturación y denegación
directa de costos sensibles a Operador. Se añadió una comprobación PostgREST
con JWT de ambos tenants para organización, planta, perfil, membresía, líneas,
activos y estados en ambos sentidos. Se extendió a las 12 tablas públicas con
políticas de lectura; además se probó que JWT de ambos tenants no puedan leer
tablas y vistas privadas directamente. También se probó en flujo conectado la
renovación semestral/anual, el rechazo de mensualidad y duplicados, la
cancelación de renovación pendiente, la conciliación del pago ya verificado y
la cancelación del plan activo al término del periodo. En una ampliación del
E2E apareció una colisión real de folios cortos tras reportes rápidos repetidos;
se añadió `2026-10-02-folios-resistentes-colisiones.sql` y una prueba de 64
ciclos consecutivos de solicitud/cierre, todos con folios distintos. Esa
migración se aplicó sin reiniciar ni borrar datos en el Supabase Local al que
apunta el contenedor Docker de desarrollo; no se aplicó a Supabase remoto. No
se esperó al vencimiento real para observar la transición automática de un
periodo futuro; tampoco se ejecutaron pruebas directas de mutación SQL con JWT
ni cargas de 10k/100k. El runner conserva los fixtures y no los borra; la
instancia E2E temporal usada para esta verificación quedó detenida con su
volumen local preservado. El smoke HTTP se ejecuta contra Docker en
`localhost:3000` si está activo, o contra el build standalone del host en caso
contrario. No se amplió el grant a `authenticated`.

Para desarrollo Docker, `scripts/docker-local.ps1` carga las claves de la
instancia Supabase Local y fuerza el callback `http://localhost:3000`. El
Compose no importa `.env.local`: solo admite una lista explícita de variables
`DOWNTIMEOS_LOCAL_*`. WhatsApp, Resend y los proveedores de IA quedan sin
credenciales y apagados por defecto; habilítalos localmente solo con credenciales
de prueba y destinos controlados.

La revisión de capacidad redujo el autorefresh de 5 s a estados actuales y
solicitudes abiertas, evitando descargar repetidamente la bitácora. Falta
paginación del lado servidor y benchmark de 10k/100k eventos. Las devoluciones,
si corresponden, siguen siendo manuales: no se automatizan ni se prometen en la
interfaz.

### Verificación local más reciente (2026-10-02)

- `npm test`: **243/243** pruebas; `npm run smoke`: **18 rutas y 15 APIs
  protegidas** (9 lecturas sin sesión y 6 intentos de escritura sin sesión);
  `npm run build`: correcto.
- Docker de la app responde `/api/health` con `ok: true` y reporta Supabase
  Local en `localhost:54321`. Las pantallas protegidas redirigen a `/acceso`
  cuando no hay sesión; el recorrido autenticado no se volvió a inspeccionar
  visualmente en esta pasada.
- En la base local de desarrollo se comprobaron RLS en **26/26** tablas
  públicas, cero privilegios `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE` para
  `anon`/`authenticated`, ningún `SELECT` REST para `anon`, **13 políticas de
  lectura** para `authenticated` y privilegios de escritura conservados para
  `service_role`. Las consultas anónimas a leads, activos y planes responden
  `401`, mientras `/api/leads/stats` sigue respondiendo `200` por la API de
  servidor. Esta base contiene **104 usuarios Auth y 45 organizaciones**,
  por lo que no es una instancia vacía desechable y no se ejecutó allí el E2E
  que crea cuentas/organizaciones.
- Las comprobaciones de integridad encontraron cero membresías/invitaciones con
  planta de otro tenant, cero pagos sin suscripción, cero membresías activas o
  invitaciones pendientes duplicadas y cero periodos vigentes solapados. La
  única organización sin membresía de propietario es el tenant histórico
  `Histórico DowntimeOS` (sin propietario por diseño); los dos perfiles
  inactivos observados corresponden a invitaciones pendientes, no a accesos
  activos.
- El endpoint local `/api/cron/suscripciones` devuelve **503** por falta de
  `CRON_SECRET`; el entorno consultado tampoco tiene variables de Resend. El
  flujo de cron/correo, staging, SMTP y pruebas de carga siguen sin certificarse.

### Revisión de seguimiento (2026-10-02)

- En el árbol actual pasaron `npm test` (**248/248**), `npm run build` y
  `npm run smoke` (**18 rutas y 15 APIs protegidas**). `docker compose config
  --quiet` valida el Compose sin iniciar contenedores y sin imprimir variables.
- Se inspeccionaron visualmente acceso, registro y recuperación en el build
  standalone del host, en un puerto aislado; se ven con la identidad global
  oscura. No se enviaron formularios ni se crearon cuentas. No se verificaron
  visualmente los flujos autenticados.
- Docker Desktop no respondió al inventario de contenedores y los puertos
  locales 3000–3002 y Supabase no contestaron a HTTP. Por tanto no se pudo
  certificar en esta revisión el estado de la base, migraciones aplicadas,
  Auth/correos, invitaciones, permisos efectivos, pagos ni integraciones.
- Auditoría estática de migraciones: las 27 SQL de `supabase/migraciones` sí
  aparecen en `ORDEN-DE-EJECUCION.md`, pero el directorio reconocido por Supabase
  CLI (`supabase/migrations`) contiene solo dos archivos y no hay
  `supabase/config.toml` en la raíz. `scripts/docker-local.ps1` consulta el
  estado de un proyecto temporal y ejecuta Compose; no inicia/resetear la base
  ni aplica SQL. Por ello el esquema del contenedor puede quedarse atrás del
  código; la causa exacta de los errores vistos en el navegador sigue sin
  confirmarse hasta recuperar acceso al stack.
- El Compose dejó de importar `.env.local` y desactiva por defecto los envíos
  externos; solo expone integraciones mediante variables explícitas
  `DOWNTIMEOS_LOCAL_*`. El registro ahora bloquea envíos simultáneos y el botón
  queda deshabilitado tras una respuesta de alta aceptada.
- En el Docker activo, las llamadas POST sin sesión a estados, eventos,
  reportes, solicitudes, configuración de planta y análisis IA respondieron
  **401**. El smoke ahora repite esta comprobación con cuerpos vacíos y también
  cubre las nueve APIs GET protegidas; no intenta mutar datos de negocio.
- Se detectó que el contenedor web no monta el código fuente y precedía a los
  últimos cambios. Se reconstruyó/recreó solo `downtimeos` mediante
  `scripts/docker-local.ps1` con `--no-deps`; Supabase Local siguió activo y
  sin reinicio. La nueva imagen está saludable y el smoke volvió a pasar. Una
  consulta a `/direccion` sin sesión redirige al acceso, por lo que no se toma
  como QA visual del tablero autenticado; hace falta refrescar el navegador y
  recorrerlo con una sesión real.
- Permanecen activos dos stacks Docker auxiliares `downtimeos-e2e-disposable-*`;
  en uno, `supabase_vector` reinicia porque no puede alcanzar el socket de
  Docker. No se detuvieron ni borraron: conservan volúmenes/datos y requieren
  confirmar qué stack se puede retirar antes de limpiar recursos.
- No se aplicó ninguna migración a Supabase remoto ni se alteraron cuentas o
  datos durante esta verificación.

### Verificación de seguimiento (2026-10-02, smoke aislado)

- `npm test`: **251/251**. `npm run build`: correcto. `npm run smoke`: correcto,
  **18 rutas y 15 APIs protegidas**. El smoke corre sobre el build standalone
  aislado cuando Docker no sirve la app.
- Se corrigió el propio smoke: el servidor aislado ahora usa credenciales de
  Administración ficticias para probar el `401` de sesión, sin cargar
  `.env.local`; las redirecciones de Next se verifican por URL normalizada.
  El anterior `503` no era un fallo de permisos del producto, sino el entorno
  de prueba incompleto.
- `docker compose config --quiet` pasa con claves dummy de validación; sin
  `DOWNTIMEOS_LOCAL_*` falla intencionalmente y recomienda
  `scripts/docker-local.ps1`. `git diff --check` no reporta errores de
  whitespace (solo avisos de conversión CRLF).
- Se endureció `.dockerignore` a `.env*`: ya no solo excluye `.env.local`, sino
  cualquier variante de dotenv del contexto Docker. Se añadió prueba de
  regresión. No se construyó imagen porque el daemon sigue devolviendo HTTP 500.
- `scripts/docker-local.ps1` ahora restaura las variables de entorno que ya
  existían en la terminal, en vez de borrarlas tras Compose; su contrato tiene
  prueba. Invitaciones/recuperación usan Supabase Auth y su SMTP; Resend solo
  se usa para recordatorios del cron de suscripciones, no para esos correos.
- Docker Desktop y su backend aparecen activos, pero el daemon sigue devolviendo
  HTTP 500 en su named pipe. No se reiniciaron servicios ni se tocaron
  contenedores o volúmenes. Por ello, E2E conectado, estado actual de
  migraciones y QA visual autenticado continúan **sin verificar**.

### Verificación de seguimiento (2026-10-02, Docker y arranque)

- Docker Desktop estaba operativo. La app y Supabase Local respondieron HTTP
  200; el problema al ejecutar Compose directamente era que faltaban en la
  terminal las claves efímeras `DOWNTIMEOS_LOCAL_*`, exigidas por diseño para
  no importar secretos remotos desde `.env.local`.
- Se añadió `npm run docker:local`, que usa `scripts/docker-local.ps1` para
  cargar esas claves, construir y recrear solo la app. Se probó el comando de
  principio a fin; `downtimeos` quedó saludable en `localhost:3000` y Mailpit
  respondió en `localhost:54324`.
- Se retiraron 65 contenedores de proyectos temporales `e2e-*` y pruebas
  detenidas. Se conservaron los volúmenes; permanecen solo la app y los seis
  servicios del Supabase Local, sin contenedores detenidos.
- `npm test`: **251/251**. `npm run smoke`: **18 rutas y 15 APIs protegidas**.
  El smoke acepta `503` únicamente para Administración cuando faltan sus
  credenciales locales; el rechazo es seguro y esperado. El build Docker pasó.
- `supabase migration list --local` consultó la base sin modificarla: reporta
  **20 versiones registradas en la base**. La consulta actual del 2026-10-02
  reporta 14 archivos versionados en el workdir temporal que ejecuta Supabase;
  seis versiones históricas (`20260801000000`, `20260904000000`, `20260905000000`,
  `20260905000100`, `20260906000000`, `20260907000000`) figuran en la base pero
  no tienen archivo SQL en ese workdir. El directorio versionado del repo
  `supabase/migrations` contiene dos archivos, mientras `supabase/migraciones`
  contiene **27 scripts manuales**. La última versión registrada es
  `20261002000200`; eso no demuestra que los scripts manuales posteriores estén
  representados por el historial. La base conserva **104 usuarios Auth y 45
  organizaciones**. No ejecutar `db reset`, `db push` ni E2E con escrituras
  hasta reconciliar y respaldar/verificar esta base.
- Comprobación directa de solo lectura en Postgres: existen las RPC/tablas de
  cierre atómico, comprobantes, administración delegada, retiro de reportes,
  estructura y folios; las tres FK compuestas de tenant están validadas y no
  hay perfiles, membresías ni invitaciones cruzados entre organizaciones.
  `anon` no puede leer `leads`, estados ni tarifas; `authenticated` puede leer
  estados por RLS, no modificarlos directamente ni consultar `tarifa_hora`;
  `service_role` conserva el acceso de servidor.
- Integridad Auth/perfiles: los 104 usuarios tienen correo confirmado y perfil;
  ninguno carece de organización/planta. Hay dos perfiles sin membresía activa,
  y ambos corresponden a invitaciones pendientes; no se detectaron altas Auth
  huérfanas en esta consulta (no se imprimieron correos ni identificadores).
- Suscripciones/pagos: 31 suscripciones y 31 pagos; ningún periodo activo
  semestral/anual se traslapa con otro del mismo tenant. Existe un registro
  mensual histórico, pero ninguno está activo. Los pagos `anulado` están unidos
  a suscripciones canceladas; los pendientes/recibidos/verificados concuerdan
  con sus estados de suscripción.
- El buzón Mailpit local está saludable, pero actualmente contiene **0 mensajes**
  y su contenedor no tiene volumen montado. Tras reiniciar Docker, los correos
  locales anteriores se pierden; esto no prueba un fallo del envío. No se mandó
  un correo de prueba para evitar crear una cuenta/invitación nueva en la base
  persistente.
- El panel administrativo local continúa sin credenciales (`503` previsto).
  No se configuró una contraseña predeterminada ni se aplicó SQL, para evitar
  abrir accesos o alterar datos existentes.
- QA visual en navegador local de `/acceso`, `/registro` y `/recuperar`: las
  tres conservan fondo, tipografía, jerarquía, campos y botones de la identidad
  DowntimeOS; no se enviaron formularios. `/suscripcion` redirigió a `/acceso`
  sin sesión, comportamiento esperado; su vista autenticada y las vistas
  autenticadas de estructura/equipo siguen pendientes de QA visual.

### Seguimiento de invitaciones en entorno local (2026-10-02)

- La pantalla de equipo detecta si está conectada a Supabase Local y muestra un
  aviso contextual con acceso directo a Mailpit (`http://localhost:54324`).
  Aclara que esos mensajes son de prueba y no se entregan a Gmail/Outlook.
- Tras aceptar una invitación, el mensaje de éxito distingue el entorno local
  del correo real: confirma que Supabase aceptó la solicitud y dirige a revisar
  Mailpit, sin afirmar entrega a una bandeja externa.
- No se generó invitación ni correo durante esta verificación. Mailpit responde
  correctamente y está vacío; su contenido es efímero y se pierde al reiniciar.
- `npm test`: **252/252**. `npm run docker:local` reconstruyó y recreó solo la
  app; quedó saludable y conectada al Supabase local. `npm run smoke`: **18
  rutas y 15 APIs protegidas** pasan.
- Hay siete contenedores activos esperados (app + seis servicios de Supabase),
  ninguno detenido. No se borraron contenedores ni volúmenes en este seguimiento.
- Revisión actual repetida: `npm test` **252/252**, `npm run smoke` **18 rutas / 15 APIs**, `/api/health` responde `ok: true` y `/api/config` apunta a `localhost` con clave pública presente. No se imprimieron claves.
- La nueva pestaña local no tenía una sesión; abrir `/equipo` la redirigió a
  `/acceso`, sin enviar credenciales. La autorización visual de Equipo y
  Suscripción sigue pendiente.
- Hallazgo operativo pendiente: el repo no contiene `supabase/config.toml`;
  `docker:local` toma estado/claves de un workdir dentro de `%LOCALAPPDATA%\Temp`
  con nombre específico de esta máquina. El arranque está verificado aquí, pero
  no es aún reproducible desde un checkout limpio. Antes de entregar la guía a
  testers hay que versionar una configuración local y una secuencia de esquema
  coherente, y validarlas en una instancia vacía separada.
- Confirmación de contenido: los dos SQL actualmente versionados no son un
  bootstrap completo; uno solo crea `planta_interruptores_integraciones` y el
  otro solicita recargar el esquema PostgREST. No iniciar una base nueva con
  esos archivos esperando que aparezcan las tablas de planta, Auth/perfiles,
  equipo y facturación. Convertir los scripts manuales a migraciones históricas
  sin reconciliar dependencias podría duplicar objetos o alterar datos; primero
  hace falta definir/probar la cadena base en una instancia desechable.
- La prueba `base-schema-multitenant-orden.test.js` verifica dependencias con
  aserciones de texto; sirve como regresión, pero no ejecuta el SQL contra un
  Postgres limpio. La base actual no es desechable y el runner E2E aborta antes
  de escribir si detecta usuarios/organizaciones, así que aún falta validar la
  cadena real de instalación completa. No se dejó una configuración Supabase
  autogenerada con defaults inseguros ni se levantó otro stack.
- Revalidación de seguimiento (2026-10-02): `npm test` pasa **252/252**,
  `npm run smoke` pasa **18 rutas y 15 APIs protegidas**, y `npx next build`
  compila y genera las 25 rutas de la app. `/api/health` devuelve `ok: true`;
  Docker mantiene únicamente siete contenedores activos (app + seis servicios
  esenciales de Supabase), todos saludables donde hay healthcheck.
- Correo local sigue sin certificarse de extremo a extremo. Mailpit está vacío;
  no se creó una invitación de prueba porque la base persistente contiene datos
  reales del entorno local. La configuración de Auth conserva el límite de
  correo original (`email_sent = 2`); no se dejó un valor aumentado que no
  surtiera efecto. Auth muestra `GOTRUE_RATE_LIMIT_EMAIL_SENT=360000` en el
  contenedor activo. Al declarar SMTP en el `config.toml` temporal, el CLI exige
  `user` y `pass` no vacíos; Inbucket/Mailpit local no proporciona credenciales,
  y el CLI rechaza cadenas vacías. No se inyectaron credenciales falsas, no se
  reemplazó el contenedor Auth y no se afirmó que las invitaciones ya estén
  arregladas. Confirmar el límite efectivo y recibir una invitación en Mailpit
  continúa como prueba pendiente en una base local desechable.
- Mejora de diagnóstico de invitaciones: si Supabase Auth devuelve `429` o
  `over_email_send_rate_limit`, la API ahora responde `429` con un mensaje
  específico de límite temporal, en vez de atribuirlo a SMTP. El rollback deja
  la invitación revocada y la membresía inactiva. Prueba de regresión incluida.
- Revalidación después del cambio: `npm test` **255/255**; `npm run smoke`
  **18 rutas y 15 APIs protegidas**; `npm run docker:local` reconstruyó la
  imagen y recreó solo la app. `/api/health` quedó `ok: true`; permanecen los
  mismos siete contenedores activos. El envío real de invitación sigue pendiente
  y no debe confundirse con estas pruebas automatizadas.
- El mismo diagnóstico `429` se aplica al reenvío de invitaciones; si falla por
  límite, se restaura el hash y la vigencia del enlace previo. Prueba de
  regresión incluida y verificada en Docker local.
- UX de registro local: después de un alta que requiera confirmación, la pantalla
  detecta Supabase local y muestra el enlace a Mailpit; aclara que el mensaje no
  se entrega a Gmail/Outlook. La detección y condición tienen prueba de regresión.
  No se envió una confirmación real durante la verificación.

### Revalidación de estado y Docker (2026-10-02)

- `npm test`: **255/255**. El estado HTTP actual de `http://localhost:3000/api/health`
  es `ok: true`.
- `docker ps` confirma siete contenedores activos: aplicación DowntimeOS y los
  seis servicios del stack Supabase local; la app, DB, Auth, Storage, Inbucket y
  Kong muestran healthy. No hay contenedores adicionales activos en esta consulta.
- `docker compose ps` sin preparar las variables locales falla antes de consultar
  el estado, porque el Compose exige claves efímeras de Supabase. El script
  `scripts/docker-local.ps1` obtiene esas claves del Supabase local, valida que
  la URL sea localhost:54321, ejecuta Compose y restaura las variables; este es
  el camino previsto para operar Compose desde PowerShell.
- La ruta autenticada de facturación no pudo verificarse visualmente sin una
  sesión de usuario en el navegador. Pruebas unitarias de permisos y contrato
  pasan, pero no equivalen a ejecutar una solicitud, comprobante y validación
  completa de pago en una base desechable.
- Revisión estática adicional de los callbacks: registro usa `/activar`, guarda
  sesión antes de redirigir a onboarding y recuperación acepta cambio solo en
  evento `PASSWORD_RECOVERY`; las pruebas de callback y URL pasan. No se creó
  una cuenta ni se solicitó un correo real en esta pasada.
- La skill de automatización visual no pudo inicializar su entorno auxiliar
  (`failed to write kernel assets`); por ello no se marca QA visual autenticado
  como completado. Las respuestas HTTP y pruebas de rutas no sustituyen esa
  comprobación manual.
- Se corrigió el README para retirar instrucciones obsoletas (Python como
  arranque de la app, `npm run deploy` inexistente y SQL histórico presentado
  como receta general). La guía SQL ahora advierte desde el inicio que el
  bootstrap vacío no está certificado. `git diff --check` no encontró errores
  de whitespace en esos documentos.
- Corrección adicional del límite concurrente de equipos: si la RPC detecta
  que se alcanzó el máximo del plan, la API devuelve `409 PLAN_ASSET_LIMIT` y
  la pantalla de estructura muestra un enlace a Suscripción y pagos. Se evita
  el doble envío mientras se guarda. Pruebas específicas de estructura y
  serialización: **11/11**; suite completa: **256/256**.
- `npm run build` terminó correctamente; `npm run docker:local` reconstruyó y
  recreó solo el contenedor de la app. Smoke posterior: **18 rutas y 15 APIs**;
  `/api/health` responde `ok: true`. Siguen activos siete contenedores (app +
  los seis servicios Supabase), sin reiniciar la base ni generar correos.

### Auditoría de seguimiento (2026-10-03)

- `npm run docker:local` volvió a compilar y recrear únicamente la app; el
  contenedor quedó `healthy`. `docker ps -a` no muestra contenedores detenidos
  ni copias adicionales: 1 app + 6 servicios del Supabase local. El health
  check respondió `ok: true`.
- `npm test`: **256/256**. Se ampliaron las rutas del smoke para incluir
  `/plantas` y `/estructura`; `npm run smoke`: **20 rutas y 15 APIs protegidas**.
- La API de registro rechaza un formato de correo inválido con HTTP 400 y un
  mensaje específico sin escribir datos. El error 500 que el usuario observó
  al intentar registrarse no se reprodujo: no se hizo otra alta porque podría
  crear una cuenta duplicada. La RPC transaccional de registro existe en la
  base local; esto no confirma que Auth + RPC + correo completen el recorrido.
- Mailpit responde, pero la bandeja local está vacía ahora mismo. No se ha
  probado un envío reciente de confirmación/invitación en esta pasada.
- Auth local responde HTTP 200 y permite altas por email, pero su ajuste efectivo
  es `mailer_autoconfirm=true` (`enable_confirmations=false` en el `config.toml`
  temporal). Por ello, un registro nuevo puede confirmarse e iniciar sesión sin
  mandar correo; la bandeja vacía no prueba un fallo de entrega. Para probar
  confirmaciones por Mailpit habrá que activar confirmación en la configuración
  del entorno desechable y verificarlo con un usuario de prueba, no cambiar el
  stack persistente sin respaldo.
- `supabase migration list --local` es una consulta de solo lectura y reporta
  20 versiones aplicadas hasta `20261002000200`. La carpeta temporal que usa
  Supabase CLI tiene 14 migraciones versionadas; el repo tiene dos en
  `supabase/migrations` y 27 scripts manuales en `supabase/migraciones`.
  Aunque las RPC de registro e invitación existen, esa divergencia impide
  declarar reproducible un bootstrap desde cero. No se ejecutó reset ni SQL.
- La comparación SHA-256 confirmó que 13 migraciones temporales corresponden
  exactamente a sus scripts fuente. Nueve migraciones fuente posteriores no
  están versionadas en esa cadena: `2026-10-02-catalogo-causas-producto.sql`,
  `2026-10-02-cierre-paro-atomico.sql`,
  `2026-10-02-folios-resistentes-colisiones.sql`,
  `2026-10-02-privilegios-integraciones-internas.sql`,
  `2026-10-02-privilegios-rpc-paros.sql`,
  `2026-10-02-retiro-reporte-operador.sql`,
  `2026-10-02-revocar-escritura-publica.sql`,
  `2026-10-02-serializar-estructura.sql` y
  `2026-10-02-solo-periodos-semestral-anual.sql`. Consultas de solo lectura
  confirman en la base local el catálogo, las RPC de cierre/retiro, los
  triggers de folios y periodicidad, la serialización de estructura, y la
  denegación directa de lectura de leads/tarifas. No se modificó la base.
- La inspección visual autenticada sigue pendiente: la herramienta de control
  de escritorio falló al inicializarse. Respuestas HTTP y pruebas automatizadas
  no sustituyen esa revisión.

### Manejo de fallo de red en el registro (2026-10-03)

- Se reprodujo `fetch failed` de Supabase Auth contra un puerto localhost
  cerrado, sin conectividad externa y sin escrituras. Supabase entrega esa
  falla como un objeto `error` con mensaje de red; el servidor la clasificaba
  como 422, en vez de distinguir indisponibilidad del servicio.
- `lib/cuenta.js` ahora responde 503 con un mensaje claro de conexión y registra
  solo nombre/código técnico (no el objeto HTTP ni datos de la solicitud).
  La configuración inválida de callback también se responde como indisponible,
  salvo errores que ya tenían un estado controlado.
- La prueba `test/registro-error-auth.test.js` valida la falla de red en un
  puerto local cerrado. Suite completa: **257/257**; build Docker actualizado,
  contenedor app `healthy`, `/api/health` y Auth HTTP 200, Mailpit HTTP 200,
  smoke **20 rutas/15 APIs**. Una validación de registro con correo inválido
  devolvió HTTP 400 específico sin alcanzar Auth ni insertar datos.
- Aún no se envió un correo ni se completó una alta integral; esa verificación
  requiere un proyecto local desechable debido a los datos persistentes de la
  instancia de desarrollo.

### Seguimiento de Auth y recuperación del stack (2026-10-03)

- Se corrigió la configuración efectiva del Supabase Local temporal:
  `GOTRUE_SITE_URL=http://localhost:3000`, allowlist de callbacks para
  `localhost` y `127.0.0.1`, y `GOTRUE_MAILER_AUTOCONFIRM=false`. Se confirmó
  inspeccionando el entorno del nuevo contenedor Auth, no solo leyendo el TOML.
- La recuperación requirió detener y arrancar Supabase Local. `supabase stop`
  informó `backup=true`; no se usó `--no-backup`, no se ejecutó `db reset` ni
  se modificó el esquema o se crearon cuentas. La base persistente volvió a
  levantar desde su respaldo local.
- Después del arranque: la app `/api/health`, Auth `/auth/v1/health` y Mailpit
  respondieron HTTP 200; el smoke volvió a pasar (**20 rutas y 15 APIs**). La
  suite completa pasó **256/256** y `npm run build` terminó correctamente.
- El stack completo de Supabase levanta 12 servicios más la app. El contenedor
  `supabase_vector` está en ciclo de reinicio porque no alcanza el Docker host
  en `[fdc4:f303:9324::254]:2375` (IPv6 sin ruta); es el colector local de
  logs, no Auth/Postgres. Investigar su configuración de red o deshabilitar el
  analytics local de forma explícita para evitar el reinicio continuo.
- Sigue sin comprobarse un correo nuevo de confirmación/invitación; Mailpit
  responde, pero las verificaciones de esta pasada fueron de salud solamente.
  El Auth corregido reduce el riesgo de redirección incorrecta, pero aún no
  prueba entregabilidad ni aceptación de invitaciones.
- En ese momento el `config.toml` y la cadena completa aún dependían de archivos
  temporales. Se resolvió en la certificación reproducible de abajo.

### Certificación integral MVP y arranque reproducible (2026-10-03)

- Se promovieron al repositorio la configuración local de Supabase y las 31
  migraciones versionadas. Dos proyectos locales desechables independientes
  comprobaron la cadena completa: primero las 29 migraciones funcionales y
  luego las 31 del repositorio; todas quedaron aplicadas sin error y con
  versiones local/remota coincidentes. Ambos stacks desechables se detuvieron
  con respaldo; la instancia persistente del usuario no se reinició ni modificó.
- El recorrido integral en el stack desechable pasó: registro e inicio de dos
  tenants, onboarding y estructura, aislamiento RLS, suscripción y pagos
  manuales con comprobante y validación administrativa, renovación/cancelación,
  límites de plan, recuperación de contraseña vía Mailpit, invitaciones y los
  cuatro roles, permisos, flujo STOP→RUN de Operaciones/Mantenimiento, descarte,
  retiro solo por autor, folios concurrentes y vencimiento de plan. Se omitieron
  pruebas de fuzz de mutaciones y carga; no se conectaron proveedores externos.
- El lanzador `scripts/docker-local.ps1` ahora prefiere un Supabase activo en el
  checkout y conserva como respaldo la instancia temporal histórica para no
  abandonar los datos locales existentes. No arranca, detiene ni reinicia
  Supabase automáticamente. El README describe el arranque limpio explícito.
- Verificación final de código: `npm test` **258/258**; `npm run build` correcto;
  `git diff --check` correcto. `npm run docker:local` reconstruyó únicamente la
  app. `/api/health`, Auth local y Mailpit devolvieron HTTP 200.
- Seguimiento visual de Suscripción: la separación dependía de márgenes entre
  tarjetas y el usuario reportó que se veían pegadas. Se agruparon las tarjetas
  en `.billing-panels` con `display: grid; gap: 18px`; regresión automatizada
  añadida. El CSS reconstruido ya se sirve desde el contenedor y Registro y
  Suscripción responden HTTP 200. La revisión de píxeles en sesión autenticada
  continúa pendiente; una respuesta HTTP no demuestra fidelidad visual.
- La inspección del navegador sin sesión encontró un fallo real: `/configurar-planta`
  y `/estructura` enseñaban sus formularios y dejaban que el usuario los llenara,
  aunque el API rechazaba después el guardado. Ambas rutas ahora ocultan el
  formulario hasta validar que exista sesión y redirigen a Acceso con retorno
  interno permitido. Confirmado en Docker con navegador: `/configurar-planta` →
  `/acceso?returnTo=%2Fconfigurar-planta` y `/estructura` →
  `/acceso?returnTo=%2Festructura`. Pruebas completas **260/260**, build,
  contenedor `healthy` y smoke **20 rutas/15 APIs**.
- En la inspección por rol se encontró que `/estructura` seguía mostrando sus
  formularios a una sesión autenticada sin rol Dirección aunque el API respondía
  403. Ahora la pantalla espera el GET autorizado y oculta formularios ante 403;
  para 401 conserva el retorno a login y ante errores transitorios ofrece reintento.
  La regresión quedó cubierta; suite **261/261**, build, smoke **20/15** y Docker
  `healthy`. El caso concreto con JWT de operador aún debe confirmarse en una
  corrida de navegador autenticada.
- Suscripción mostraba el estado vacío predeterminado incluso cuando la consulta
  fallaba o devolvía 403, lo que podía afirmar incorrectamente que la empresa no
  tenía plan. La pantalla ahora separa carga, acceso denegado, error recuperable
  y consulta correcta; “Aún no tienes una suscripción” solo se presenta tras un
  GET exitoso. La ruta sin sesión conserva `returnTo` y se confirmó en navegador
  como `/acceso?returnTo=%2Fsuscripcion`. Suite **262/262**, build correcto,
  contenedor `healthy`, Auth HTTP 200 y smoke **20 rutas/15 APIs**.
- Pendientes para declarar MVP listo para testers: inspección visual/manual de
  todas las pantallas y estados de error/vacío/responsive, prueba humana guiada
  de confirmación/recuperación/invitación desde Mailpit y revisión final de
  políticas RLS con intentos negativos directos. El gateway de pagos, SMTP real,
  WhatsApp/Meta, CFDI y telemetría IoT no forman parte del MVP local validado;
  permanecen como integraciones externas/manuales o fuera de alcance.

### Verificación adicional de entorno para testers

- Se volvió a comprobar el Docker de la app: `downtimeos-downtimeos-1` está
  `healthy`; `/api/health`, `/`, `/acceso`, `/registro`, Supabase Auth y Mailpit
  respondieron HTTP 200. La suite pasó **262/262**, `npm run build` terminó
  correctamente y `npm run smoke` confirmó 20 rutas y 15 APIs protegidas.
- Una pasada HTTP adicional confirmó que `/recuperar`, `/activar`, `/equipo`,
  `/plantas`, `/suscripcion`, `/estructura` y `/configurar-planta` sirven una
  respuesta; sin sesión, `/api/cuenta` y las lecturas de equipo, plantas,
  estructura y suscripción responden 401. Un POST de registro deliberadamente
  incompleto respondió 400 (“Falta el correo”) antes de contactar Auth o crear
  datos.
- El intento de E2E exigió confirmación y apuntó al directorio local de
  Supabase `downtimeos-supabase-check-17e0d9c049a54fb4b73727f6c11b5df4`.
  El preflight encontró usuarios Auth y abortó antes de crear usuarios o datos.
  Por tanto, pese al nombre del directorio, esa instancia no es desechable y no
  certifica una corrida E2E nueva. No se limpió, reinició ni modificó.
- El Docker de la app no recibe credenciales explícitas
  `DOWNTIMEOS_LOCAL_DASHBOARD_ADMIN_EMAIL/PASSWORD`. Sus logs registran
  “La administración no está configurada”; el panel y la aprobación manual de
  pagos no se deben considerar disponibles para un piloto hasta configurar y
  probar credenciales internas locales.
- La compilación del host muestra `.env.local` como fuente de entorno, mientras
  que el launcher Docker carga variables `DOWNTIMEOS_LOCAL_*` por separado. No
  se copió ninguna credencial de un ambiente a otro.
- Conclusión de alcance: las rutas públicas y los rechazos anónimos sí tienen
  evidencia actual; el ciclo autenticado con correo, roles, invitaciones y
  pagos aún requiere un Supabase vacío y aislado. No iniciar otra instancia ni
  tocar otros stacks hasta confirmar su directorio, proyecto, puertos y
  volúmenes; no se detuvieron ni eliminaron contenedores o volúmenes.
- La inspección de `/plantas` detectó que se renderizaba la caché de membresías
  y el formulario de alta antes de que terminara el GET autorizado. Ahora la
  lista y el formulario solo aparecen después de una respuesta exitosa; 401
  conserva retorno a la ruta, 403 muestra denegación y los demás errores dan
  reintento. Regresión añadida en `test/plantas-estilos.test.js`; suite
  **263/263**, build correcto, Docker de la app reconstruido y `healthy`,
  smoke **20 rutas / 15 APIs**.
- La inspección de Equipo detectó que errores de red o una respuesta JSON
  inválida podían dejar “Verificando permisos…” indefinidamente y una lista
  ausente podía romper el render. Ahora se valida el contrato de invitaciones,
  cada error termina en denegación/error recuperable, y una sesión vencida
  vuelve a Acceso con retorno a Equipo. Regresión añadida en
  `test/equipo-correo-local.test.js`; suite **264/264**, build correcto,
  contenedor de app `healthy` y smoke **20 rutas / 15 APIs**.
- Suscripción ahora comprueba el contrato completo de la respuesta antes de
  permitir que se muestren planes, pagos o formularios; una respuesta HTTP 200
  incompleta se trata como error recuperable, no como cuenta sin suscripción.
  Regresión en `test/cobros-contrato-mvp.test.js`; suite **265/265**, build y
  Docker correctos, contenedor `healthy`, página `/suscripcion` HTTP 200,
  API sin sesión HTTP 401 y smoke **20 rutas / 15 APIs**.

### Revalidación de preparación para testers (2026-10-03)

- `npm test`: **265/265**; `npm run build`: correcto; `npm run smoke`:
  **20 rutas y 15 APIs** protegidas comprobadas. El servicio Docker de la app
  está `healthy` y `/api/health` responde HTTP 200.
- Revisión de navegador sin iniciar sesión ni enviar formularios: Acceso,
  Registro y Recuperación muestran sus campos y navegación; `/plantas`,
  `/equipo` y `/suscripcion` redirigen a Acceso conservando el `returnTo`.
  Fue una inspección de estructura accesible y navegación, no una certificación
  de píxeles responsive.
- El Supabase Local activo contiene **104 usuarios Auth**. Se consultó de forma
  administrativa de solo lectura; no se imprimieron correos, ni se crearon o
  borraron usuarios. Por eso no se declaró desechable ni se ejecutó el runner
  E2E que escribe cuentas y datos.
- El contenedor actual tiene URL/llaves de Supabase configuradas, pero no tiene
  credenciales `DASHBOARD_ADMIN_EMAIL/PASSWORD`; la aprobación manual de pagos
  desde el panel interno no está habilitada en este entorno.
- La conciliación del historial local terminó: las **32 de 32** migraciones
  ahora coinciden con `supabase/migrations`. Antes de marcar como aplicadas las
  11 versiones que faltaban se comprobó en PostgreSQL la presencia de sus
  efectos (funciones, triggers, restricciones, catálogo y grants); sus SQL no
  se repitieron. Después se aplicó con Supabase CLI únicamente
  `20261003000000_drop_legacy_report_rpc.sql`, que elimina una función obsoleta
  y no modifica filas de usuarios ni datos de planta.
- Auditoría SQL read-only de privilegios: `anon` y `authenticated` no pueden
  leer `leads`; `authenticated` no puede leer `tarifa_hora` ni escribir eventos;
  `anon` no puede insertar leads ni leer mensajes; tampoco puede leer análisis
  de IA el rol autenticado. RLS está habilitado en membresías, invitaciones,
  activos y eventos, y hay siete causas operativas. Esto comprueba grants y
  presencia de RLS, no aislamiento entre dos JWT/tenants; ese caso sigue
  pendiente en E2E autenticado.
- Revisión read-only adicional: existe la tabla de interruptores globales, el
  trigger de periodicidad está habilitado, la RPC de estructura usa lock
  transaccional, existen los dos triggers de folios, y la RPC legacy de reporte
  no es ejecutable por `anon` pero sí por `service_role`. Los privilegios de
  `planta_reportes` también están limitados a `service_role` (sin SELECT de
  `authenticated`). Son comprobaciones de metadatos y grants; no prueban el
  comportamiento de cada transacción de negocio.
- `supabase db lint --local --schema public` ya no reporta errores tras retirar
  la RPC antigua `planta_reportar_paro(text,...)`, cuyo
  `ON CONFLICT(activo_id)` no coincidía con la clave `(planta_id, activo_id)`.
  Quedan tres warnings por variables PL/pgSQL sin uso, sin error de ejecución.
- El lanzador Docker ahora identifica en consola la instancia Supabase que
  seleccionó y advierte si tomó automáticamente la histórica con datos; no
  cambia ni borra su contenido. Regresión agregada a
  `test/docker-healthcheck.test.js`; la suite pasó **269/269** y se
  verificó la advertencia con `-ComposeArgs ps` (consulta sin cambios). También
  advierte si faltan credenciales del panel interno, rechaza cuando solo se
  define una y acepta puertos Supabase alternos; esto último se ejercitó con
  Compose simulado en `54341`, sin iniciar contenedores.
- Restan para que el equipo pruebe como usuario final: sesión autenticada y
  permisos por rol en navegador, correo/invitación/recuperación de extremo a
  extremo en un entorno aislado, panel/aprobación de pagos configurado, y QA
  visual responsive de todas las pantallas y estados de error/vacío.

### Revalidación puntual (2026-10-03)

- `npm test`: **269/269**; `npm run build`: correcto; `npm run smoke`:
  **20 rutas y 15 APIs protegidas**.
- La app Docker está `healthy`; `/api/health`, Auth local y Mailpit responden
  HTTP 200. Compose reconoce el servicio web cuando se consulta mediante
  `scripts/docker-local.ps1 -ComposeArgs ps`, que carga las variables locales.
  Ejecutar `supabase status` desde la raíz del repo no detecta el nombre de
  contenedor porque la instancia activa usa el proyecto temporal histórico; el
  lanzador encuentra ese proyecto y advierte que conserva datos existentes.
  Aclaración: `supabase migration list --local --workdir .` sí conectó a esa
  misma base y confirmó **32/32** migraciones del repo alineadas con el
  historial registrado; el fallo de `status` no implica desfase de migraciones.
- En navegador se inspeccionaron Acceso, Registro y Recuperación: títulos,
  campos, botones y navegación están presentes. No se enviaron formularios ni
  se inspeccionaron aquí los píxeles/responsive.
- El log de `supabase_vector` confirma que se detiene al no poder alcanzar el
  host Docker por IPv6 (`Network unreachable`). Auth, Postgres, Mailpit y la app
  siguen respondiendo; es un fallo del colector de logs, no evidencia de caída
  del flujo principal.
- No se ejecutó el E2E con escrituras: la base activa conserva usuarios y
  organizaciones de desarrollo. Continúan sin verificación actual de extremo
  a extremo la sesión autenticada y sus roles, correos de invitación y
  recuperación, y la aprobación administrativa del plan; las credenciales
  locales del panel administrativo no están configuradas.

### Avance de estabilización y preparación de pruebas (2026-10-03, continuación)

- Tres agentes trabajaron en paralelo: revisión de onboarding/auth, revisión
  de suscripciones/correo y mejoras UX de estados vacíos/reintentos. Se
  integraron los cambios tras revisar y volver a ejecutar las pruebas.
- El registro ahora conserva el usuario Auth y muestra estado incierto si la
  RPC pudo confirmar en servidor pero se perdió la respuesta; solo limpia Auth
  ante un rechazo SQL con rollback identificable. Evita dejar la empresa huérfana
  por un timeout ambiguo.
- Los avisos de vencimiento usan leases con token de fencing y recuperan reservas
  abandonadas, evitando que un proceso detenido deje el correo bloqueado para
  siempre. Los estados vacíos de `/estructura` y el reintento del panel de
  solicitudes administrativas ahora guían al usuario.
- `planta_descartar_solicitud` valida el folio antes de bloquear el activo,
  manteniendo el orden de locks para carreras concurrentes. Se aplicaron las
  migraciones `20261003000002` y `20261003000100` a la Supabase local del repo;
  el listado posterior confirmó 34/34 migraciones alineadas. No se borraron
  cuentas ni se reinició la base.
- Se reconstruyó la app Docker con `npm run docker:local`; `/api/health`
  responde `ok`, Mailpit responde HTTP 200 y la app está `healthy`. El lanzador
  eligió explícitamente en consola el stack histórico de Temp porque el CLI
  `status` no reconoce el nombre del proyecto desde la raíz. Ese stack conserva
  datos existentes y no se usó para E2E con escrituras.
- Verificación actual: `npm test` **282/282**, `npm run build` correcto,
  `npm run smoke` confirma 20 rutas y 15 APIs protegidas; lint SQL sin errores
  (tres avisos de variables no usadas).
- Siguen bloqueando la prueba final del equipo: E2E autenticado en una base
  desechable limpia; recorrido real de confirmación/invitación/recuperación por
  correo; credenciales locales seguras para aprobar pagos; prueba de permisos
  por rol y QA visual responsive. La configuración activa de Auth autoconfirma
  usuarios, por lo que el correo de confirmación de alta aún no se valida como
  en producción. No se hicieron registros de prueba ni se envió correo nuevo.

### Resiliencia de interfaz y nuevo estado local (2026-10-03, tarde)

- La auditoría de pantallas encontró y se corrigieron cuatro estados que podían
  confundir al usuario: registro aceptado sin sesión, invitación guardada con
  GET posterior fallido, cambios de estructura guardados con GET fallido y
  botones de facturación vulnerables a doble clic. Ahora se ofrece continuar al
  acceso, se comunica el resultado real de cada mutación y se bloquean acciones
  duplicadas mientras están en curso.
- Registro ofrece reenviar confirmación cuando Auth lo requiere. El nuevo
  endpoint usa Auth público, dirige a `/activar`, valida el correo, conserva
  respuesta genérica ante errores y respeta el rate limit de Supabase. Su lógica
  está probada con dependencias simuladas; todavía falta ejercer el envío real
  en un stack desechable/Mailpit.
- Se corrigió un test legado para que compruebe el bloqueo síncrono por `useRef`
  del registro en vez de exigir el guard previo basado solo en `useState`.
- Verificación posterior a integración: `node --test --test-reporter=spec
  test/*.test.js`: **301/301**; `npm run build`: correcto; `npm run smoke`:
  20 rutas y 15 APIs protegidas; `git diff --check`: sin errores de whitespace
  (solo avisos preexistentes de conversión LF/CRLF).
- Se reconstruyó la imagen Docker y el contenedor `downtimeos` quedó healthy;
  `/api/health`, Auth y Mailpit responden HTTP 200. El comando de Compose solo
  lista un contenedor web de la app. Sigue conectado al Supabase histórico de
  Temp con datos existentes; el E2E con escrituras no se ejecutó. Sin
  `DOWNTIMEOS_LOCAL_DASHBOARD_ADMIN_EMAIL/PASSWORD`, el panel de aprobación de
  pagos sigue deshabilitado.
- El siguiente paso de verificación integral es levantar un Supabase Local
  desechable con puertos propios, ejecutar registro/confirmación, invitaciones,
  roles, recuperación, estructura, suscripción/comprobante/aprobación y revisar
  la interfaz en móvil y escritorio. No apuntar el runner al stack histórico.

### E2E completo en infraestructura desechable (2026-10-03, cierre)

- Se levantó un Supabase local independiente (`downtimeos-mvp-e2e-20261003`)
  en puertos alternos. Las 34 migraciones del repo se aplicaron desde cero y
  `supabase migration list` confirmó 34/34 alineadas; SQL lint no encontró
  errores (tres avisos no bloqueantes por variables PL/pgSQL no usadas).
- `scripts/e2e-mvp-local.ps1` pasó el recorrido integral: alta y configuración
  de dos empresas, aislamiento entre tenants y RLS, suscripción/solicitud,
  comprobante privado y revisión administrativa local, cancelación/renovación,
  límites del plan Starter, invitaciones por correo para Dirección, Finanzas,
  Operaciones y Operadores, flujo de paro/mantenimiento, folios concurrentes,
  permisos y redacción financiera, vencimiento y bloqueo de altas.
- Además se validó el alta real con confirmación por Mailpit, reenvío sujeto a
  rate limit, callback local, inicio de sesión y asignación del rol Dirección.
  El primer reenvío inmediato fue limitado correctamente; después del intervalo
  permitido se entregó y abrió el correo de confirmación.
- Stack desechable detenido después de las pruebas con `supabase stop --no-backup`.
  No se borró ni modificó el stack histórico de Supabase, sus usuarios o sus
  datos. La app original en Docker permanece independiente.
- Regresión actual: **301/301** pruebas Node, build correcto, smoke de 20 rutas
  y 15 APIs protegidas. La app Docker previamente reconstruida reportó estado
  saludable.
- Pendiente antes de invitar testers no técnicos: inspección visual real en
  escritorio/móvil de todas las pantallas y estados, verificar el recorrido
  navegador por rol (no solo APIs), comprobar accesibilidad/usabilidad de las
  acciones críticas y decidir/configurar credenciales locales para la revisión
  administrativa. No se validaron SMTP de producción, WhatsApp/PDF/IA externo,
  CFDI ni pruebas de rendimiento a escala; no son una condición para un piloto
  local acotado, pero sí límites que comunicar al equipo.

### QA visual y corrección de estilos (2026-10-03, continuación)

- Inspección real en navegador de `/registro`, `/acceso` y `/recuperar` en un
  viewport estrecho: las tres muestran marca, tipografía, fondos, inputs y CTA
  consistentes; los textos se acomodan y no se aprecia desbordamiento horizontal.
  `/plantas` sin sesión redirige a `/acceso` como se espera.
- Las pantallas protegidas no se inspeccionaron con una sesión autenticada en
  este navegador; por tanto, la comprobación de layout de Suscripción, Equipo,
  Configurar planta y paneles por rol sigue pendiente en estados reales.
- La inspección del CSS servido detectó selects nativos blancos en facturación:
  una regla existente solo fijaba paleta, sin borde/alto/padding. Se completó el
  estilo oscuro y se añadieron espacios responsivos entre tarjetas. La hoja CSS
  ya se sirve desde el contenedor reconstruido.
- Regresión posterior a esta corrección: suite **301/301**, smoke **20 rutas y
  15 APIs**, health **200** y contenedor web `healthy`.
- Para cerrar QA visual todavía hay que validar vistas autenticadas por rol,
  estados de error/vacío con datos semilla y viewport amplio real, además del
  recorrido completo de operador en navegador. No se ingresaron credenciales ni
  se enviaron formularios en la inspección visual de esta continuación.

### Verificación actual de seguimiento (2026-10-03, cierre de jornada)

- En el checkout actual: `npm test` **345/345**, `npm run build` correcto,
  `npm run smoke` **20 rutas y 15 APIs protegidas**, y `git diff --check` sin
  errores de whitespace (solo avisos CRLF preexistentes).
- La app se reconstruyó en Docker y quedó `healthy`; `/api/health` responde
  `ok: true`. La reconstrucción apuntó explícitamente a Supabase Local y no
  reinició ni eliminó los servicios/datos del stack Supabase.
- El historial SQL del Supabase local de desarrollo está alineado **36/36**,
  hasta `20261003000300_bloquear_activacion_periodo_legacy.sql`. Se verificó
  que el trigger nuevo está activo y que una tentativa controlada de activar
  la solicitud mensual histórica fue rechazada sin cambiar su estado.
- El Supabase local contiene datos reales de desarrollo (45 organizaciones,
  104 perfiles y 104 membresías, además de registros de invitaciones, planta y
  facturación),
  por lo que no se ejecutó ahí otra corrida E2E que cree cuentas, pagos o
  archivos. La corrida E2E integral anterior sí está registrada arriba, pero
  corresponde a la cadena de 34 migraciones anterior a las dos migraciones
  añadidas después.
- Se encontró una solicitud mensual histórica pendiente. El periodo mensual
  nuevo ya está rechazado en la base; el panel interno la marca como no
  ofrecida y no permite activarla ni concederle piloto. En Suscripción, quien
  tenga permiso de facturación puede cancelar esa solicitud para liberar una
  nueva solicitud semestral/anual; se conserva el historial y el mensaje
  advierte que cancelar no procesa una devolución. No se canceló el registro
  durante la auditoría. Se invocó la cancelación dentro de una transacción de
  prueba que se revirtió; se verificó que la acción libera la solicitud y que
  el registro real permaneció en `solicitada` después de la prueba.
- Lectura efectiva de privilegios: las tablas críticas consultadas no conceden
  `INSERT` ni `UPDATE` a `anon` o `authenticated`. También se comprobó que no
  hay máquinas con orden de etapa fuera de 1–99.
- En el navegador local se verificaron `/acceso`, `/registro` y `/recuperar`;
  `/suscripcion` y otras rutas protegidas redirigen a Acceso sin sesión. Sigue
  sin hacerse el recorrido visual autenticado por Dirección, Finanzas,
  Operaciones y Operador. No se introdujeron credenciales durante esta pasada.
- La aprobación administrativa de pagos no está habilitada en la app Docker
  actual porque faltan credenciales locales `DASHBOARD_ADMIN_EMAIL` y
  `DASHBOARD_ADMIN_PASSWORD`. SMTP de producción, WhatsApp/IA externos y las
  decisiones comerciales/fiscales siguen siendo pendientes separados del
  funcionamiento local.

### Continuación de verificación (2026-10-03)

- Se corrigió un caso real en la carga de comprobantes: si la confirmación de
  recepción se guardaba y luego fallaba la recarga de la pantalla, el `catch`
  global mostraba un error como si la carga hubiera fallado. Ahora informa que
  el comprobante sí se recibió, que se puede recargar la vista y que no se debe
  volver a subir el archivo. Regresión añadida a
  `test/comprobantes-suscripcion.test.js`.
- Verificación tras el cambio: `npm test` **346/346**, `npm run build`
  correcto, `npm run smoke` **20 rutas / 15 APIs protegidas**; la app Docker se
  reconstruyó, quedó `healthy` y `/api/health` respondió `ok: true`.
- El comando `docker compose ps` ejecutado directamente sigue sin tener las
  variables temporales que el lanzador carga en su proceso. Para consultar el
  servicio sin ese error se verificó `scripts/docker-local.ps1 -SupabaseWorkdir
  <ruta-del-Supabase-local> -ComposeArgs ps`. El stack actualmente conectado
  está bajo `%LOCALAPPDATA%\Temp`, es histórico y tiene datos; se usó su ruta
  explícitamente para reconstruir solo la app, sin reiniciar ni alterar la base.
- Una auditoría independiente de privilegios/RLS no encontró fuga entre
  organizaciones. Sí observó funciones SQL históricas de tarifa/capacidad con
  permisos `EXECUTE` por defecto; con los grants actuales no se confirmó una
  lectura explotable de tarifas. Queda como hardening para revisar, no como
  vulnerabilidad demostrada.
- La instancia Docker todavía carece de credenciales locales del panel interno;
  no se puede probar desde ella la aprobación administrativa de pagos.
  Tampoco se ejecutó el E2E integral final porque la base conectada contiene
  datos persistentes y el runner exige una base desechable vacía.

### Hardening y validación efectiva de RPC (2026-10-03)

- Se verificó en PostgreSQL con `has_function_privilege` que las RPC antiguas
  y las variantes nuevas de cálculo de tarifa/capacidad podían ejecutarse
  desde roles cliente por los permisos predeterminados. Los permisos de
  columnas/RLS evitaban confirmar una lectura de tarifa, pero el acceso no era
  necesario para el cliente web.
- Se añadieron las migraciones
  `20261003000400_restringir_rpc_legacy_tarifas.sql` y
  `20261003000500_restringir_rpc_tarifas_multitenant.sql`: `anon` y
  `authenticated` ya no pueden ejecutar ninguna de las cuatro firmas; se
  conserva `service_role` para el servidor. Se aplicaron solo al Supabase
  local, sin mutar filas de negocio ni el proyecto remoto.
- Reconsulta efectiva tras aplicar: los tres permisos `EXECUTE` consultados
  son `false` para `anon`/`authenticated` y `true` para `service_role`.
  `supabase migration list --local` quedó alineado **38/38**.
- Regresión final: `npm test` **347/347**, `npm run smoke` **20 rutas / 15
  APIs protegidas**, `/api/health` responde `ok: true`. La aprobación real de
  pagos y el E2E completo siguen pendientes por ausencia de credenciales del
  panel interno y de una base de prueba desechable.
- Auditoría del envío de invitaciones: el backend guarda primero la invitación
  y la membresía inactiva, solicita el mensaje a Supabase Auth y revierte la
  preparación si Auth devuelve un fallo. El flujo y reenvío están cubiertos por
  pruebas en memoria; la UI local especifica que los correos van a Mailpit y no
  a Gmail/Outlook. No se comprobó entregabilidad SMTP externa ni se abrió el
  buzón local durante esta revisión.
- Los dos mensajes de log de “La administración no está configurada” durante
  los últimos diez minutos fueron respuestas `503` esperadas del endpoint de
  suscripciones que `npm run smoke` consulta deliberadamente cuando no hay
  sesión/credenciales internas. No hubo marcas de excepción de runtime; no son
  fallos de Auth, base de datos ni del registro de clientes.

### E2E histórico registrado sobre 38 migraciones (2026-10-03; no certifica el estado actual)

- El registro anterior afirmó que se creó un Supabase desechable con nombre y
  puertos alternos. La CLI instalada durante la revalidación posterior no
  ofrece el comando `stack`; no se pudo reproducir de manera independiente el
  mecanismo descrito, así que este resultado queda como antecedente histórico,
  no como certificación del estado actual.
- El registro anterior afirmó que `scripts/e2e-mvp-local.ps1 -Stack` obtenía
  credenciales con la CLI. La ruta se encontró incompatible con la CLI
  disponible (detalles en la revalidación posterior) y se corrigió para usar
  `supabase status --output env`.
- El registro anterior reportó que **38 migraciones** se aplicaron desde cero
  y que el E2E terminó con suites en `PASS`: registro y
  confirmación Mailpit para dos tenants; configuración; aislamiento y RLS;
  solicitud/pago/comprobante privado; cancelación y renovación; administración
  local temporal; recuperación; invitaciones y aceptación para los cuatro
  roles; topes Starter; ciclos STOP→RUN/Mantenimiento; permisos/redacción
  financiera; colisiones de folio; vencimiento y bloqueo de altas.
- El registro anterior dijo que el stack temporal fue destruido y que el
  histórico siguió intacto. La CLI actual no permite verificar la operación
  `stack list`; este registro no sustituye la comprobación actual del stack.
- El registro anterior reportó regresión Node **347/347**, smoke de 20 rutas y
  15 APIs, y alineación de 38 migraciones en ese momento. No es evidencia de
  ejecución integral sobre las 40 migraciones actuales ni sobre producción.
- El resumen E2E deja expresamente fuera: transición futura de renovación por
  calendario, cargas de 10k/100k, CFDI/retenciones y entregabilidad de
  proveedores externos WhatsApp/PDF/IA/SMTP. No son pruebas que este E2E local
  simule. Sigue pendiente la inspección visual autenticada por rol en
  navegador real; el E2E comprueba esos permisos por API, no el diseño visual
  de cada panel.

### Revalidación del stack activo, correo y runner E2E (2026-10-03)

- En la revalidación original, la cadena y la base local activa tenían
  **40 migraciones** aplicadas, sin faltantes ni versiones ajenas. Las dos
  migraciones más recientes de privilegios están activas: el
  rol `authenticated` no puede leer `planta_solicitudes` ni ejecutar la RPC de
  cambios de miembro; `service_role` sí puede ejecutar esa RPC.
- La base activa no es desechable: contiene 45 organizaciones, 45 plantas y
  miembros/invitaciones persistentes. El E2E no se ejecutó contra ella. El
  buzón local respondió, pero actualmente tiene cero mensajes; Auth local
  tiene habilitado el proveedor de correo y requiere confirmación. No se envió
  ningún correo durante esta revalidación, por lo que la entrega de invitación
  sigue sin certificarse en vivo.
- Se detectó que `scripts/e2e-mvp-local.ps1 -Stack` usaba `supabase status`
  con flags que no existen en la CLI 2.119.0 instalada (`--stack`, `--env` y
  `--output-format`). Se eliminó ese camino no compatible; el runner ahora usa
  `supabase status --output env --workdir ...` y mantiene la validación de
  loopback, puerto esperado y base desechable antes de iniciar escrituras.
  `test/e2e-runner-safety.test.js` verifica esa restricción.
- Revalidación después del ajuste: **363/363 pruebas** pasan; build Next.js,
  smoke de 20 rutas/15 APIs, auditoría de dependencias (cero vulnerabilidades
  de producción), ocho rutas HTTP y salud de app, Auth, Postgres y buzón local
  responden correctamente.
- Revisión de configuración del contenedor de app: `CRON_SECRET`, las dos
  variables de Resend, las credenciales de Meta y las llaves de proveedores de
  IA están vacías. Por eso el envío de renovación por Resend, WhatsApp real y
  generación de IA con proveedor externo no están activos en este contenedor;
  el lanzador solo carga WhatsApp si se solicita explícitamente. No se llamó a
  ningún proveedor externo durante esta verificación.
- Esto no sustituye el E2E histórico: aquella corrida documentada cubrió 38
  migraciones y no se ha repetido con el runner corregido y las 40 actuales.
  Falta hacerlo en un Supabase realmente desechable y revisar visualmente las
  pantallas autenticadas por rol. No se tocaron los datos del stack activo.

### Correcciones de auditoría pendientes de activar y probar (2026-10-03)

- Se retiró la mutación aislada de estado en `/api/planta/estados`; la ruta
  responde conflicto e indica usar los flujos atómicos de reporte/cierre.
- El rechazo heredado ahora pasa por el descarte atómico; la aprobación solo
  cambia una solicitud que sigue pendiente y abierta. El cierre heredado también
  genera el evento, cambia la máquina a RUN y cierra solicitudes en una sola RPC.
  El borrado directo de solicitudes devuelve conflicto para preservar auditoría.
- Un administrador delegado ya no puede invitar ni promover miembros a
  Dirección o Finanzas. Se agregaron guardas de API y una nueva migración para
  repetir la restricción en PostgreSQL. Dos migraciones nuevas endurecen la
  RPC de descarte y el cambio de roles.
- Verificación de checkout: `npm test` **364/364**, `npm run build` completó,
  y `npm run smoke` pasó (20 rutas, 15 APIs). El smoke consultó el contenedor
  que ya estaba corriendo, por lo que no prueba que ese contenedor incluya
  estos cambios recientes.
- El checkout ahora tiene **43 migraciones**, mientras que la base local
  poblada sigue en **40**: las tres nuevas están pendientes de aplicar. No se
  aplicaron a la base existente. El E2E de punta a punta y la confirmación
  visual de roles siguen pendientes de una instancia realmente desechable.
- Una revisión posterior encontró y corrigió dos inconsistencias adicionales:
  la compensación de una invitación concurrente ya no borra la membresía que
  necesita la invitación ganadora; y cancelar una solicitud con comprobante
  ahora marca ese intento como anulado en la misma transacción, conservando el
  archivo privado para auditoría. La cookie del panel administrativo también
  usa `Secure` en el Compose de producción aunque no se despliegue en Vercel.
- Regresión después de esas correcciones: `npm test` **367/367** y
  `npm run build` completó. Los tests de concurrencia y cancelación son pruebas
  automatizadas locales; todavía falta ejecutarlos con PostgreSQL y Storage
  reales en el stack desechable.
- En una pasada posterior se retiraron del repositorio los tres helpers sin uso
  que podían volver a mutar estado de máquina, cerrar solicitudes sin evento o
  borrar solicitudes sin auditoría. La regresión quedó en **368/368** y el build
  volvió a completar. El contenedor sigue sin reconstruirse mientras las tres
  migraciones estén pendientes en la base poblada.
- La imagen Docker actual también se construyó con etiqueta separada
  `downtimeos:audit-20261003`; se probó en un contenedor temporal sin conexión a
  Supabase. `/acceso`, `/registro`, `/recuperar`, `/suscripcion` y `/api/config`
  respondieron HTTP 200. El contenedor temporal se detuvo y eliminó; el que
  atiende `localhost:3000` no se tocó y su imagen es distinta de la nueva.
  Esto verifica empaquetado y render básico, no autenticación, correo ni RPC.

### Revalidación posterior de app servida y cliente legacy (2026-10-03)

- `npm test`: **369/369**; incluye una prueba nueva que garantiza que el
  cliente legacy no publique mutaciones directas de estado/solicitud y conserve
  los métodos confirmados. `npm run build` ya había completado después del
  cambio de cliente; el test agregado después no altera el bundle.
- `npm run smoke` sobre `localhost:3000`: **20 rutas y 15 APIs protegidas**
  respondieron según el contrato sin sesión. Esto verifica el servicio que
  está corriendo, no certifica acciones autenticadas.
- Docker informa que `downtimeos-downtimeos-1` está `healthy`, pero corre la
  imagen `sha256:25b74f…`; la imagen recién construida y probada por separado
  tiene `sha256:b412d2…`. Por tanto, las correcciones nuevas del checkout no
  están servidas actualmente en `localhost:3000`.
- La lectura directa de `supabase_migrations.schema_migrations` del Postgres
  local confirma 40 versiones aplicadas; el checkout contiene 43 migraciones.
  Se mantuvieron intactos el contenedor y la base, sin aplicar migraciones.
- Consulta SQL de solo lectura en la instancia actualmente conectada: **45
  organizaciones, 45 plantas y 104 usuarios Auth**. Esto confirma que la base
  no es vacía ni desechable; el preflight del E2E debe bloquearla. Los logs de
  la app en los últimos 30 minutos no mostraron excepciones no controladas.
- La pestaña abierta de acceso expone el formulario, enlaces a recuperación y
  registro, y el botón de inicio en el árbol accesible. No se hicieron envíos
  de formularios ni una inspección visual completa autenticada por rol.
- Se verificó presencia sin imprimir valores: `.env.local` sí contiene las
  llaves de Meta (token, Phone Number ID y WABA ID) y proveedores IA, pero el
  contenedor no recibió ninguna. El lanzador Compose las aísla por diseño y
  solo copia WhatsApp desde `.env.local` con `-WhatsAppDesdeEnvLocal`; se añadió
  ahora la opción opt-in `-IADesdeEnvLocal`, que valida el proveedor y su llave
  antes de pasarlos. Esta nueva opción no se ejecutó ni se reinició el
  contenedor, que aún usa proveedor `meta` con alertas/aprobaciones desactivadas.
  WABA ID no aparece consumido por el código actual; para envío, las
  credenciales requeridas son token y Phone Number ID. Resend/CRON sí están
  ausentes tanto del archivo local como del contenedor.
- El runner E2E completo continúa sin ejecutarse en una base desechable durante
  esta pasada; no se cambió el stack activo ni se reiniciaron contenedores.
- Auditoría manual del selector de permisos detectó que un administrador
  delegado veía `Dirección` al editar roles aunque el servidor lo rechaza. La
  opción ahora se reserva al titular; si el miembro ya tiene Dirección o
  Finanzas, el delegado debe escoger explícitamente un rol ordinario antes de
  guardar. Prueba UI específica, regresión **369/369** y build Next.js pasaron.
  El contenedor actual no se reconstruyó, por lo que esta mejora sigue en el
  checkout hasta que se actualice Docker de forma coordinada con la base.

### Auditoría de integridad, correo y sesión (2026-10-03)

- Se cerró un caso de integridad: el alta de un paro aceptaba `desde` del
  cliente sin validar rango, mientras el cierre rechaza paros mayores a 72 h.
  La RPC de reporte ahora exige un instante no futuro (tolerancia de cinco
  minutos) y dentro de las últimas 72 h. La migración actualizada
  `20261002000700_retiro_reporte_operador.sql` está pendiente en bases ya
  instaladas; no se aplicó a la base poblada.
- Reclasificar una solicitud ahora usa la RPC transaccional nueva
  `20261003001100_endurecer_reclasificacion_solicitud.sql`, que acepta solo
  solicitudes pendientes y abiertas y valida la causa en la misma operación.
  Esta migración tampoco se aplicó a la instancia activa.
- El cron valida Resend y la URL segura antes de cambiar estados de periodos,
  para no mutarlos y luego responder 503 por correo sin configurar.
- Almacenamiento de sesión bloqueado ya no se confunde con caída de red en
  login/registro. `fetchConSesion` también tolera que el acceso a
  `localStorage` lance una excepción.
- Verificación: suite **374/374**, `next build` correcto y `git diff --check`
  sin errores (solo advertencias de conversión LF/CRLF en archivos modificados).
- Esto aún no está servido en Docker: no se reconstruyó/reinició y no se
  aplicaron migraciones. Para certificar el flujo real falta un Supabase local
  vacío y desechable; la instancia activa tiene datos de cuentas y no debe
  usarse para pruebas E2E con escritura.

### Recorrido aislado y revalidación de UX (2026-10-03)

- Para validar sin intervenir los contenedores existentes, se creó un proyecto
  Supabase Local temporal `downtimeos-mvp-qa-20261003` con puertos 55421–55429.
  La cadena actual completa (**44 migraciones**, incluida la de reclasificación)
  se aplicó desde cero y `migration list --local` confirmó que no hay versiones
  pendientes.
- El E2E de escritura completó **todas las suites implementadas**: Mailpit,
  confirmación/activación, registro y login de dos tenants, aislamiento,
  onboarding, pagos y comprobante privado, validación administrativa,
  recuperación de contraseña, cuota Starter, invitaciones Dirección/Finanzas/
  Operaciones/Operador, permisos/redacción financiera, ciclos STOP→RUN,
  expiración y 64 colisiones de folio. No se borraron datos del proyecto QA;
  sus organizaciones/cuentas sintéticas quedaron en esa base aislada.
- El servidor Next del checkout está disponible en `http://127.0.0.1:3002`,
  conectado únicamente al Supabase QA. Smoke HTTP: **20 rutas y 15 APIs
  protegidas** correctas; inspección de navegador: formularios de acceso y
  registro presentes con labels y controles accesibles. La inspección visual
  de todas las pantallas autenticadas no está certificada.
- El segundo pase cerró otros problemas: callback de activación/invitación y
  selector de planta ya manejan almacenamiento bloqueado con mensajes
  recuperables; el selector valida el perfil antes de guardar/navegar; los
  destinos de retorno permitidos incluyen los tres tableros operativos sin
  aceptar URLs externas. Suite **375/375** y build de producción correcto.
- Dos alertas de la revisión de cobros no se confirman como bloqueantes: el
  esquema no tiene unicidad que impida iniciar otra carga de comprobante si
  quedó una carga huérfana, y la cancelación de un periodo ya pagado indica
  explícitamente que la devolución requiere gestión manual. Se mantienen como
  deuda de operación/limpieza, no como defectos reproducidos.
- Los contenedores originales y `localhost:3000` permanecen intactos. El QA en
  puerto 3002 no demuestra que la imagen Docker original esté actualizada ni
  sustituye el futuro instructivo del equipo; sirve como entorno aislado para
  seguir verificando sin arriesgar datos existentes.

### Auditoría de entorno y retornos de acceso (2026-10-03)

- Comparación directa del historial SQL: el Supabase QA aislado tiene las 44
  migraciones actuales aplicadas (44/44). El stack histórico que atiende el API
  `localhost:54321` tiene 40/44; faltan `20261003000800`–`20261003001100`.
  No se aplicaron esas migraciones a la base histórica, que conserva datos.
- `localhost:3000` responde desde el contenedor Docker, pero conecta con el
  Supabase histórico (`54321`), no con el QA. `localhost:3002` es Next en modo
  desarrollo conectado al QA (`55421`), no un contenedor de testers. El puerto
  3001 no tiene servicio escuchando. La pestaña antigua de ese puerto debe
  considerarse obsoleta.
- El smoke HTTP pasó en ambos servicios antes del último cambio y volvió a
  pasar en el QA después: 20 rutas y 15 comprobaciones de APIs protegidas. La
  suite actual es **376/376** y el build de producción terminó correctamente.
- Se corrigió el retorno de login para que `/equipo`, `/estructura`,
  `/configurar-planta` y `/suscripcion` solo se honren cuando el perfil validado
  tiene el rol o permiso requerido; de lo contrario usa el tablero habitual
  del rol. La suite contiene casos positivos y negativos para esos permisos.
- La auditoría detectó que una cookie inventada permite recibir el cascarón
  HTML de `/operaciones`; una llamada a `/api/planta` con Bearer inválido sí
  devuelve 401 y no se reprodujo exposición de datos de planta. Se clasifica
  como endurecimiento pendiente del límite entre página y API, no como fuga de
  datos confirmada. Una posible validación de cookie en middleware debe
  preservar la renovación de access tokens que hoy realiza el cliente.
- Se descartó como defecto confirmado el caso de invitar Operadores antes del
  onboarding: el flujo normal rechaza invitaciones hasta configurarlo y la API
  inicial solo permite Dirección/Admin. No se cambió ese flujo sin una ruta
  válida que reproduzca el supuesto problema.
- **El entorno Docker para testers aún no está listo:** su base tiene cuatro
  migraciones menos que el checkout y `3002` es un servidor de desarrollo, no
  la imagen Docker nueva. No reiniciar ni usar el stack histórico para E2E con
  escritura. La guía final de testers queda pendiente para cuando exista una
  instancia Docker aislada, alineada y comprobada.

### Revalidación del contenedor QA aislado (2026-10-03, actualización)

- La conclusión anterior sobre `3001` quedó obsoleta: ahora existe el contenedor
  aislado `downtimeos-mvp-qa-app`, saludable y publicado solo en
  `127.0.0.1:3001` (sin volúmenes). No pertenece al proyecto Compose histórico
  y no sustituye ni reinicia `localhost:3000`.
- Verificación actual: `GET /api/health` responde `200`; el smoke de Next pasa
  **20 rutas y 15 APIs protegidas**. En navegador se cargaron `/acceso`,
  `/registro` y `/recuperar`; sus formularios, labels, botón principal y enlaces
  de navegación están presentes. Esto verifica estructura/accesibilidad básica,
  no una aprobación visual pixel por pixel ni cada estado de error.
- El E2E de integración ya ejecutado anteriormente sigue siendo evidencia para
  la cadena de **44/44 migraciones** y para flujos de cuentas, invitaciones,
  permisos por rol, recuperación, comprobantes y paros sobre el Supabase QA
  temporal `55421`. La suite unitaria actual vuelve a pasar **376/376**.
- Se comprobó la llegada de confirmaciones a Mailpit (`localhost:55424`); el
  correo del registro de prueba redirige al callback local de activación.
  Mailpit es solo correo de desarrollo: **no prueba entrega en Gmail/Outlook**.
  Resend y WhatsApp externos siguen desactivados en QA.
- Recorrido adicional contra el contenedor actual: alta sintética `201`, correo
  de confirmación recibido, callback validado en `/activar`, onboarding `201`,
  invitación de Operador `201` y segundo correo recibido. El `redirect_to` de
  invitación conserva `/activar`, `flujo=invitacion`, UUID/token con formato
  válido y el puerto QA `3001`; no se siguió ni se imprimió el token. Supabase
  local usa el asunto genérico **“Confirm your email address”**, incluso para
  esa invitación. Puede ser poco reconocible para el usuario aunque la entrega
  local sí ocurrió; personalizar asunto/cuerpo requiere configurar la plantilla
  de correo en Supabase y verificarla con el proveedor que se use en producción.
  La cuenta y el miembro sintéticos se conservan solo en el Supabase QA.
- No se recorrieron todavía, en navegador con sesión, todos los tableros de
  Dirección/Finanzas, Operaciones y Operador ni sus estados móviles/errores.
  El QA está ligado a loopback en esta computadora; **el equipo no puede entrar
  desde otra máquina de la red**. Aún no publicar la guía de testers ni declarar
  el MVP completamente listo.
- La inspección de middleware sigue pendiente: una cookie falsificada puede
  obtener el cascarón HTML del tablero operativo, aunque las APIs sí rechazan
  el Bearer inválido. No se confirmó exposición de datos; se debe corregir o
  documentar antes del cierre de seguridad.
- Revisión focal de equipo/facturación: **36/36** regresiones de roles, permisos
  de facturación, reintento de invitaciones, bloqueo de doble envío, estados de
  red, onboarding y estilos pasaron. La UI da a titular y delegado acciones
  distintas; el servidor reserva Dirección/Finanzas/facturación al titular y
  solo concede acceso de Finanzas por permiso explícito. La separación visual
  entre tarjetas de facturación está declarada en CSS (18 px escritorio, 14 px
  móvil), y las entradas/selectores tienen paleta oscura y foco visible.
  Esto es verificación de código/regresiones, no inspección visual de cada rol
  ya autenticado en un navegador.
- Comparación actual de las dos apps locales: el contenedor `downtimeos-downtimeos-1`
  en `localhost:3000` se creó a las 20:47 UTC con la imagen `downtimeos-downtimeos`
  y conecta al Supabase histórico `host.docker.internal:54321`. El QA de
  `localhost:3001` se creó a las 22:58 UTC con la imagen `downtimeos-mvp-qa:local`
  y conecta al proyecto QA `host.docker.internal:55421`. Ambos responden health
  OK, pero sus imágenes/datos son distintos: los cambios comprobados en QA no
  aparecen automáticamente en `3000`. No reemplazar el contenedor ni migrar la
  base histórica hasta planear respaldo, actualización de esquema y prueba de
  regresión con sus datos.
- Recorrido real adicional para persona que **ya tenía cuenta**: ambas cuentas
  sintéticas registraron/confirmaron correo en QA; el titular completó el
  onboarding e invitó al usuario existente a Operaciones. El enlace recibido
  usó el asunto “Your sign-in link”, volvió a `/activar` con `type=magiclink`,
  y la aceptación respondió `200` con rol Operaciones y la planta invitada
  correctamente seleccionada. Se ejecutaron **52/52** regresiones puntuales
  de alta, activación, login, recuperación e invitaciones. Las cuentas quedan
  exclusivamente en la base QA.
- **Verificación adicional de UI y operación de paro (2026-10-03):** inspección
  visual en Brave de `http://localhost:3000/acceso`, `/registro` y `/recuperar`;
  las tres cargan el tema oscuro, campos, botones y enlaces de navegación sin
  excepción de cliente. No se enviaron formularios ni se inició sesión durante
  esta pasada. El navegador quedó de nuevo en `/recuperar`.
- Se corrigió en `public/demo/js/operador.js` el doble toque durante el envío
  de reporte/cierre de paro: una segunda llamada se ignora hasta que la primera
  termina. La regresión focalizada y la suite completa pasan (**377/377**).
  Además, el smoke HTTP pasó por separado en `3000` y `3001` (**20 rutas y 15
  comprobaciones de APIs protegidas por instancia**).
- El build de producción actual (`npm run build`) terminó con código `0`,
  compiló las 23 rutas declaradas y completó el trazado de artefactos.
- El archivo corregido se sincronizó dentro de los dos contenedores de app
  existentes, sin reiniciarlos ni tocar sus bases. Se comprobó por HTTP que
  ambos entregan el guard contra doble toque. Este parche dentro del contenedor
  es temporal: al recrear la imagen hay que reconstruirla desde el checkout
  para conservar el cambio.
- Los contenedores no son duplicados intercambiables: `downtimeos-downtimeos-1`
  sirve `3000` y apunta a Supabase histórico `54321`; `downtimeos-mvp-qa-app`
  sirve `3001` y apunta a Supabase aislado `55421`. Ambos respondieron health
  OK; no se eliminó ninguno. `docker compose ps` desde el checkout no puede
  interpolar las claves Supabase locales requeridas, por lo que se evitó usar
  Compose a ciegas sobre el stack histórico.
- Reproducción de protección con `downtimeos_session=not-a-valid-token` en
  ambas instancias: `/direccion` responde `200` y contiene el cascarón genérico;
  `/api/planta` responde `401`. No se hallaron datos de planta personalizados
  en el HTML estático. El hallazgo sigue siendo una protección de página
  inconsistente/experiencia engañosa, no una fuga de datos confirmada.
- Reconsulta de migraciones locales contra ambas bases (solo lectura): el
  Supabase histórico de `54321` sigue en `40` migraciones y termina en
  `20261003000700`; el QA `55421` está alineado en `44` y llega a
  `20261003001100`. No aplicar las cuatro migraciones faltantes al histórico
  sin respaldo verificado y plan explícito, porque ahí viven los datos del
  usuario.
- Confirmadas también las imágenes en ejecución: app histórica `3000` creada
  a las `20:47 UTC`, QA `3001` a las `22:57 UTC`; ambas responden health `200`.
  Aunque ya se sincronizó `operador.js` a ambos contenedores para esta prueba,
  el resto del código de `3000` continúa siendo la imagen antigua. Las rutas,
  permisos y esquema recientes deben probarse en `3001`/QA hasta preparar con
  cuidado el reemplazo de la instancia histórica.
- Construcción y arranque reproducible del Dockerfile actual: se generó la
  imagen `downtimeos-mvp-qa:verified`; un contenedor temporal aislado en
  `127.0.0.1:3002`, conectado al Supabase QA, pasó health `200` y smoke de
  **20 rutas/15 APIs**. El contenedor temporal se retiró automáticamente y
  `3002` quedó libre; las dos apps estables no se reiniciaron.
- Nota de seguridad de la prueba: un primer intento fallido de componer los
  argumentos de PowerShell/Docker mostró en el error un fragmento de una llave
  secreta del Supabase local QA. Docker no inició ese contenedor ni se hicieron
  escrituras; no se copió ninguna llave a archivos ni a logs del proyecto. Por
  precaución, rotar esa llave antes de exponer/reutilizar este QA fuera del
  entorno local.
- Siguen pendientes la inspección visual con sesión de Dirección/Finanzas,
  Operaciones y Operador; los flujos completos de errores/desconexión en UI;
  el cierre del hallazgo de cascarón HTML protegido por cookie falsificable;
  la verificación con correo externo (Gmail/Outlook); y reconstruir/probar la
  imagen Docker de forma reproducible. No declarar el MVP completamente
  verificado todavía.

### Revalidación focal de cuenta, recuperación y contenedor tester (2026-10-04)

- Auditoría independiente confirmó que una persona invitada a una planta ya
  configurada podía quedar atascada en `/configurar-planta`: la marca de
  onboarding se trataba por usuario, aunque la estructura pertenece a toda la
  planta. Se añadió la migración
  `20261003001200_sincronizar_onboarding_membresias.sql` para completar a los
  miembros activos al guardar la primera máquina y para marcar miembros que se
  activen/inviten después de que la planta ya tenga estructura.
- La migración 012 quedó aplicada y registrada únicamente en el Supabase QA
  `55421`; QA quedó alineado **45/45**. El backfill no halló membresías activas
  incompletas con líneas y equipos existentes. Un probe real de ambos triggers
  dentro de una transacción en PostgreSQL comprobó las rutas de miembro
  existente y nuevo; terminó con `ROLLBACK`, sin dejar datos de prueba.
  El Supabase histórico `54321` no recibió escrituras ni migraciones y sigue
  pendiente de actualización con respaldo/plan explícito.
- Recuperación de contraseña ahora elige el flujo Supabase según el callback:
  `?code=` usa PKCE y el callback actual con tokens en hash conserva implicit;
  activa detección de URL y persistencia de sesión. Se agregó una regresión
  específica. La suite completa actual: **378/378**; build Next: 23 rutas.
  No se envió otro correo real para ensayar un enlace PKCE; el flujo E2E
  previamente verificado usó el callback local hash de Supabase.
- La imagen Docker se reconstruyó desde el checkout como
  `downtimeos-mvp-qa:verified`; su contexto de 130 KB excluyó `.env.local`.
  Primero pasó en contenedor temporal `3002`, luego se promovió al contenedor
  QA `downtimeos-mvp-qa-app` en `127.0.0.1:3001`, con URL interna
  `host.docker.internal:55421` y URL de navegador `localhost:55421`. Health
  Docker: `healthy`; smoke HTTP: **20 rutas y 15 APIs protegidas**. El puerto
  `3000` y el Supabase histórico no se detuvieron ni modificaron.
- En una transición fallida, el script de promoción restauró automáticamente
  el contenedor QA anterior; la base no se tocó. Después se corrigió la espera
  para basarse en el health de Docker y el smoke desde host; la segunda
  promoción terminó correctamente. El script reusable
  `scripts/promote-qa-verified.ps1` conserva esta reversa y rechaza contenedores
  con montajes.
- Al restaurar QA quedaron presentes en el contenedor las dos variables de
  administración local (`DASHBOARD_ADMIN_EMAIL/PASSWORD`); no se hizo login
  administrativo con navegador, por lo que la ruta de aprobación sigue sin
  aceptación visual autenticada. Este QA es solo loopback de esta PC; otro
  equipo no puede abrir `3001` directamente desde la red.
- Tres auditorías paralelas adicionales: equipo/invitaciones sin vulnerabilidad
  de API reproducida, pero con riesgo medio de defensa en profundidad porque
  algunas RPC `service_role` confían en el actor que les pasa la API; la ruta
  server-side revisada sí valida sesión/rol. Suscripciones: el modelo MVP usa
  pago manual y comprobante, no pasarela ni CFDI; correo externo no comprobado.
- Sigue pendiente revisar en navegador con sesiones reales todos los tableros
  y estados de error/móvil; completar recorrido de suscripción con rol
  administrativo; verificar Gmail/Outlook y Resend; cerrar el shell HTML
  genérico con cookie falsificada; y planear respaldo/migración de la base
  histórica antes de actualizar `localhost:3000`.

### Revalidación de QA y barreras E2E (2026-10-04, seguimiento)

- Se repitieron los controles sobre el checkout actual: **378/378** pruebas
  Node pasan, `npm run build` compila las 23 rutas y el contenedor QA
  `downtimeos-mvp-qa-app` está `healthy`; el smoke contra `127.0.0.1:3001`
  verificó **20 rutas y 15 APIs protegidas**.
- Consulta de solo lectura con Supabase CLI: QA `55421` tiene aplicadas las
  **45/45 migraciones** actuales. El Supabase histórico `54321` tiene aplicadas
  **40/45**; faltan `20261003000800` a `20261003001200`. No se le aplicó nada.
- Inspección en Brave de QA: `/registro` y `/acceso` conservan el tema oscuro,
  tipografía, campos y CTA. Una visita sin sesión a `/configurar-planta`
  redirige al acceso con retorno a la ruta solicitada. No se usó una sesión
  autenticada, así que esto no certifica la configuración ni los tableros.
- Dos solicitudes de registro deliberadamente inválidas a QA (correo mal
  formado y contraseña demasiado corta) devolvieron **400** con mensajes
  concretos; la validación ocurre antes de crear el usuario Auth.
- En esta revalidación inicial todavía no se había lanzado otra corrida E2E:
  QA ya tenía usuarios, los otros volúmenes hallados eran de cadenas antiguas
  y no se quería reutilizar una base sin verificarla. La corrida fresca posterior
  se documenta abajo.
- En `docker ps -a` no había contenedores detenidos antes de la corrida; tras
  ella se eliminaron solo los recursos del proyecto E2E temporal. Las apps y
  bases históricas/QA siguen preservadas. Continúan pendientes las vistas
  autenticadas por rol en navegador y el correo de proveedores externos.

### Corrida integral E2E fresca con las 45 migraciones (2026-10-04)

- Se preparó el proyecto temporal `downtimeos-mvp-verification-20261004` en
  puertos dedicados `56621` (API), `56622` (DB) y `56624` (Mailpit); Studio,
  Analytics e Edge Runtime no se levantaron. La cadena actual se aplicó desde
  cero y la consulta de migraciones confirmó **45/45**. El preflight validó Auth
  y todas las tablas/buckets de tenant vacíos antes de empezar escrituras.
- `scripts/e2e-mvp-local.ps1 -ConfirmDisposableDatabase` terminó con código 0.
  Pasaron registro, confirmación por Mailpit, login, onboarding transaccional de
  dos empresas, aislamiento multi-tenant y RLS/PostgREST; solicitud/cancelación
  de plan, comprobante PDF privado, aprobación administrativa local, renovación,
  límite Starter, invitaciones aceptadas para Dirección/Finanzas/Operaciones y
  dos Operadores, permisos por rol, recuperación por Mailpit, ciclos STOP→RUN,
  descarte/retiro de reportes, vencimiento y 64 ciclos de folios únicos.
- La corrida omitió explícitamente cambios automáticos por calendario,
  rendimiento a 10k/100k, CFDI/retenciones y proveedores externos de WhatsApp,
  PDF, IA y SMTP; Mailpit no certifica entrega externa. No probó los formularios
  visuales autenticados en un navegador; fue integración API/Auth/DB/Storage.
- Tras el PASS, `supabase stop --no-backup` detuvo el proyecto y eliminó sus
  contenedores y volúmenes temporales. Se verificó que no quedaran recursos
  Docker de ese proyecto, que `3002` quedara libre y que QA `3001` siguiera
  `healthy`. Las bases QA e histórica no se modificaron.
- Cruce final del runtime activo: el contenedor `downtimeos-downtimeos-1` en
  `127.0.0.1:3000` apunta a `http://localhost:54321` (40 migraciones); el
  contenedor aislado `downtimeos-mvp-qa-app` en `127.0.0.1:3001` apunta a
  `http://localhost:55421` (45 migraciones). Ambos dan health `200`, pero las
  funciones nuevas deben probarse en QA `3001`; el health por sí solo no indica
  que la app use el esquema vigente. No se migró ni borró el stack histórico.
- Inspección visual adicional de `/activar` sin token en QA: el estado termina
  en «Revisa tu enlace», explica qué hacer y ofrece volver al acceso con retorno
  al onboarding; no permanece en «Validando» ni requiere enviar un formulario.
- Verificación del correo saliente activo: QA y el Supabase histórico apuntan
  `GOTRUE_SMTP_HOST` a sus respectivos contenedores Inbucket locales en puerto
  1025; ambos Mailpit contestan `200` en `55424` y `54324`. Los dos contenedores
  de app tienen vacías `RESEND_API_KEY` y `RESEND_FROM_EMAIL`. Por tanto, Auth
  entrega confirmaciones/invitaciones/recuperaciones a la bandeja local, no a
  Gmail/Outlook; no es una falla de invitaciones de la app. El envío externo y
  su entregabilidad quedan sin configurar/verificar.

### Correcciones verificadas y publicación QA (2026-10-04, continuación)

- Se corrigieron los enlaces de Mailpit en Registro y Equipo: ahora se derivan
  del puerto Supabase local (`55421` → `55424` en QA), en lugar de quedar fijos
  en `54324`. Pruebas unitarias cubren ambos proyectos y rechazan orígenes no
  locales. La imagen QA publicada incluye el enlace dinámico.
- El menú de Dirección/Finanzas ahora se condiciona por `es_admin_cuenta` y
  `puede_administrar_facturacion`, y el tablero cambia su título para Finanzas.
  Se fortaleció además el montaje legacy de Next para reaplicar visibilidad al
  terminar de cargar los scripts. La cobertura de esta regla está en
  `test/navegacion-cuenta.test.js`; la prueba visual autenticada sigue pendiente.
- Se reconstruyó y promovió `downtimeos-mvp-qa:verified` únicamente a
  `downtimeos-mvp-qa-app` en `127.0.0.1:3001`. El contenedor resultó `healthy`,
  el smoke volvió a pasar (20 rutas, 15 APIs protegidas), y sus assets servidos
  contienen el cambio de menú y el título de Finanzas. La base QA conservó sus
  45 migraciones. No se tocó la app histórica de `3000`.
- La app histórica `3000` continúa sirviendo assets anteriores y su base
  `54321` tiene solo 40/45 migraciones. No se debe actualizar esa app hasta
  auditar/aplicar las cinco migraciones faltantes con respaldo y plan de
  reversa. La suite de código actual pasa **381/381**, `npm run build` termina,
  `npm audit --omit=dev` reporta cero vulnerabilidades y `git diff --check`
  pasa. Esto no sustituye el QA autenticado pendiente.

### Impacto de drift histórico y acceso de testers (2026-10-04)

- Comparación de solo lectura en la base `54321`: las filas existentes no
  violan el nuevo `CHECK` de estados de comprobante (**0** incompatibles), y el
  backfill de onboarding de la migración `20261003001200` afectaría **0**
  membresías y **0** perfiles con las condiciones actuales. Sin embargo, la
  función `planta_reclasificar_solicitud` requerida por el backend del checkout
  actual no existe aún en el histórico; `20261003001100` la crea/actualiza.
  QA contiene tanto la migración como el cliente RPC. El app histórico ejecuta
  una imagen anterior, así que se registra como drift de compatibilidad y no
  como una falla reproducida en la lógica que ahora corre en `3000`.
- No se aplicaron migraciones al histórico: requiere respaldo verificable y
  autorización expresa porque cambia funciones, restricciones y triggers en
  una base persistente, aunque las comprobaciones agregadas no encontraron
  filas que impidan esas migraciones.
- QA queda `healthy` con la imagen `downtimeos-mvp-qa:verified`; los assets que
  responde en `3001` ya incluyen el título Finanzas, gating del menú y el
  bundle de Mailpit dinámico. `3000` permanece intacto y antiguo.
- QA no está listo para acceso de otros equipos: la app se publica en loopback
  `127.0.0.1:3001`. Supabase, Postgres y Mailpit, en cambio, tienen ports
  publicados en `0.0.0.0`/IPv6. No se deben abrir puertos de la app a la LAN sin
  antes restringir/proteger los servicios auxiliares y decidir una topología
  de staging segura. Los testers remotos siguen pendientes.

### E2E completa actual y estado de pruebas (2026-10-04, actualización)

- Se aisló una segunda base temporal en los puertos `56621`–`56624` y se aplicó
  desde cero la cadena vigente completa, ahora **46 migraciones** incluyendo
  `20261003001300_auditar_cierre_paro.sql`. La primera corrida detectó que la
  copia temporal de migraciones era anterior a esa función; se actualizó solo
  el proyecto desechable, se reinició su base sintética y se repitió el E2E.
- `node scripts/e2e-mvp-local.mjs` terminó con código 0: confirmó alta y correo
  por Mailpit, dos tenants aislados, onboarding, recuperación, facturación y
  renovaciones, cuota Starter, aceptación de los cinco roles, permisos,
  vencimiento, 64 folios consecutivos únicos y ciclos STOP→RUN de Operador y
  Mantenimiento. También verificó que la auditoría del cierre identifica al
  usuario real que actuó. La falla de descubrimiento PostgREST quedó resuelta
  aplicando la migración que faltaba en ese entorno; **no** se aplicó a QA ni a
  la base histórica.
- `npm test`: **381/381**; `npm run build`: correcto tras cerrar el Next de
  desarrollo temporal que compartía `.next`; `npm run smoke`: correcto, **20
  rutas y 15 APIs protegidas**; `git diff --check`: sin errores. El proyecto
  Supabase de integración y el servidor Next en `3002` se detuvieron al terminar.
  Los contenedores persistentes de `3000` y QA `3001` siguen activos y sin cambios.
- Sigue faltando revisar visualmente los flujos autenticados en navegador con
  cada rol, desplegar una instancia segura para testers (la QA actual solo
  escucha en loopback y expone auxiliares en todas las interfaces), decidir y
  configurar correo externo si se requiere recibir invitaciones fuera de
  Mailpit, y planear con respaldo la actualización de la base histórica. Las
  pruebas de carga, CFDI, calendario automático y proveedores externos siguen
  fuera de lo probado; no se certificó acceso desde otros equipos.

### Auditoría de runtime y pantallas públicas (2026-10-04, continuación)

- Lectura directa de `supabase_migrations.schema_migrations`: QA `55422` está
  en **45** (`20261003001200`); histórico `54322` está en **40**
  (`20261003000700`). No se aplicó ninguna migración persistente. La cadena en
  código tiene **46**, por lo que el cierre auditado probado en la base temporal
  aún no está disponible en QA/histórico.
- Verificación de las filas de migración: QA tiene aplicadas consecutivamente
  `20261003000000`–`20261003001200` y solo le falta `20261003001300`; el
  histórico llega hasta `20261003000700` y le faltan las seis `20261003000800`–
  `20261003001300`. `3000` por tanto tampoco contiene los endurecimientos de
  transiciones/roles, asignación de Dirección al titular, anulación de
  comprobante, reclasificación, sincronización de onboarding ni cierre auditado.
- Health real respondió `200` en las apps `3000` y `3001`, Supabase Auth QA y
  Mailpit QA. En Brave, las pantallas QA `/acceso`, `/registro` y `/recuperar`
  se vieron con el tema oscuro, tipografía, campos y botones de DowntimeOS; la
  ruta privada `/suscripcion` regresó al acceso con `returnTo`. Esto verifica
  solamente la presentación pública y el guard de acceso, no dashboards
  autenticados, mutaciones visuales ni todos los tamaños de pantalla.
- `docker ps -a` no muestra contenedores detenidos. Hay **23 contenedores
  activos**: dos apps y los servicios de sus dos stacks Supabase que reciben
  sus conexiones (QA `55421` y el histórico `54321`). No son copias app
  huérfanas. Docker sí reporta **43 volúmenes sin montar** (1.205 GB
  reclamables) y **21.45 GB** de build cache reclamable; contienen o podrían
  contener datos persistentes de bases de prueba anteriores, por lo que no se
  borraron. Se requiere decisión expresa antes de eliminar esos datos/cachés.
- Consultas de solo lectura a `pg_proc` confirman que QA tiene
  `planta_reclasificar_solicitud` pero no `planta_cerrar_paro_auditado`; el
  histórico no tiene ninguna de las dos RPC. La búsqueda del nombre exacto en
  los bundles server-side del contenedor QA tampoco encontró la nueva RPC: la
  imagen servida en `3001` aún no corresponde al código actual del checkout.
  Conteos anonimizados de perfiles en ambas bases dieron **0** perfiles activos
  sin membresía activa y **0** perfiles que el backfill de onboarding tendría
  que sincronizar; esto reduce la probabilidad de que el error histórico de
  permisos proviniera únicamente de esas dos inconsistencias, pero no prueba
  login de cada cuenta ni descarta otros errores de esquema/configuración.
  Por eso el siguiente paso seguro no es reconstruir y reemplazar el contenedor
  aisladamente: primero se necesita respaldo verificable y autorización para
  actualizar el esquema persistente de QA, y luego publicar la imagen alineada.

### Corrección de retorno al destino tras iniciar sesión (2026-10-04)

- La inspección de redirects encontró una discrepancia en el checkout: el
  middleware mandaba a `/acceso?destino=...`, mientras el login solo procesa
  `returnTo`. Ahora ambos usan el mismo parámetro. Una prueba regresiva falló
  antes del cambio y pasó después; el smoke de producción exige el retorno
  exacto para `/direccion`, `/operaciones` y `/operador`.
- Esta corrección pasó la suite **382/382**, `npm run build`, `npm run smoke`
  (**20 rutas y 15 APIs protegidas**) y `git diff --check`. Está en el checkout,
  no en las imágenes persistentes de `3000`/`3001`; no se desplegó por el desfase
  entre esas imágenes/esquemas y la migración pendiente en QA.

### Revalidación integral posterior

- Se reconstruyó `downtimeos-downtimeos-1` en `localhost:3000` con el checkout
  actual y el lanzador seguro `scripts/docker-local.ps1`, apuntándolo a QA
  `55421`. El contenedor está `healthy`; sus variables administrativas locales
  se cargaron solo en servidor. QA no recibió escrituras ni migraciones.
- Confirmación de runtime: `GET /api/health`=200; `/direccion` redirige a
  `/acceso?returnTo=%2Fdireccion`; una mutación sin sesión responde 401. El
  smoke pasa **20 rutas/15 APIs**. `localhost:3001` permanece healthy pero usa
  una imagen anterior que conserva `destino`; no usarlo para probar el checkout.
- Corrida de `scripts/e2e-mvp-local.ps1` en una instancia Supabase recién creada,
  con los mismos 46 archivos de migración que el checkout (incluyendo
  `20261003001300`): **todas las suites pasaron**, incluidas invitaciones reales
  por Mailpit, recuperación, permisos, renovaciones, RLS, 64 folios únicos y
  cierres auditados. El runner creó datos sintéticos y no los borró. Después se
  detuvo esa instancia específica; sus dos volúmenes quedaron preservados.
- `npm test`: **382/382**; `npm audit --omit=dev`: **0 vulnerabilidades**; build
  de imagen y smoke correctos. Inspección de solo lectura confirma que QA sigue
  en `45/46` y no contiene la RPC de cierre auditado. Las pruebas de carga,
  entrega externa de correo, CFDI, servicios externos y revisión visual de
  pantallas autenticadas/dispositivos aún no están certificadas.
- Auth de QA usa SMTP local Inbucket/Mailpit (`55424`, SMTP interno `1025`). La
  invitación pendiente actual tiene un mensaje correspondiente en ese buzón con
  asunto de confirmación de correo; no se envió a un proveedor externo. La UI de
  Equipo ya avisa que el mensaje se consulta en Mailpit y no llega a Gmail ni
  Outlook.
- La base QA contiene 7 organizaciones, 7 plantas, 12 membresías activas, 4
  suscripciones históricas y **0 derechos de uso vigentes** según la misma regla
  `exigirPlanActivo` que usa el servidor. Las personas pueden validar alta,
  facturación y solicitud de plan, pero las operaciones reales seguirán
  bloqueadas hasta que una suscripción/piloto vigente sea asignada por el flujo
  administrativo autorizado. No se activó ni alteró ninguna suscripción.
- Docker publica QA Supabase/Kong (`55421`), Postgres (`55422`) y Mailpit
  (`55424`) en `0.0.0.0` y `[::]`; la app en cambio solo publica `127.0.0.1:3000`.
  Mailpit no requiere autenticación y guarda enlaces de confirmación,
  invitación y recuperación. No compartir el acceso de QA por LAN ni exponerlo
  a testers remotos hasta restringir de forma segura esos puertos y decidir una
  topología de pruebas.

### Auditoría incremental de registro, pagos y runtime (2026-10-03)

- Las auditorías de código encontraron dos defectos corregibles sin tocar datos:
  la validación de registro permitía nombres de empresa/planta de un carácter
  que la RPC rechazaba, y el panel interno asumía un orden no garantizado para
  los pagos relacionados. El servidor y formulario ahora aplican el mínimo de
  dos caracteres; la API ordena pagos por fecha descendente antes de devolverlos.
  Se añadieron pruebas de regresión para ambos casos.
- Suite actual: **385/385**; `npm run build` terminó; `npm run smoke` verificó
  **20 rutas y 15 APIs**. La imagen de `localhost:3000` se reconstruyó con estos
  cambios y volvió a quedar `healthy`; `/acceso` responde 200.
- El duplicado obsoleto `downtimeos-mvp-qa-app` (`localhost:3001`) estaba
  detenido, sin montajes ni volúmenes asociados, y se eliminó a petición previa
  de limpieza. No se borraron contenedores de base ni volúmenes. QA continúa con **45/46**
  migraciones y sin `planta_cerrar_paro_auditado`; no se migró ni escribió la DB.
- Reconsulta agregada de QA: hay **0 suscripciones/pilotos vigentes**, 4 pagos
  históricos y una invitación pendiente. Por ello, todavía no se puede probar
  el ciclo operativo bajo un entitlement activo; se necesita activar un piloto
  por el flujo administrativo autorizado.
- Revisión en el navegador real capturó acceso, registro y recuperación en un
  viewport de 581 × 1073 px. Las tres muestran tarjeta oscura, jerarquía de
  títulos, formularios y botones DowntimeOS consistentes; las rutas cargaron sin
  excepción cliente y el navegador se dejó en `/acceso`. Esto no cubre móvil y
  escritorio por separado, autocompletado con credenciales ni pantallas con
  sesión/roles. La migración global a TypeScript/TSX no se ha iniciado.

### Revalidación de salud y base QA (2026-10-04)

- La suite volvió a pasar **385/385**, `npm run build` compiló, `npm run smoke`
  verificó **20 rutas y 15 APIs protegidas**, y `npm audit --omit=dev` encontró
  **0 vulnerabilidades de producción**. `GET http://127.0.0.1:3000/api/health`
  responde `ok`; el contenedor `downtimeos-downtimeos-1` está healthy y publica
  únicamente en loopback.
- El servicio de `3000` apunta a Supabase QA (`host.docker.internal:55421`). La
  consulta de solo lectura volvió a confirmar **45 migraciones**, última
  `20261003001200`; el checkout contiene la migración `20261003001300` y QA no
  tiene la RPC `planta_cerrar_paro_auditado`. Esta brecha puede romper el cierre
  auditado de un paro en QA. No se aplicaron migraciones ni escrituras.
- `docker compose ps` ejecutado sin el lanzador falla porque Compose exige las
  variables efímeras `DOWNTIMEOS_LOCAL_SUPABASE_*`; `npx supabase status` en la
  raíz falla porque no está levantado `supabase_db_downtimeos`. El lanzador
  previsto requiere un Supabase Local activo y no se debe improvisar contra
  puertos o volúmenes históricos.
- Se observan activos dos stacks Supabase históricos (`mvp-qa-20261003` y
  `supabase-check-17e0d9c049a54f`), ambos exponiendo puertos de DB/API/Mailpit en
  todas las interfaces; además hay volúmenes de pruebas anteriores sin
  contenedor asociado. No se detuvo ni eliminó ninguno ni se borró volumen; se
  necesita inventariar propietario/uso y acotar puertos antes de limpieza.
- La consulta `scripts/docker-local.ps1 -SupabaseWorkdir <QA> -ComposeArgs ps`
  funciona y lista únicamente la app sana en `127.0.0.1:3000`. Se ajustó el
  lanzador para que la advertencia de credenciales administrativas solo aparezca
  al levantar/reconstruir la app, no durante una consulta `ps`; `test/docker-healthcheck.test.js`
  y la suite completa (**385/385**) pasan. El contenedor parado duplicado fue
  eliminado sin montajes; siguen activos los dos stacks Supabase.
- Auditorías independientes ejecutaron otras **126 pruebas dirigidas** (92 de
  operaciones y 34 de facturación/permisos), todas pasaron. Son pruebas de
  código/simulaciones y no sustituyen el recorrido autenticado en la base QA.
- La auditoría de autenticación/equipo pasó **52/52 pruebas dirigidas**. Al
  sumarlas, las tres auditorías paralelas ejecutaron **178 pruebas focalizadas**
  sin fallos, pero siguen pendientes las validaciones reales externas descritas.
- Riesgos funcionales por corregir/verificar: alta/cancelación de eventos
  manuales usa varias escrituras no atómicas; navegación al cambiar de planta
  no conserva el destino correspondiente a todos los roles; editar etapa,
  orden y tarifa de un equipo existente no está disponible; y el tablero puede
  resumir solo la ventana de eventos cargada aunque el historial exceda su
  límite. El RPC de onboarding valida menos límites que la UI/API.
- Riesgos administrativos/de auditoría: el login del panel interno no muestra
  limitación de intentos en aplicación (no se verificó protección en proxy);
  cargar facturación materializa vencimientos sin auditoría; el GET de
  administración firma comprobantes y escribe auditoría durante la lectura; y
  las acciones administrativas quedan atribuidas a una credencial compartida,
  no a una identidad individual. El guardado fiscal también puede responder
  éxito si falla el registro secundario de auditoría.
- Los informes confirman controles de roles en servidor, aprobación de pagos
  transaccional, comprobación de MIME/firma/tamaño de comprobantes y periodos
  semestral/anual. Persisten huecos de prueba de aceptación con usuarios reales
  entre plantas/roles y de invitación completa en navegador con correo externo.
- La auditoría de autenticación encontró que un corte tras crear el usuario de
  Supabase Auth pero antes de crear organización/membresía puede dejar el correo
  registrado sin una ruta clara para reanudar; el reenvío de invitación también
  puede invalidar el token previo ante una excepción de transporte. La suite
  dirigida de este módulo pasó **52/52**, pero no cubre esos escenarios de fallo.
- Mailpit/Inbucket solo acredita recepción local. Registro, recuperación e
  invitaciones dependen de SMTP de Supabase para correo real; Resend en esta
  configuración se usa para avisos del cron, no para Auth. No se inspeccionó el
  panel externo SMTP ni se enviaron mensajes reales.

### Correcciones y revalidación de registro/invitaciones (2026-10-04)

- El reenvío y la invitación inicial ahora manejan una excepción de transporte
  de correo como resultado **indeterminado**: conservan la invitación pendiente
  e inactiva y explican que el enlace pudo llegar, en lugar de afirmar que no se
  envió. Respuestas de error explícitas del proveedor todavía ejecutan la
  compensación existente. Se añadieron dos regresiones.
- Los nuevos registros guardan únicamente empresa/planta/nombre (nunca la
  contraseña) en metadata de Auth. La sesión autenticada puede llamar al RPC
  idempotente `organizacion_reanudar_registro_empresa` si no existe membresía;
  una reanudación exitosa vuelve a cargar el perfil. Se serializa con el mismo
  advisory lock que el alta normal y no se intenta para usuarios sin metadata
  propia del registro ni para una planta seleccionada ajena.
- La cadena de fuente ahora tiene **47 migraciones**. La nueva
  `20261003001400_retomar_registro_pendiente.sql` se ejecutó en PostgreSQL 17
  efímero con un esquema aislado: se corrigió una asignación inválida de filas y
  se verificaron tanto la ruta de membresía existente como la delegación al alta
  normal. El contenedor efímero fue eliminado; QA permanece intacta en **45/47**.
  Falta respaldar/aprobar/aplicar esta migración y validar el flujo contra el
  esquema real de QA; no se ejecutaron escrituras ni migraciones allí.
- Suite completa: **392/392**; build Next.js y smoke pasaron (**20 rutas y 15
  APIs protegidas**). El contenedor `localhost:3000` se reconstruyó usando el
  lanzador seguro, sin recrear Supabase ni tocar volúmenes; `/api/health`=200,
  publicación en loopback y credenciales locales del panel confirmadas como
  presentes sin exponer sus valores. El duplicado detenido de `3001` ya no
  existe.
- Continúan sin corregir o certificar: atomicidad de eventos manuales, destinos
  por rol al cambiar planta, totales del tablero tras superar el límite de
  carga, restricciones de tamaño equivalentes en la
  RPC de onboarding, limitación de intentos del panel admin, atribución
  individual de acciones administrativas y pruebas auténticas de SMTP/roles/
  aislamiento entre plantas.
- Se detuvo con Supabase CLI el stack de integración `downtimeos-supabase-check`
  que llevaba 23 horas activo, no tenía conexiones y no era el backend de la app;
  se conservó el respaldo/datos (no se usó `--no-backup`). La app continúa
  healthy en `127.0.0.1:3000` con QA `55421`; QA no se reinició ni modificó.
- Se comprobó el puerto que aparece en el navegador: no hay proceso ni
  contenedor escuchando en `3002` (tampoco en `3001`); solo `3000` responde
  `/api/health`. El `.env.local` de este checkout señala Supabase alojado, por
  lo que no se debe iniciar `npm run dev` sin reemplazar explícitamente esas
  variables. README ahora advierte que se use `npm run docker:local`.

### Edición de equipos existentes (2026-10-04)

- `/estructura` ahora permite a Dirección precargar un equipo activo, corregir
  nombre, línea, tipo, etapa, orden, tarifa o cuello de botella, guardar o
  cancelar. El código del equipo permanece fijo y se aclara que el historial ya
  registrado conserva sus valores originales.
- `PATCH /api/planta/estructura` limita la edición al rol autorizado y usa la
  nueva RPC `planta_editar_activo`. La función valida membresía y tenant, bloquea
  el equipo y la estructura, rechaza activos archivados/detenidos o con reportes
  abiertos y no toca eventos ni solicitudes históricos. Los errores se devuelven
  con estados HTTP distinguibles (403/404/409/400/503).
- La nueva migración `20261004000100_editar_activo.sql` y escenarios de estado,
  permisos, aislamiento e invariancia histórica se verificaron en PostgreSQL
  efímero; esa instancia se eliminó sin tocar QA. En ese corte QA seguía en **45/48**, así que
  la app desplegada en `3000` todavía no puede ejecutar esta RPC. No se reconstruyó
  ese contenedor para no presentar una interfaz conectada a una función ausente.
- Suite completa: **397/397**; `npm run build`, `npm run smoke` (**20 rutas y
  15 APIs**) y `git diff --check` pasan. La integración de las últimas migraciones
  contra Supabase E2E sigue pendiente; esta revisión prioriza implementar el
  flujo de producto y no aplicó cambios a QA.

### Cancelación atómica de eventos (2026-10-04)

- La cancelación manual de un evento ahora se delega a una sola RPC
  `planta_cancelar_evento`: bloquea y valida el folio dentro de la planta de la
  sesión, inserta el rastro con motivo/autor y elimina el evento en la misma
  transacción. El rol sigue validándose en la API; la RPC solo es ejecutable por
  `service_role`. Si cualquier paso falla, PostgreSQL revierte ambas escrituras.
- API y cobertura dirigida actualizadas. La nueva migración
  `20261004000200_cancelar_evento_atomico.sql` aún no está aplicada en Supabase;
  por ello la función no está disponible en `localhost:3000`. No se desplegó ni
  se modificó QA. Checkout: **49 migraciones**; QA: **45/49**.
- La migración se ejecutó en un PostgreSQL 17 temporal y aislado; la RPC creó
  exactamente un rastro y retiró exactamente un evento. El contenedor temporal
  se eliminó y quedó el inventario original de 11 contenedores. Esto valida
  sintaxis y ruta feliz, pero no sustituye integración E2E Supabase ni prueba de
  fallos/rollback.
- La prueba nueva y tres suites relacionadas pasan (**10/10**); la suite total
  pasa **399/399**, `npm run build` y `npm run smoke` (20 rutas, 15 APIs). Falta
  validar la integración E2E y fallos/rollback en Supabase desechable, luego
  desplegarla antes de reconstruir el runtime para que la operación nueva esté
  disponible. No se aplicó nada a QA.

### Bitácora sin truncamiento silencioso (2026-10-04)

- `/api/planta` entrega la primera página de 500 eventos más un cursor
  keyset ordenado por `created_at` y folio, fijado a un corte temporal. La UI
  sigue páginas autenticadas solo para eventos y las acumula antes de calcular
  tarjetas, Pareto y métricas; un error en cualquier página invalida la carga en
  lugar de presentar totales parciales. Las consultas están limitadas a la
  planta de sesión y se conserva el filtrado financiero por rol.
- Los reportes PDF/IA ahora llaman `estadoPlantaCompleto`, que usa el mismo
  cursor y corte en todas las páginas. Así también evitan analizar solo los
  primeros 2,000 registros.
- La prueba recorre dos páginas sin repetir/omitir filas, con un registro
  posterior al corte y datos de otra
  planta; confirma ausencia de saltos, duplicados y cruce de tenant. Suite total
  **401/401**, build y smoke (**20 rutas/15 APIs**) pasan. No se tocó QA ni se
  reconstruyó Docker; la app `localhost:3000` todavía usa el código anterior.

### Cambio de planta y renovación de sesión (2026-10-04)

- El selector podía guardar de nuevo el access/refresh token previo después de
  que `fetchConSesion` renovara el token vencido. Ahora recupera los tokens más
  recientes de la misma identidad antes de persistir el perfil/planta, y rechaza
  respuestas tardías si otra cuenta inició sesión en otra pestaña.
- Al cambiar de sitio verifica que el perfil devuelto corresponde al ID elegido
  y asigna destino explícito por rol: Dirección/Finanzas → `/direccion`,
  Operaciones → `/operaciones`, Operador → `/operador`; onboarding pendiente →
  `/configurar-planta`. Un rol inesperado ya no cae silenciosamente en Dirección.
- Pruebas de renovación concurrente/cambio de cuenta y selector: **34/34** en
  las suites dirigidas. QA y Docker no se modificaron en este cambio.

### Runtime y esquema QA alineados para seguir cerrando el MVP (2026-10-03)

- La inspección real encontró la pestaña indicada en `localhost:3002/equipo`
  sin servicio escuchando. El único runtime de la app activo estaba en
  `localhost:3000`; la app QA apunta a Supabase `55421`. La URL que el equipo
  debe usar en esta computadora es `http://localhost:3000`.
- Antes de actualizar el esquema se creó y verificó un respaldo completo de QA
  fuera del repositorio en `%TEMP%\downtimeos-qa-pre-migrations-20261003-225530.dump`.
  La CLI confirmó que faltaban exactamente cuatro migraciones. Se aplicaron en
  orden `20261003001300`, `20261003001400`, `20261004000100` y `20261004000200`;
  la lista ahora está alineada **49/49** y las cuatro RPC aparecen instaladas.
  No se borraron ni reiniciaron contenedores o datos.
- Se reconstruyó únicamente `downtimeos-downtimeos-1` desde este checkout,
  conservando su configuración y conexión QA. Quedó `healthy` en `3000`; QA
  permanece en `55421`. `/acceso`, `/registro`, `/recuperar`, `/equipo`,
  `/suscripcion` y `/estructura` respondieron HTTP 200. Smoke de runtime:
  **20 rutas y 15 APIs**, correcto. HTTP 200 comprueba carga, no sustituye una
  sesión real ni el recorrido visual de cada rol.
- El flujo `/activar` ya evita guardar tokens vencidos si `fetchConSesion`
  renueva la sesión durante la consulta de cuenta. Suite completa: **403/403**;
  build Next.js correcto.
- Hallazgo que todavía impide probar tableros como cliente: la QA persistente
  tiene **7 organizaciones y cero suscripciones/pilotos vigentes** (3 registros
  cancelados y 1 vencido; no hay solicitudes pendientes). El código bloquea
  correctamente la operación sin entitlement. El login administrativo y la
  ruta `/administracion/suscripciones` respondieron 200 con la cookie interna.
  El panel sí permite conceder un piloto de 14 días, pero solo desde una
  solicitud de plan existente. No se alteró ninguna cuenta ni se concedió
  piloto; para una prueba final, una cuenta de prueba debe enviar una solicitud
  desde `/suscripcion` y luego el administrador aprobarla como piloto. El correo
  Auth es local (Mailpit/Inbucket), no Gmail/Outlook.
- `3001` y `3002` no están publicados; usar `localhost:3000`. No se creó un
  segundo contenedor de app para evitar duplicar el runtime.

### Auditoría de runtime y flujos sin sesión (2026-10-03)

- El avance actual quedó publicado en `Angel_Dev` como `3df80ec`.
- Verificación reproducible del checkout: **404/404 pruebas**, `npm run build`
  correcto y `npm run smoke` correcto (**20 rutas y 15 APIs protegidas**, con
  rechazos de lectura/escritura sin sesión).
- Inspección en navegador de `/acceso`, `/registro`, `/recuperar` y `/activar`
  sin callback: renderizan sus formularios/mensajes y activación ofrece volver
  al acceso para retomar el alta. `/equipo` y `/suscripcion` sin sesión
  redirigen a `/acceso` conservando su `returnTo`.
- Lectura directa de la QA activa (sin escrituras): **49 migraciones**, 7
  organizaciones y 4 suscripciones: 3 canceladas y 1 vencida. No hay una
  suscripción vigente para usar los tableros como cliente. Las funciones
  `organizacion_reanudar_registro_empresa`, `planta_editar_activo` y
  `planta_cancelar_evento` están instaladas.
- Privilegios SQL comprobados en la QA: esas tres RPC no son ejecutables por
  `anon` ni `authenticated`; solo `service_role` puede ejecutarlas, conforme
  al patrón de API servidor.
- El contenedor de aplicación `localhost:3000` está `healthy` y conectado a
  esa QA. El Auth local permite el callback `/activar`. `3001` y `3002` siguen
  sin servicio; sus pestañas antiguas no son el runtime activo.
- Diagnóstico Docker de solo lectura: hay **11/11 contenedores activos**, no
  contenedores detenidos por limpiar. El daemon reporta 50 volúmenes (2 en uso,
  1.511 GB total, 1.43 GB reclaimable) y 24.28 GB de build cache (21.46 GB
  reclaimable). No se eliminó nada: los volúmenes desconectados pueden contener
  bases de pruebas anteriores; la caché es regenerable, pero podarla alarga los
  siguientes builds.
- El API del buzón conectado a la QA responde en `http://localhost:55424` y
  reporta 14 mensajes (solo se consultó el conteo, no destinatarios ni cuerpos).
  `http://localhost:54324`, usado en capturas anteriores, no responde ahora.
  La app calcula el enlace del buzón como puerto de Supabase + 3, por lo que
  Equipo/Registro deben dirigir a `55424` mientras la app use la QA `55421`.
- **No verificado en esta auditoría:** flujo visual autenticado por cada rol,
  creación/aceptación real de invitaciones, activación de un plan, correo hacia
  Gmail/Outlook ni integraciones externas. No se alteraron cuentas ni se
  concedieron pilotos. QA usa correo local (Mailpit/Inbucket) y no tiene una
  suscripción vigente; para cerrar esa parte se necesita una identidad de
  prueba y datos/entitlement de prueba aislados, o autorización para crear un
  tenant temporal en un Supabase desechable.

### Verificación incremental publicada (2026-10-03)

- `Angel_Dev` quedó actualizado en `904ded0`. En esa verificación, la suite pasó **409/409**,
  `npm run build` compiló las 23 rutas y `npm run smoke` comprobó **20 rutas y
  15 APIs protegidas**.
- El runtime actual volvió a comprobarse en Docker: `downtimeos-downtimeos-1`
  está `healthy` en `localhost:3000`; `/api/health` responde 200. Supabase QA
  conserva **49 migraciones** en `55421`; el Mailpit asociado en `55424` responde
  200. Hay 11 contenedores activos y ninguno detenido; no se borraron volúmenes,
  cuentas ni datos.
- QA continúa con **7 organizaciones, 4 suscripciones, 0 vigentes y 0 solicitudes
  pendientes**. Por ello, una prueba autenticada de tableros, equipo y cobros no
  queda demostrada por el smoke ni se puede completar con los datos existentes.
  La siguiente validación integral requiere un tenant/cuenta de prueba aislado
  con una solicitud que pueda aprobarse como piloto; no se activó ninguna cuenta
  ni se tocaron datos compartidos.
- En el código se corrigió el cierre de paro desde la bandeja de solicitudes
  (faltaban organización y usuario para la RPC auditada) y la API de eventos
  manuales ya toma autoría y origen del rol/sesión del servidor. Se añadieron
  regresiones para estos casos. También se verificaron contraste AA, nombre
  accesible del selector de rol y navegación de regreso según el rol activo.
- La revisión posterior encontró y corrigió otro destino fijo incorrecto:
  facturación ahora devuelve Dirección/Finanzas a `/direccion`, Operaciones a
  `/operaciones` y Operador a `/operador`, también cuando no tiene permiso. La
  nueva regresión y las pruebas de suscripción pasan **21/21**; suite completa
  **410/410**, build, smoke y runtime Docker (`/suscripcion` y `/api/health`
  responden 200) volvieron a verificarse. Solo se reconstruyó el contenedor de
  app; los 10 servicios QA permanecieron arriba y sin cambios.

- La auditoría de invitaciones confirmó que el correo de confirmación de Supabase
  llega al Mailpit local (no al buzón externo mientras no se configure SMTP).
  También se unificó la resolución del tablero de destino por rol en acceso,
  activación, equipo, plantas y suscripción; los enlaces de `/equipo` ya no envían
  a Operaciones/Operadores a Dirección por defecto. Suite completa **412/412**;
  build y smoke (20 rutas, 15 APIs protegidas) correctos. La prueba autenticada
  real sigue pendiente de un tenant de QA con suscripción activa, sin crear ni
  modificar datos compartidos.

### Corrección de acceso a tableros detectada en runtime (2026-10-04)

- Reproducción: `/direccion` y `/operaciones` daban 302 a `/acceso` sin cookie;
  bastaba enviar `downtimeos_session=x` para obtener 200. El login de producto
  conserva Supabase Auth en `localStorage` y no crea esa cookie, por lo que la
  condición del middleware era incompatible con el mecanismo real de sesión.
- Se retiró esa condición para las páginas de tableros: ahora entregan solo el
  HTML estático genérico, cuyo guard de cliente consulta la sesión local. Las
  APIs de planta mantienen validación de Bearer, identidad, rol y planta; el
  GET real de `/api/planta` sin Bearer sigue respondiendo 401. Se endureció
  también el retorno de login para rechazar un tablero que no corresponde al
  rol autenticado, evitando un rebote entre tableros.
- Suite completa **413/413**, build y smoke (**20 rutas / 15 APIs protegidas**)
  pasan. En el contenedor actualizado: `/direccion` sin cookie y con cookie
  inventada responde 200, `/operaciones` responde 200, `/api/planta` sin Bearer
  responde 401 y `/api/health` responde 200. Se reconstruyó únicamente la app;
  QA permanece sin cambios (11 contenedores activos en total).
- La validación de sesión real para cada rol y un recorrido autenticado de
  punta a punta continúan pendientes; esta corrección no sustituye el E2E con
  una base desechable.
- Además, el callback de confirmación/activación ya no interpreta una respuesta
  fallida al cargar `/api/cuenta` como si faltara la planta de forma definitiva:
  conserva la sesión, muestra el error devuelto por el servidor y habilita
  reintentar. Las rutas de registro y magic link también exponen el mismo
  reintento si falla la carga de perfil. Regresión dirigida: **15/15**.
- Inspección visual en navegador (Docker `localhost:3000`): `/acceso`,
  `/registro`, `/recuperar` y `/activar` sin callback cargan con el mismo sistema
  oscuro, tipografía, tarjeta, acento amarillo y controles. La accesibilidad
  expone etiquetas de los campos, títulos, acciones y enlaces esperados. No se
  enviaron formularios ni se crearon usuarios durante esta inspección.
- Revisión de solo lectura del QA actual: Auth tiene registro habilitado y
  confirmación de correo requerida; Mailpit tiene 14 mensajes. Las 4
  suscripciones existentes siguen canceladas (3) o vencidas (1); no hay una
  cuenta activa para recorrer el tablero autenticado. No se consultaron cuerpos
  de correo ni datos personales y no se modificó QA.

### E2E integral aislado y runtime para pruebas de usuario (2026-10-04)

- Se levantó el Supabase del repositorio en los puertos predeterminados
  `54321`–`54324`; la instalación aplicó **49/49 migraciones** para esta corrida.
  La instancia QA `55421` no se usó en el E2E.
- `scripts/e2e-mvp-local.ps1 -SupabaseWorkdir <repo> -Port 3001
  -ExpectedSupabasePort 54321 -ConfirmDisposableDatabase` completó todas las
  suites implementadas: registro y confirmación por Mailpit, dos empresas
  aisladas, onboarding, recuperación, suscripciones/pagos/comprobantes,
  renovación y cancelación, cuatro roles y dos Operadores, límites del plan,
  permisos/RLS y ciclos operativos STOP→RUN. También comprobó 64 folios sin
  colisión. El runner no borra sus datos; las cuentas sintéticas `example.test`
  no tienen contraseñas reutilizables para el equipo.
- Se reconstruyó el contenedor de la aplicación desde este checkout y se
  conectó a la instancia local nueva en `54321`.
  `localhost:3000` quedó `healthy`; `/api/health`, `/acceso`, `/registro`,
  `/recuperar`, Auth y ambos Mailpit respondieron HTTP 200. Smoke: **20 rutas y
  15 APIs protegidas**. Suite unitaria: **414/414**. El build Docker/Next.js
  generó las 23 rutas correctamente.
- Después de la corrida, se aplicó `20261004000300_renovar_solo_periodos_ofrecidos.sql`
  (50/50 migraciones). Se verificó por REST que tanto solicitud como renovación
  rechazan `mensual` con HTTP 400; la prueba contractual protege esa regla.
- Se corrigió `operaciones.js` para que bitácora y paginación compartan el
  filtro de turno de los KPIs; `test/bitacora-filtro-turno.test.js` cubre la
  regresión.
- Suite unitaria posterior a los cambios: **417/417**; build Docker/Next y
  smoke HTTP **20 rutas / 15 APIs** pasan. `localhost:3000` y Mailpit `54324`
  responden correctamente.
- Se detuvieron los contenedores duplicados de QA (`55421`–`55424`) para dejar
  una sola pila de aplicación/Supabase activa; sus volúmenes y datos se
  conservaron.
- La guía de prueba para usuario está en
  [`GUIA-PRUEBAS-USUARIO.md`](GUIA-PRUEBAS-USUARIO.md).
- El E2E no cubre cargas de 10k/100k, emisión fiscal CFDI/retenciones ni entrega
  externa por SMTP/Resend, WhatsApp o proveedores de IA. Mailpit solo verifica
  correo local. La guía para testers ya está creada; esos servicios externos
  quedan fuera de la prueba local guiada.

### Auditoría adicional de runtime y experiencia pública (2026-10-04)

- Checkout limpio en `Angel_Dev` (`72daee3`) y alineado con `origin/Angel_Dev`.
- `npm test`: **417/417**; `npm run build`: completó Next.js 15.5.27 y
  generó 23 rutas; `npm run smoke`: **20 rutas / 15 APIs**; `npm audit --omit=dev`
  informó **0 vulnerabilidades**.
- Supabase local respondió Auth `200`; Mailpit respondió `200`; app Docker
  `downtimeos-downtimeos-1` estaba `healthy` en `localhost:3000`. Se comprobó
  que el JS corregido de bitácora está servido por el contenedor, y que las
  migraciones locales y registradas en DB están alineadas hasta `20261004000300`.
- Inspección de navegador (lectura visual/DOM, sin enviar formularios) en
  landing, acceso, registro, recuperación, activación sin callback y acceso
  administrativo: renderizan contenido, controles y estilos; acceso protegido
  `/plantas` redirige correctamente a acceso con `returnTo`. En las vistas
  públicas inspeccionadas no apareció pantalla de excepción cliente.
- **Pendiente de certificación manual con sesión:** revisar visualmente y operar
  en navegador los flujos autenticados de configurar planta, seleccionar sitio,
  equipo/invitaciones, administración de facturación, Dirección, Operaciones y
  Operador. El E2E actual comprueba reglas de esos flujos por API/Auth, no todos
  los clics y estados de React en navegador. No se creó una cuenta falsa en la
  base local activa para esta auditoría.
- `app/`, `api/` y `lib/` contienen actualmente 70 archivos JavaScript y 0
  TypeScript. La migración general a TypeScript no se ha iniciado ni es requisito
  para probar el MVP; conservarlo como iniciativa separada evita introducir
  cambios de arquitectura durante la certificación de los recorridos actuales.

### Auditoría transaccional de estructura y nueva corrida E2E (2026-10-04)

- `20261004000400_auditar_mutaciones_estructura.sql` encapsula configuración
  inicial, altas/ediciones/archivos de línea y activo, y sus bitácoras dentro de
  una sola transacción. La app llama a las nuevas RPC auditadas; el snapshot
  before/after queda ligado al ID de entidad correspondiente. Se aplicó a la
  base local del repositorio y se registró en su historial de migraciones.
- En una instancia Supabase E2E nueva y aislada, `supabase start` aplicó las
  **51/51 migraciones**. La corrida integral pasó registro y confirmación,
  onboarding multi-tenant, recuperación, suscripciones/pagos/comprobantes,
  invitaciones de los cuatro roles, permisos/RLS y operación STOP→RUN. Una
  edición sintética de activo por la RPC nueva confirmó en PostgreSQL el snapshot
  anterior y posterior, con `entidad_id` igual al activo `M-01`.
- La instancia temporal y sus volúmenes fueron retirados al terminar. El stack
  normal permaneció saludable en `localhost:3000`; no se alteraron sus cuentas
  ni sus datos. Verificación final: **421/421 pruebas**, build Next.js, smoke
  (**20 rutas / 15 APIs**) y `/api/health` correctos. Commit publicado en
  `Angel_Dev`: `75fdd1f`.
- Sigue pendiente la inspección con sesión real en navegador de las pantallas
  privadas por rol. El E2E prueba sus APIs, Auth y reglas de autorización, pero
  no sustituye que usuarios recorran visualmente cada flujo. También quedan
  fuera de la certificación local entrega externa por SMTP/Resend, WhatsApp e IA,
  cargas de rendimiento y CFDI/retenciones.

### Revisión posterior de experiencia, permisos y runtime (2026-10-04)

- Se corrigió la pérdida del borrador al recargar la configuración inicial:
  ahora se guarda localmente por usuario/planta, se restaura al volver y se
  elimina solo después de que el servidor confirma el guardado. La pantalla
  indica claramente cuando el navegador no permite conservarlo. Quitar una
  línea que tenga máquinas ahora pide confirmación y muestra el efecto antes
  de modificar el borrador.
- El rol Operador ya no recibe por `GET /api/planta` historial, solicitudes ni
  sus cantidades en metadata; no puede pedir páginas de bitácora (`403`). Se
  mantiene el catálogo/estado requerido para capturar paros y el endpoint vivo
  omite la bandeja para ese rol.
- E2E repetido sobre el Supabase desechable `57621` con **51/51 migraciones**:
  registro y confirmación por Mailpit, aislamiento multi-tenant, onboarding,
  recuperación, suscripciones, pagos y comprobantes, roles/invitaciones,
  permisos REST de Operador, ciclos STOP→RUN, vencimientos y 64 colisiones.
  Todo pasó; el stack temporal y sus volúmenes fueron retirados. El stack normal
  de `localhost:3000` y su base `54321` permanecieron intactos.
- Validación posterior: **429/429 pruebas**, build de producción, smoke de
  **20 rutas y 15 APIs**, `/api/health` HTTP 200; Docker app y servicios
  Supabase normales saludables. Las pantallas públicas de acceso, registro y
  recuperación renderizaron; `/suscripcion` redirigió a acceso sin sesión.
  Esto no cubre inspección visual autenticada ni acciones en React por rol.
- Commits publicados en `Angel_Dev`: `efc22fc` y `5679bed`.
- Revisión adicional de HTML/CSS y árbol accesible del navegador: Registro
  enlaza directamente a `/registro` en la navegación principal y en el menú
  móvil; las pantallas de acceso y registro presentan sus controles esperados.
  La ruta `/suscripcion` sin sesión regresa a acceso con `returnTo`.
  `npm audit --omit=dev`: **0 vulnerabilidades**. La base Docker conectada se
  comprobó con **51 migraciones aplicadas y alineadas**.
- Bloqueo restante para declarar “probado como usuario final”: recorrido visual
  en navegador con sesión de Dirección, Finanzas, Operaciones y Operador. La
  entrega de email externo, integraciones de proveedores y carga de rendimiento
  tampoco quedan validadas por esta prueba local.
- Seguimiento posterior: la API de cotización Enterprise ahora rechaza
  cantidades ausentes, fraccionarias o fuera del intervalo de 3–100 en vez de
  cambiarlas silenciosamente; se agregaron pruebas de regresión. Recuperación
  detecta fallos de red durante el callback y conserva el enlace para reintentar
  la validación. Verificación: **431/431 pruebas**, build de producción y smoke
  (**20 rutas / 15 APIs**) correctos. Los commits `e5f181e` y `02fe9b4` están
  publicados en `Angel_Dev`. Se reconstruyó únicamente la app web Docker y
  `/api/health` respondió `ok=true`; Supabase y sus volúmenes no se reiniciaron.
- E2E repetido después de esas correcciones en una instancia aislada con
  **51/51 migraciones**: registro/confirmación Mailpit, dos tenants, onboarding,
  recuperación, pagos/comprobantes, invitaciones de roles, permisos,
  vencimiento, ciclos STOP→RUN y colisiones pasaron. La instancia desechable se
  apagó con `--no-backup` solo después de verificar que contenía los datos
  sintéticos del runner; el stack principal continúa `healthy` en `3000`.
- El E2E ahora comprueba por HTTP autenticado que Enterprise rechaza `0` y `101`
  plantas (400) antes de crear una solicitud; la corrida confirmó ambos rechazos
  y después completó la solicitud de plan válida.
- Revisión para testers: se eliminó una recomendación contradictoria de usar
  `npm run dev` con un `.env.local` que puede apuntar a Supabase alojado. La guía
  distingue instalación local individual de staging compartido y documenta
  Node.js 22, credenciales administrativas solo locales y Mailpit. Docker
  confirma que API, Postgres, Studio y Mailpit del Supabase local se publican en
  `0.0.0.0`; no se abrió una regla de firewall ni se recomienda acceso desde
  otra PC. Para equipo remoto se requiere staging con acceso restringido.
- Verificación de seguimiento (commits `7b2ebce` y `076a6ac`): **443/443 pruebas**, build de
  producción, smoke (**20 rutas / 15 APIs**), `npm audit --omit=dev` sin
  vulnerabilidades y `/api/health` HTTP 200. Supabase local reporta **52/52
  migraciones** aplicadas hasta `20261004000500`; la nueva migración limita a
  una carga temporal simultánea por pago. La app Docker `:3000` quedó healthy.
- Correcciones: los tableros envían al acceso si vence la sesión, guían al
  onboarding si la planta está incompleta, y evitan repetir el alta inicial en
  una planta configurada. Invitaciones con correo equivocado ofrecen cerrar la
  sesión local y volver a abrir el enlace con la identidad invitada. Las cargas
  de comprobante vencidas limpian su objeto/registro; la base impide intentos
  pendientes duplicados.
- Inspección visual/DOM de solo lectura: acceso y registro en `:3000` muestran
  controles y navegación esperados; abrir Suscripción sin sesión redirige al
  acceso, y abrir Dirección sin sesión lleva a `/acceso?destino=direccion`.
  También se revisó la sesión sintética de QA en `:3002` (tablero y equipo), no
  la sesión autenticada del contenedor `:3000`. En QA, los correos van a Mailpit
  y hay invitaciones sintéticas pendientes; no se revocaron ni reenviaron.
- Pendiente para cerrar la verificación como usuario final: ejecutar visual y
  funcionalmente los roles en el contenedor `:3000` con una cuenta/planta de
  prueba autorizada, activar un plan/piloto de prueba para comprobar captura
  operativa y validar las integraciones externas. Esto requiere datos/credenciales
  y decisiones comerciales que la suite automatizada no puede certificar.
- E2E de seguimiento completado en un segundo proyecto Docker aislado, recién
  creado con puertos `55321`–`55329`: aplicó **52/52 migraciones** y pasó los
  flujos de registro/confirmación, dos empresas aisladas, onboarding, invitación
  de Dirección/Finanzas/Operaciones/Operador, recuperación, permisos/RLS,
  comprobante PDF privado, pago/renovación/cancelación, límites Starter,
  vencimiento y ciclos operativos/colisiones. Los datos sintéticos no se usaron
  para alterar la base persistente. El proyecto se detuvo con `--no-backup`;
  se verificó que no quedaron sus contenedores ni volúmenes, y que la app
  principal `:3000` siguió `healthy` con `/api/health` en 200. La corrida omitió
  proveedores externos reales, CFDI y carga de 10k/100k.
- Revisión agregada, sin leer ni exponer datos personales, de la base persistente
  principal: hay **4 suscripciones y 0 vigentes/pilotos**, y **0 cargas de
  comprobante pendientes**. Por ello el equipo puede probar los flujos previos
  al pago, pero las operaciones de producción quedan bloqueadas hasta que una
  cuenta de prueba tenga un plan/piloto activado.

### Revalidación del navegador y entorno activo (2026-10-04)

- En la sesión actual de Docker solo está publicada la app en `localhost:3000`;
  `/api/health` responde 200. `localhost:3001` y `:3002` no responden y no hay
  contenedores de la app publicados en esos puertos. Las pestañas abiertas ahí
  son entornos viejos, no una instancia alternativa del MVP.
- Recorrido visual y accesible de solo lectura sobre `:3000`: Acceso, Registro y
  Recuperación muestran labels, campos, enlaces y botones; las tres conservan el
  tema global oscuro/ámbar y no se capturaron errores ni warnings de consola.
  No se envió el formulario de registro ni se transmitieron credenciales.
- Suscripción sin sesión redirige correctamente a Acceso. Dirección/Plantas y
  los flujos autenticados no se pueden certificar en el contenedor actual sin
  una sesión autorizada; se evitó reutilizar tokens antiguos visibles en otras
  pestañas. Una consulta SQL agregada confirmó de nuevo **3 organizaciones,
  4 suscripciones y 0 suscripciones vigentes**. No se activó ningún piloto ni
  se alteraron cuentas existentes.
- Mailpit responde y la API local reporta **8 mensajes** en la bandeja. Solo se
  consultó el total, no destinatarios ni contenido; esto acredita captura local
  de correos, pero no permite afirmar que una invitación concreta se entregó ni
  que Gmail/Outlook recibieron nada. La guía `GUIA-PRUEBAS-USUARIO.md` explica
  dónde deben revisar los testers el correo local.
- Endurecimiento pendiente del entorno local: Docker publica Supabase API,
  PostgreSQL, Studio y Mailpit en `0.0.0.0` (puertos `54321`–`54324`). Una
  conexión desde una dirección IPv4 del propio equipo alcanzó los cuatro
  puertos; eso confirma el bind amplio, no que una segunda PC logre atravesar
  el firewall. Los perfiles del Firewall de Windows aparecen activos, pero no
  se certificó acceso desde un dispositivo externo. No exponer este stack en
  una red no confiable. Antes de cambiar al bind loopback hay que probar una
  red Docker compartida entre Supabase y el contenedor de la app: hoy el backend
  usa `host.docker.internal`, y un cambio ciego podría cortar su acceso a Auth,
  Storage y Postgres. El Supabase persistente no se reinició ni sus datos se
  modificaron durante esta comprobación.
- El selector de periodicidad vigente en código ofrece solo Semestral y Anual;
  el CSS define selectores oscuros y `billing-panels` tiene `gap: 18px` (14px
  en móvil). Sin acceso autenticado, esto confirma reglas fuente, no el render
  visual final de Suscripción con datos reales.
- El estado de verificación sigue **incompleto**: resta la revisión funcional y
  visual autenticada por rol en `:3000`, con una cuenta de prueba y plan/piloto
  autorizado, antes de afirmar que el MVP está listo para usuarios finales.

### Cobertura ampliada de API sin sesión (2026-10-04)

- Se amplió `scripts/smoke-next.mjs`: ahora prueba **26 combinaciones** de API
  (9 lecturas y 17 métodos mutables) sin token, incluyendo eventos,
  solicitudes, reportes, estructura, invitaciones/equipo, plantas, suscripciones
  y configuración. Todas las escrituras rechazaron la llamada con HTTP 401;
  no se modificaron filas. Se mantiene el control de las rutas públicas por
  separado.
- Smoke ampliado: **20 rutas / 26 operaciones protegidas**; suite unitaria:
  **443/443**.
- Para el defecto visual reportado, el archivo CSS servido por Docker en
  `:3000/css/styles.css` coincide byte por byte (SHA-256) con
  `public/css/styles.css` del checkout y responde 200; confirma que el
  contenedor usa el tema oscuro y el espaciado de tarjetas actuales, pero no
  reemplaza la inspección autenticada de la pantalla Suscripción.
- La imagen activa antes de esta revisión se había creado antes del commit
  `076a6ac` (corrección de expiración de sesión). Se reconstruyó únicamente la
  app con `npm run docker:local`; el contenedor nuevo quedó `healthy`, `/api/health`,
  Supabase Auth y Mailpit contestaron HTTP 200, y el smoke de **20 rutas / 26
  operaciones** volvió a pasar. Los contenedores y la base Supabase no se
  reiniciaron ni modificaron.
- Revisión visual posterior a la reconstrucción en `localhost:3000`: Registro,
  Acceso y Recuperación presentan textos, campos y CTA con el tema global
  oscuro/ámbar. Registro se revisó también en una ventana estrecha y mantiene
  su formulario desplazable. No se enviaron formularios; esta revisión no cubre
  páginas que requieren una sesión real.

### Revalidación automatizada ampliada (2026-10-04)

- Se volvió a consultar Docker mediante `scripts/docker-local.ps1 -ComposeArgs ps`
  para usar las credenciales efímeras del Supabase Local sin exponerlas. La app
  `downtimeos-downtimeos-1` está `healthy` en `127.0.0.1:3000`; no se levantaron
  contenedores adicionales ni se tocaron datos.
- Verificación actual: `npm test` **443/443**, `npm run build` compiló las 23
  rutas, `npm run smoke` comprobó **20 rutas, 10 pantallas con las hojas globales,
  6 recursos estáticos y 26 operaciones protegidas**, `npm audit --omit=dev`
  reportó **0 vulnerabilidades** y `/api/health` respondió `ok=true`. Las rutas
  de acceso, registro, recuperación, configuración, plantas, equipo y
  suscripción respondieron HTTP 200 sin sesión; esto no acredita su recorrido
  autenticado.
- Sigue sin ser posible certificar en el tenant persistente los tableros y
  mutaciones por rol: no hay suscripciones activas y el runner E2E exige una
  base expresamente desechable. No se crearon cuentas ni se otorgaron pilotos.
  Permanecen pendientes la inspección manual autenticada, la entrega real de
  correo externo y staging seguro si los testers accederán desde otras PCs.
- Revisión HTTP adicional de recursos del runtime: las **19 rutas de página**
  (públicas, onboarding y tableros) respondieron 200 y cada HTML incluyó las
  dos hojas globales; los **24 CSS/JS** compilados referenciados respondieron
  200 con tipo de contenido correcto. Es verificación de entrega de recursos,
  no una afirmación de que se haya operado cada pantalla en navegador.
- Inventario Docker: `docker ps -a` muestra únicamente los 11 contenedores
  activos del producto/Supabase y **0 contenedores detenidos o creados**. Por
  tanto, no hay contenedores inactivos que retirar. Sí existen **45 volúmenes
  desconectados** con nombres de proyectos E2E/QA/auditoría, de aproximadamente
  **1.37 GB** en conjunto; incluyen volúmenes Postgres con datos de prueba.
  Se conservan porque borrar volúmenes destruiría esas bases y la autorización
  anterior era para contenedores no usados, no para eliminar datos persistidos.

### E2E de seguimiento en base nueva desechable (2026-10-04)

- Se creó una instancia Supabase Local temporal identificada como
  `downtimeos-e2e-2b50e312`, con **52/52 migraciones** del checkout. El runner
  completo pasó registro/confirmación por Mailpit, dos tenants aislados,
  configuración inicial, recuperación, suscripciones/pagos/comprobantes,
  invitaciones de Dirección/Finanzas/Operaciones/Operador, permisos/RLS,
  vencimiento, renovación/cancelación y ciclos operativos STOP→RUN, incluyendo
  64 folios consecutivos sin colisión. CFDI/cargas y proveedores externos se
  mantuvieron explícitamente fuera del alcance de esta corrida.
- Se detuvo solo el proyecto temporal con `--no-backup`; la comprobación posterior
  encontró **0 contenedores y 0 volúmenes** de ese proyecto. La app principal
  continuó saludable en `localhost:3000`, Supabase persistente no se reinició y
  el smoke volvió a pasar. El E2E automatizado no sustituye la revisión visual
  manual autenticada por rol en el navegador.
- Seguimiento del cliente Auth: **63/63 pruebas dirigidas** de registro,
  reanudación, acceso, invitaciones, callbacks de activación y recuperación.
  En el navegador se revisaron los árboles accesibles de Registro, Acceso,
  Recuperación y Activación sin enlace; no se enviaron formularios ni se usaron
  credenciales. El recorrido autenticado por rol requiere un usuario QA con
  piloto en la base normal; no se modificaron cuentas existentes.
- Navegación real sin sesión: Dirección, Operaciones, Operador, Equipo,
  Suscripción, Plantas, Configuración y Estructura redirigen a Acceso conservando
  `destino`/`returnTo`. `/administracion/acceso` carga el formulario accesible;
  `/administracion/suscripciones` y su API responden 401 sin sesión. La pestaña
  del navegador bloqueó abrir directamente la ruta admin con
  `ERR_BLOCKED_BY_CLIENT`, aunque la respuesta HTTP del servidor es correcta.
