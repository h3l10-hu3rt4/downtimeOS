# HANDOFF TÉCNICO — DowntimeOS

> Documento de traspaso para quien continúe el proyecto. Describe **qué está
> construido, cómo, qué invariantes no se deben romper y qué sigue**.
> Fecha de corte histórica del documento: 2026-09-23. Para el estado operativo
> vigente, consulta la actualización 2026-10-04 más abajo.
>
> Si acabas de entrar al equipo, lee primero el **[README](../README.md)**:
> estado actual, perfiles de la demo, estructura de carpetas, variables de
> entorno y cómo correrlo. Este documento es la capa de abajo: lo que no se ve
> en el código y se rompe fácil.

---

## 1. Contexto

Landing pública + demo multi-rol de **DowntimeOS**, un Micro-SaaS B2B que
traduce paros de máquina en pérdida monetaria en tiempo real. Es un entregable
académico (Ideación y Prototipado, TEC) cuyo MVP se valida en local. El destino
elegido para desplegarlo, una vez terminado el MVP, es DigitalOcean; Vercel queda
descartado.

**Estado vigente (2026-10-04):** la landing está publicada en `downtimeos.tech`,
pero el nuevo producto Next.js no está desplegado allí. La raíz y
`/api/health` responden; `/acceso`, `/registro`, `/recuperar`, `/equipo` y
`/suscripcion` devuelven 404. Vercel tiene `outputDirectory: public`, que sirve
la landing antigua, no las páginas `app/` de Next. No existe el script
`npm run deploy`. No enviar al equipo a ese dominio para probar el MVP.

> **Verificación local 2026-10-04, rama `Angel_Dev` (`7fdde9f`):** 469/469
> pruebas, build de producción, smoke de 20 rutas/10 pantallas/26 métodos
> protegidos, `npm audit` completo sin vulnerabilidades y comprobación visual a
> 390 px de acceso/registro/recuperación sin desbordamiento horizontal. GitHub
> Actions pasó. El E2E aislado con 52 migraciones cubrió alta, confirmación, recuperación,
> invitaciones, permisos, pagos y operación; no se ejecutó contra cuentas reales.
> `localhost:3000` está saludable; el Supabase persistente tiene 7 identidades,
> 3 organizaciones/plantas (una es el cascarón histórico), 7 membresías activas,
> cero invitaciones pendientes y cero suscripciones vigentes. El correo local
> se captura en Inbucket (`:54324`); Resend/SMTP externo y prueba compartida del
> equipo no están configurados. Docker tiene 51 volúmenes desconectados; 17
> son bases QA de Supabase. Se conservaron porque borrarlos elimina datos.

> **Nota vigente:** la §14 es evidencia histórica del sitio antiguo en Vercel,
> no un plan de despliegue ni un bloqueo del MVP. No desplegar ni invertir tiempo
> en corregir Vercel. El despliegue en DigitalOcean se planificará después de
> cerrar y validar el MVP.
>
> 🚚 **DOS IMPLEMENTACIONES.** Las secciones 2 a 13 describen el prototipo local
> (Python). El producto MVP actual es Next.js + Supabase; el antecedente de la
> integración antigua en Vercel está archivado en la **§14**. No seguir esas
> instrucciones para el trabajo actual.

---

## 2. Restricciones del entorno

- El prototipo local **no puede depender de `npm install`**: se presenta en vivo
  y tiene que arrancar con un comando. Por eso `local/server/` usa solo la librería
  estándar de Python.
- El frontend **no tiene build**. Sin bundler, sin transpilación, sin framework.
  Cada dependencia nueva hay que justificarla contra esa restricción.
- El JavaScript de `public/` es **ES5 con `var`**, para abrir en cualquier
  tableta de piso sin sorpresas. Ver la trampa de la §9.

---

## 3. Arranque

```bash
npm run docker:local         # MVP Next.js + Supabase Local; compila y levanta :3000
npm test                     # suite automatizada
npm run build                # build de producción Next.js
npm run smoke                # rutas, estilos y guardias de API sin credenciales
python local/server/main.py  # demo/prototipo estático histórico, no el MVP de cuentas
```

No ejecutes `npm run dev` para pruebas con datos reales sin revisar primero
`.env.local`: puede apuntar a otro Supabase. El lanzador Docker prepara claves
efímeras y selecciona el Supabase Local del repositorio.

---

## 4. Mapa de archivos

El árbol completo está en el **[README](../README.md#estructura)**. Aquí solo las
responsabilidades, para no mezclar capas:

- `public/js/calculator.js` **no toca el DOM**; `app.js` no contiene fórmulas.
- `main.py` no contiene reglas de negocio: delega en `calculo` / `validacion` /
  `store`.
- `lib/repositorio.js` habla con Supabase para los **leads**; `lib/planta.js` y
  `lib/integraciones.js` para la operación de planta, la IA, los PDF y WhatsApp.
- El frontend **nunca** lee `local/data/leads.json`; solo habla HTTP.
- La demo (`public/demo/`) **lee y escribe en Supabase** a través de
  `/api/planta`. Si la API no responde, `datos.js` cae a datos locales en
  `localStorage` y lo dice en la barra superior (ver §15.5).

---

## 5. Contrato de datos

`local/data/leads.json` tiene la forma `{ meta: {...}, leads: [...] }`. En producción,
la tabla `public.leads` con la misma forma de registro; la API expone el `folio`
como `id` para mantener el contrato con `public/js/app.js`.

---

## 6. API

Tabla completa de rutas en el **[README](../README.md#api)**. Lo que importa para
no romperla:

`POST /api/leads` **revalida y recalcula**. Los montos que llegan del cliente se
descartan. Si algún día alguien "optimiza" esto confiando en el navegador, se
acabó la integridad de los leads. Lo mismo con los paros: `POST
/api/planta/eventos` nunca recibe el costo, lo calcula `lib/planta.js` con la
tarifa que la base considera aplicable.

**Límite de 12 funciones (plan Hobby).** Hoy hay 11 archivos en `api/`. Cada
archivo nuevo es una función. Por eso varias rutas comparten función y se
distinguen por método, por la forma del cuerpo o por una reescritura en
`vercel.json`:

- `/api/config` y la sesión de administración (`/api/administracion/sesion`,
  `/salir`) se reescriben hacia `api/health.js`.
- `api/planta/reportes.js` atiende el paro atómico desde piso (cuerpo con
  `activo_id` + `causa_id`) **y** el reporte ejecutivo PDF (sin esos campos).
- `api/whatsapp/alerta.js` atiende envíos manuales y los webhooks de Meta y
  Twilio (se distinguen por cabecera de firma y forma del cuerpo).
- `api/ia/resumen.js`: `POST` es el análisis; `GET`/`PUT` son el selector de
  proveedor que usa Administración.

Si un deploy falla con *"No more than 12 Serverless Functions"*, la solución es
fusionar rutas con este mismo patrón, no quitar funcionalidad.

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
`FACTOR_MITIGACION=0.20`, `PROPORCION_MANO_OBRA=0.35`, `TIPO_CAMBIO_USD=17.50`,
`HORAS_POR_TURNO=8`.

Dos decisiones que conviene entender antes de tocar nada:

**Los minutos son por turno y por máquina.** Tres turnos triplican la exposición
diaria del mismo activo. Los leads capturados antes del 2026-09-03 se calcularon
sin ese multiplicador: tienen la misma tarifa y minutos pero una pérdida anual
menor, y no son comparables sin corregirlos.

**El horizonte anual se conserva en dos escalones.** El copy habla de «300 días
hábiles», pero el código sigue haciendo 25 × 12 porque el esquema de Postgres
valida la invariante `perdida_anual = perdida_mensual × 12`. Colapsarlo en una
sola multiplicación rompería esa restricción.

### El factor de recuperación es 0.20 y está en CUATRO lugares

DowntimeOS acorta la **detección y el despacho**, no la reparación física. Por
eso se proyecta el extremo conservador. Una versión anterior sostenía a la vez un
35 % y un 15 % sin fundamento; se unificaron el 2026-09-04.

> ⚠️ **El cuarto espejo es una restricción de la base, y es el que rompe
> producción.** `leads_ahorro_coherente` en `supabase/schema.sql` lleva el factor
> escrito dentro. Si cambias los tres motores y no migras la restricción, la base
> rechaza **cada** `POST /api/leads` mientras la landing se ve perfectamente
> bien. El ejemplo resuelto está en
> `supabase/migraciones/2026-09-04-factor-mttr-20.sql`.

### Invariante crítico: los espejos

La fórmula, los límites y la lista de dominios genéricos viven **duplicados** a
propósito (servidor = autoridad, cliente = reactividad instantánea sin red).
Si tocas uno, toca todos:

| Concepto | Producción | Prototipo local | Cliente |
| :--- | :--- | :--- | :--- |
| Fórmula y constantes | `lib/calculo.js` | `local/server/calculo.py` | `public/js/calculator.js` |
| Límites por divisa | `lib/calculo.js` | `calculo.LIMITES_TARIFA` | `calculator.js` |
| Dominios B2B rechazados | `lib/validacion.js` | `validacion.DOMINIOS_GENERICOS` | `app.js` |
| Normalización de teléfono | `lib/validacion.js` | `validacion.normalizar_telefono` | `app.js` |
| **Factor de recuperación** | los tres de arriba | | **+ `supabase/schema.sql`** |

Alternativa futura: que `app.js` consuma `GET /api/config` al arrancar y elimine
la duplicación. No se hizo para que la landing siga calculando aunque la API esté
caída.

### Desglose mano de obra / margen (solo cliente)

El panel de resultados separa la mano de obra absorbida del margen de
contribución no generado. La proporción sale del benchmark seleccionado —cada
preset de `calculator.js` trae su `manoObra` por divisa— y cae a 0.35 si la
tarifa se capturó a mano. **Vive solo en el navegador**: no es una columna de
Postgres, así que el reporte PDF la reconstruye aplicando la proporción a la
cifra que devolvió el servidor, que sigue siendo la autoridad.

---

## 8. Reglas de validación

Implementadas en `lib/validacion.js`, espejadas en `local/server/validacion.py` y en
`app.js`:

- Obligatorios: nombre (≥3), empresa, correo y teléfono; ciudad solo si el origen
  es `AUDITORIA`.
- **Regla B2B:** se rechazan `@gmail.com`, `@hotmail.com`, `@outlook.com`,
  `@yahoo.*` y otros dominios públicos. Se desactiva con `REGLA_B2B_ACTIVA=false`.
- Teléfono de 10 dígitos, tolerando espacios, guiones y lada `+52` / `+52 1`.
- El servidor asigna folio, `created_at` y estatus. Nunca el cliente.

Los errores se devuelven como mapa `campo → mensaje` y `app.js` los pinta bajo
cada input (`.err.is-visible` + `.input.is-error`).

---

## 9. Decisiones de diseño (y por qué)

1. **Servidor como autoridad de las cifras.** El cliente calcula para responder
   al instante; el servidor recalcula para persistir.
2. **Escritura atómica del JSON.** Archivo temporal → `flush` + `fsync` →
   `os.replace()`. Un corte a media escritura nunca deja el JSON truncado.
3. **Límites de tarifa por divisa.** Un piso pensado en pesos mutilaba cualquier
   tarifa en dólares.
4. **Semillas derivadas, no hardcodeadas.** `seed_data.ROSTER` tiene solo los
   datos cualitativos; las cifras las produce `calculo.calcular()`. Imposible que
   la semilla y la API se contradigan.
5. **Ticker con `requestAnimationFrame`**, con guarda `delta < 2s` para que al
   volver de una pestaña oculta no dé un salto absurdo.

> ### ⚠️ Trampa del ES5: `var` es de ámbito de función
> El 2026-09-05 el tablero de Operaciones aparecía **entero en blanco** porque
> dentro de un `forEach` se declaró `var caja` para una caja interna, pisando el
> `var caja = $("#solicitudes")` de la misma función. `caja.appendChild(fila)`
> intentaba meter el ticket dentro de su propia caja hija y lanzaba
> `HierarchyRequestError`; la excepción se llevaba por delante los otros tres
> bloques.
>
> Dos lecciones: **nombra distinto todo lo que declares dentro de un callback**,
> y **aísla cada bloque de render en su propio `try`**, como ya hace
> `refrescar()` en `operaciones.js`. Una pantalla de operación que falla entera
> es el peor modo de fallar.

---

## 10. Estado de verificación

Probado en vivo contra el servidor corriendo, no solo por inspección:

- `GET /api/health` → `ok:true`; `POST` válido → `201`; `POST` inválido → `400`
  con el mapa de errores por campo.
- Valores por defecto de la calculadora (5 activos × 2 turnos × 25 min × $1,200
  MXN) → fuga anual `$1,500,000 MXN`, recuperación `$300,000` (factor 0.20 exacto
  confirmado contra la API), desglose `$525,000` de mano de obra y `$975,000` de
  margen.
- Switch de divisa: 1500 MXN → 85.71 USD → 1500 MXN (ida y vuelta exacto).
- Layout sin desbordamiento horizontal en 375 / 768 / 1024 / 1440 px; CLS 0 y
  recálculo completo de la calculadora en 0.19 ms por evento.
- Demo por rol: el operador registra un paro sin ver una sola cifra de dinero y
  el mismo evento aparece con precio en la bitácora de dirección. Escribir a mano
  la URL de dirección con sesión de operador redirige de vuelta.
- Deshacer un cierre devuelve la máquina al paro anterior **conservando la marca
  de tiempo original** del paro.
- Captura retroactiva que cruza medianoche: 4-sep 23:40 → 5-sep 00:25 = 45 min,
  asignado a la jornada del 4, turno T3.
- `0` errores de consola en las tres vistas, en pestaña limpia.

---

## 11. Fuera de alcance (sustituciones conscientes)

- **Reporte PDF de la landing** (el del lead de la calculadora): se arma en el
  cliente y se imprime con `window.print()`. El de Dirección en la demo sí se
  genera en el servidor con PDFKit; si la API no responde, cae al mismo
  mecanismo de impresión.
- **Video demo:** el modal reserva el espacio del reproductor; no hay archivo.
- **Webhook a CRM:** el alta de un lead termina en la base. El punto de
  integración es `crearLead()` en `lib/repositorio.js`.
- **Autenticación de la demo:** simulada en el navegador (ver §15.2).
- **Captura de una planta real** y telemetría IoT: no existen; los datos de
  planta son una simulación sembrada.

---

## 12. Pendientes históricos del prototipo DowntimeCO (no son el backlog del MVP Next.js)

1. **Autenticación real** con Supabase Auth y políticas de fila, reemplazando
   `sesion.js` y `usuarios.js`.
2. **Plantillas de WhatsApp aprobadas en Meta** y después
   `WHATSAPP_META_USE_TEMPLATES=true`. Sin ellas, los avisos de paro y de
   brigada solo llegan a números que escribieron al negocio en las últimas
   24 horas. Guía en [whatsapp-plantillas.md](whatsapp-plantillas.md).
3. **Publicación del producto:** no hay script `npm run deploy`. El dominio
   actual sirve la landing estática y no las rutas Next.js del MVP. Para pruebas
   del equipo, prepara un staging independiente Next.js + Supabase + correo de
   prueba; no cambies la configuración de producción como atajo.
4. **Migrar Tailwind del CDN a build**, o quitarlo: advierte en consola que no
   es para producción y la identidad visual ya vive en `styles.css`.
5. **Trampa de foco en los modales.** `Escape` cierra, pero `Tab` puede salirse.
6. **Decidir qué hacer con las 31 semillas** de leads calculadas con el modelo
   anterior (vista `leads_por_modelo`), y limpiar las solicitudes de paro de
   prueba que se acumulan en la bandeja de producción.
7. **Antes de cada presentación**, correr `supabase/demo-actividad-reciente.sql`:
   el histórico sembrado envejece y sin actividad reciente «Hoy» y «7 días»
   caen a cero en Dirección. También recorta paros de prueba de duración
   irreal (>5 h) que distorsionan las gráficas.

---

## 13. Convenciones del código

- Español en nombres, comentarios y copy. Los identificadores del dominio
  (`perdida_anual`, `minutos_paro_dia`) son snake_case porque coinciden con las
  columnas de Postgres.
- Los comentarios explican **por qué**, no qué. Si un comentario se limita a
  repetir la línea siguiente, sobra.
- CSS: tokens del PRD en `:root`, componentes con BEM laxo, sin utilidades
  propias que dupliquen Tailwind.

---

## 14. Antecedente histórico: Vercel + Supabase + Node (descartado)

Todo lo que sigue en esta sección documenta una configuración antigua y el
estado que se encontró allí. Vercel ya no es el proveedor elegido. Estos datos
se conservan como historial, no requieren acción para completar el MVP y no
deben usarse para dirigir las pruebas actuales. El destino futuro es
DigitalOcean y se abordará después de validar el MVP.

### 14.1 Correspondencia de capas

| Capa | Prototipo local | Producción |
| :--- | :--- | :--- |
| 1 · Presentación | `public/` servido por `main.py` | `public/` servido por Vercel |
| 2 · API | `local/server/main.py` | `api/` + `lib/` |
| 3 · Persistencia | `local/data/leads.json` | Supabase (PostgreSQL) |

### 14.2 Decisiones que NO se deben deshacer

1. **`.vercelignore` excluye `local/`.** Un `requirements.txt` en la
   raíz hacía que Vercel detectara el proyecto como Python y buscara un
   entrypoint inexistente.
2. **La `service_role` key solo vive en variables de entorno del servidor.** RLS
   está habilitado sin políticas: las llaves públicas no pueden leer ni escribir
   nada.
3. **`vercel.json` fija `outputDirectory: public`** y `cleanUrls`. Las rutas
   `.html` de la demo siguen funcionando (Vercel redirige), pero el prototipo
   Python **no** hace rutas sin extensión: por eso los enlaces internos las
   conservan.
4. **La administración se protege en el servidor**, no en el navegador.
   `middleware.js` exige una cookie firmada con HMAC (8 h) para
   `/administracion`, `/dashboard/apiGastos`, `/api/observabilidad/uso`, el
   selector de proveedor de IA y **`GET /api/leads`** (la lista de prospectos
   trae nombre, correo y teléfono; se consulta en el panel). Los tableros de
   planta solo entregan un cascarón estático genérico: Supabase Auth se guarda
   en `localStorage`, por lo que el guard de cliente manda al acceso y todas
   las APIs validan el Bearer, rol y planta antes de exponer o mutar datos. No
   usar una cookie de presencia como autenticación. El `POST` de leads y
   `/api/leads/stats` siguen públicos: son el formulario y los contadores de la
   landing. Las credenciales viven solo en `DASHBOARD_ADMIN_EMAIL` /
   `DASHBOARD_ADMIN_PASSWORD`; **nunca** en `public/` ni en `usuarios.js` (que
   es de la demo y se descarga en claro). `test/proteccion-leads.test.js` vigila
   que la lista no vuelva a quedar abierta.

### 14.3 Estado del despliegue

`downtimeos.tech` no es apto para el piloto: en la auditoría del 2026-10-04,
`/api/health` respondió 200, las rutas del producto (`/acceso`, `/registro`,
`/recuperar`, `/equipo`, `/suscripcion`) respondieron 404 y, además,
`GET /api/planta` sin sesión respondió 200 con estructura de datos operativos.
La respuesta fue `no-store` y cache MISS, por lo que no se atribuye a una copia
cacheada. No se registraron ni reproducen valores de negocio. Las rutas públicas
de leads, IA y observabilidad inspeccionadas sí rechazaron solicitudes anónimas
o solo devolvieron agregados; el hallazgo confirmado es `/api/planta`.

Revalidación directa del dominio (2026-10-04): `/acceso`, `/registro`,
`/recuperar`, `/equipo` y `/suscripcion` continúan en 404. `/api/cuenta` y
`/api/cron/suscripciones` también responden 404; `/api/health` da 200, lo cual
no valida el deploy del producto. `GET /api/planta` anónimo volvió a responder
200, y las colecciones operativas incluidas en la respuesta no están vacías.
La revisión registró solo nombres de propiedades y si había elementos, nunca
identificadores ni valores; aun así confirma exposición de datos operativos y
el dominio no se debe usar para el piloto. Se debe corregir/desplegar con
autorización explícita y luego repetir las verificaciones anónimas antes de
compartirlo.

El código actual de `Angel_Dev` sí invoca `sesionDesdeEncabezado` antes de
consultar planta y devuelve 401 sin Bearer. En esa rama, `vercel.json` selecciona
framework Next.js y deja que Vercel use los valores predeterminados del framework
para build, instalación y salida. `package.json` requiere Node 22.
`npm run build` completó y el runtime standalone sirvió `/acceso` (200) y rechazó
`/api/planta` anónimo con 401. El smoke local y los tests también pasan.

La causa del deploy incorrecto quedó confirmada en modo lectura con Vercel CLI:
el alias `downtimeos.tech` apunta al proyecto `try1` y a un deployment READY de
producción. La lista de deployments identifica su fuente como `main`, commit
`6362ee03aa0470094085aacf4fcaa1f84f6873e8`; `vercel inspect` reporta framework
`python`, `outputDirectory: public` y Node `22.x`. Ese mismo commit contiene
`vercel.json` con framework sin seleccionar y salida `public`, y su
`api/planta/index.js` invoca `estadoPlanta()` sin validar sesión. Esto explica
directamente tanto los 404 de las rutas Next como la respuesta operativa pública.
El proyecto local `.vercel/project.json` también enlaza a `try1`; su archivo
está ignorado por Git, pero ya no se trata solo de una suposición sobre qué
proyecto usa el dominio.

El deployment activo no incorpora `Angel_Dev`; GitHub no registra deployment
de esos commits. La corrección de la rama no está activa en producción.

Revisión de variables Vercel (solo nombres y entornos, sin leer valores): el
proyecto `try1` tiene variables asignadas únicamente a `Production`; no hay
variables para `Preview` ni un ambiente `Staging`. Incluye configuración de
Supabase solo en Production. Por tanto, un Preview del mismo proyecto no está
listo para probar: primero hay que crear una configuración de Preview separada
que apunte a Supabase/Mailpit de prueba, o un proyecto Vercel de staging. Nunca
copiar la service-role key de Production al entorno de prueba.

Revisión de integración en GitHub (2026-10-04): `Angel_Dev` está 161 commits
adelante de `main` y no hay PR asociada a esa rama. Esto explica por qué sus
correcciones no aparecen en el sitio; no es evidencia de que el proyecto
Vercel esté conectado a `Angel_Dev`. Por el tamaño de la diferencia, no hacer
un merge/deploy directo como arreglo de emergencia: primero revisar el diff en
una PR, resolver qué cambios forman el release y desplegar a un preview con
Supabase de prueba; solo después verificar el dominio objetivo.

Antes de invitar testers: revisar en Vercel el proyecto correcto, su root
directory, framework Next.js, Node 22 y variables de staging; publicar solo
cuando la base y el correo sean de prueba; verificar rutas de producto, que
`GET /api/planta` anónimo responda 401 y que el cron esté desplegado y protegido
por `CRON_SECRET`. No considerar `/api/health` por sí solo como señal de
publicación correcta. El repo no define `npm run deploy`.

Revisión de Docker local (2026-10-04): la app está `healthy`, publicada solo en
`127.0.0.1:3000`; sus páginas principales responden 200 y `/api/planta` y
`/api/cuenta` sin sesión responden 401. El smoke contra el contenedor pasa
(20 rutas, 10 pantallas con estilos y 26 comprobaciones de APIs protegidas).
Supabase Auth responde 200 y Mailpit 200 con cero mensajes. Las 52 migraciones
locales aparecen aplicadas. En contraste, Supabase API (`54321`), Postgres
(`54322`), Studio (`54323`) y Mailpit (`54324`) están publicados en `0.0.0.0`;
una prueba TCP desde una dirección no-loopback de la misma PC alcanzó esos
puertos. Esto no demuestra acceso desde otro equipo ni Internet, pero confirma
que el host no los limita a localhost. Se probó en un proyecto Supabase QA
aislado la opción de red Docker
`com.docker.network.bridge.host_binding_ipv4=127.0.0.1` junto con `supabase
start --network-id`; la inspección de Docker aun así mostró los puertos
publicados en `0.0.0.0` y `::`. Esa mitigación no está validada y no debe
considerarse efectiva en este entorno. Se detuvo solo el stack QA, conservando
sus tres volúmenes; no se inició la app QA ni se crearon usuarios, invitaciones
o datos de prueba. La red temporal, ya sin contenedores conectados, fue retirada.
No se modificó ni reinició la instancia persistente. No usar
`supabase stop --no-backup` ni borrar volúmenes. No se crearon usuarios ni
invitaciones durante esta revisión. La app Docker llega hoy a Auth por
`host.docker.internal:54321` (conectividad comprobada desde el contenedor). Una
migración a binding loopback debe actualizar el camino servidor-a-Supabase para
usar la red interna de Kong y mantener las URLs firmadas de Storage accesibles
desde el navegador; cambiar solo la red dejaría el login o los comprobantes
rotos.

Para una base nueva del MVP usa exclusivamente `supabase/migrations` con
Supabase CLI sobre un proyecto vacío y desechable, según el procedimiento del
[README](../README.md). `supabase/EJECUTAR-TODO.sql` y los archivos de
`supabase/migraciones` son históricos: no los ejecutes desde SQL Editor ni como
paso de instalación. Nunca resetees ni borres un volumen que tenga datos que
deban conservarse.

### 14.4 Trampas ya resueltas — no repetir

1. `requirements.txt` en la raíz hacía que Vercel detectara Python.
2. Un `vercel deploy` sin sesión devuelve HTTP 200 con la página de login de
   Vercel, no tu app. Verifica siempre contra `/api/health`.
3. El CLI fijado en `^37` no veía la sesión de `vercel login`; `package.json` ya
   apunta a `^59`.

### 14.5 `/api/health`: público mínimo, detalle solo para Administración

La respuesta pública es `{ ok, timestamp }` (200 o 503). Región de Vercel,
motor y tabla de la base, latencia, el mensaje de error de la base y el total de
leads eran información de infraestructura y de negocio a la vista de cualquiera:
ahora solo se entregan con la sesión del panel, que los muestra en el recuadro
«Infraestructura». El badge del pie de la landing solo lee `ok`. El alias
`persistencia.archivo` ya no existe: nada lo consume.

---

## 15. Demo multi-rol de DowntimeCO

Convierte el «RBAC Visualizer» del PRD —tres pestañas de HTML estático en la
landing— en cuatro páginas con separación real de vistas por rol. Se sirve igual
desde `main.py` y desde Vercel; no necesita build.

### 15.1 Perfiles y permisos

| Perfil | Correo | Ve montos | Ve tarifas | Exporta | Valida paros |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **AR** Ángel Ramírez | `angel@downtimeco.tech` | Sí | **Sí** | Sí | No |
| **HH** Helio Huerta | `helio@downtimeco.tech` | Sí | No | No | Sí |
| **AG** Alondra González | `alondra@downtimeco.tech` | **No** | No | No | No |

Contraseña de los tres: `demo1234`. Los permisos viven en un solo objeto por rol
en `usuarios.js` y cada vista **pregunta** en vez de asumir, así que mover una
capacidad es una línea.

### 15.2 Esto NO es autenticación

Los usuarios y la contraseña están en `usuarios.js`, que el navegador descarga en
claro, y la guarda entre vistas es un `location.replace()`.

**No intentes endurecerlo.** Cuando esto pase a producto, `sesion.js` y
`usuarios.js` se reemplazan por Supabase Auth con políticas de fila. Un candado
de cliente al que se le añaden capas solo parece seguro.

La pantalla de acceso lo dice explícitamente y las tres vistas llevan la insignia
«datos de demostración». Si alguna vez se quita esa advertencia, la demo pasa a
ser una maqueta que finge seguridad, que es exactamente el problema.

### 15.3 Modelo de datos

`demo/js/datos.js` es la fuente única: **dos líneas y doce activos**, con 43
paros de los últimos 30 días fechados en relativo para que la demo siempre se vea
reciente.

**Capacidad por etapa.** Cada línea son etapas en serie (L-01: Maquinado →
Corte → Curado → Pintura; L-02: Ensamble → Pruebas → Empaque) y los equipos de
una misma etapa son paralelos y equivalentes. Con N equipos en la etapa, el
paro de uno quita **1/N** de la capacidad de la línea y se cobra esa misma
fracción de la **tarifa completa de la línea** (L-01 $19,750/h, L-02 $6,600/h).
Una etapa con un solo equipo (`C-01`, `R-01`, `K-01`) es cuello de botella: su
paro deja la línea en 0 % y se cobra la tarifa completa. De ahí sale el Registro
#01 del PRD: 255 min × $19,750 = $4,796 USD.

La regla existe **dos veces y deben coincidir**: `aplicarModeloCapacidad` en
`datos.js` (para el modo local) y `planta_factor_capacidad` /
`planta_tarifa_aplicable` en Postgres (migración `2026-09-05-capacidad-...`).
`test/capacidad-planta.test.js` lo vigila.

**Jornada productiva.** El turno 3 va de 22:00 a 06:00, así que cruza la
medianoche: un paro de las 02:00 del día 5 pertenece a la jornada del día 4. Sin
`jornadaDe()`, un filtro por fechas partiría cada turno nocturno en dos.

**Folios.** `L01-SR-C01-20260904-1425-A1`. La fecha en `YYYYMMDD` y la hora en
`HHMM` hacen que el orden lexicográfico coincida con el cronológico; el hash de
dos caracteres desempata dos eventos del mismo activo en el mismo minuto y se
deriva del contenido, así que es estable entre recargas. Hay una migración que
purga los folios del formato anterior que quedaron en `localStorage`.

**Estados.** Un activo solo puede estar `RUN` o `STOP`. «Setup» **no es un
estado**: es la acción de capturar un paro que ya terminó. `estados()` normaliza
al leer cualquier valor que no sea uno de los dos, para que un navegador con
datos de sesiones viejas no muestre un estado que el producto no tiene.

### 15.4 Reglas de negocio que no son obvias

1. **Tracking temporal desacoplado.** El cronómetro y la pérdida de un paro
   corren desde que el **operador** lo reportó, no desde que Mantenimiento lo
   valida. Validar solo oficializa la causa raíz. Si el reloj esperara a la
   validación, la planta perdería tiempo auditable justo en los paros peor
   atendidos, que son los que más importa medir.
2. **El cuello de botella es una alerta, no un rótulo.** La etiqueta solo aparece
   si el activo está detenido y por tanto estrangulando su línea. Un cuello de
   botella operando no es una incidencia.
3. **El ticket de la bandeja es neutro; el color vive en la insignia.** Con cinco
   tarjetas de colores ninguna destaca; una insignia roja entre contenedores
   grises se ve desde el otro lado del pasillo.
4. **La bandeja es exclusivamente de pendientes.** Aprobar o descartar saca la
   solicitud de la vista. Un buzón que acumula lo ya resuelto deja de ser una
   lista de trabajo.
5. **Deshacer un registro revierte de verdad.** Borrar un cierre devuelve la
   máquina al paro anterior **y reanuda su cronómetro desde la marca original**.
   Reiniciarlo en cero haría aparecer el paro más corto de lo que fue, que es
   justo el dato que el producto existe para medir. Cada eliminación deja rastro
   en un log de cancelaciones.

### 15.5 Persistencia

`datos.js` intenta primero la API (`GET /api/planta`). Si responde, todo se lee
y se escribe en las tablas `planta_*` de Supabase y lo que captura un operador
lo ve cualquier otro dispositivo. Si no responde, cae a una simulación en
`localStorage` y la barra superior lo dice («Local · datos de demostración»).
Nunca se queda en blanco.

Las escrituras son **optimistas**: se actualiza el caché al instante y la
llamada a la API sale en segundo plano, para que las vistas (que son
síncronas) no tuvieran que reescribirse. El reporte de paro desde piso es la
excepción: se confirma en el servidor antes de mostrar éxito, con una
transacción que crea el `STOP` y la solicitud juntos (`planta_reportar_paro`).

### 15.6 Ojo con la sincronía de cifras

Las cifras del showcase por rol de la landing salen de este mismo dataset. Si
cambias los eventos de `datos.js`, **recalcula y actualiza el HTML de la
landing**, o las dos superficies empiezan a contar historias distintas.

### 15.7 Mapa de Líneas (Operaciones)

`pintarMapaLineas()` en `operaciones.js`. **No hay posiciones escritas a mano:**
los niveles salen de agrupar los activos de cada línea por `etapa`, en orden de
aparición. Es la misma topología del modelo de capacidad (§15.3), así que el
mapa no puede contradecir al costeo; agregar una máquina a una etapa la pone
sola en paralelo con las demás.

Color y flujo salen de **`D.cascadaDeLinea()`** en `datos.js` (probada en
`test/cascada-mapa.test.js`), que recorre las etapas de arriba hacia abajo:

| Situación de la etapa | Color | ¿Sale material? |
| :--- | :--- | :--- |
| Todos operando | verde | sí |
| Paro parcial (quedan paralelos operando) | ámbar los caídos, verde los demás | solo de los que operan |
| Paro total (su único equipo o todos los paralelos) | rojo: cuello de botella | no |
| Cualquier etapa aguas abajo de un paro total | rojo: sin flujo, aunque estén encendidas | no |

Las flechas usan `produce` de esa misma cascada, no el estado suelto de cada
máquina: aguas abajo de un corte todo queda quieto.

**Flechas de flujo.** Cada unión entre niveles es un SVG con tres tipos de
tramo, y cada uno decide si se mueve:

| Tramo | Se mueve si… |
| :--- | :--- |
| Salida (de la máquina a la barra) | **esa** máquina está activa. Es exclusivo de ella |
| Sub-tramo de la barra | **alguna** de las máquinas que lo alimentan está activa |
| Llegada (de la barra a la máquina de abajo) | alguna de sus máquinas de origen está activa |

La barra se parte en sub-tramos entre cada punto de entrada o salida;
`sentidoEntre()` decide hacia dónde corre cada uno (converge 2→1, se ramifica
1→3, reparte 3→2). Un paro en M-02 detiene su salida y su mitad de barra, pero la
llegada a C-01 sigue corriendo porque M-01 la alimenta.

Rendimiento: CSS solo anima `transform`; los tramos quietos no tienen animación.
Como el mapa se repinta en cada sincronización, la fase se ancla al reloj
(`animation-delay` negativo) para que las flechas no salten. La geometría (ancho
de caja, separación, paso de flecha) vive en `MAPA` y `FLUJO` de
`operaciones.js`; el paso y la duración de `@keyframes mapa-flujo` en `demo.css`
**deben coincidir** con `FLUJO`.

### 15.8 Sincronización entre perfiles

Polling, no WebSockets: el plan Hobby no sostiene conexiones largas y no hay
función libre de sobra. Los tres tableros releen `GET /api/planta` cada 10 s y
al recuperar el foco de la pestaña. Dos reglas:

- **Dirección** repinta cifras y gráficas, pero **no vuelve a llamar a la IA**
  en cada ciclo; solo con «Regenerar análisis».
- **Operador** solo refresca el panel de estado. **Nunca** reconstruye la rejilla
  del paso en curso ni toca `seleccion`: interrumpir a un operador a medio
  registro es peor que un desfase de 10 s.

---

### Cierre seguro de MVP local (2026-10-04, seguimiento)

- En el commit `a71898a`, `npm test` pasó **476/476**, `npm run build` terminó
  correctamente y `npm run smoke` confirmó 20 rutas, 10 pantallas con estilos y
  26 APIs protegidas. `npm run qa:ui:public` pasó **8 comprobaciones** en Edge:
  acceso, registro, recuperación, activación, móvil a 390 px y feedback B2B de
  registro; no creó identidades ni escribió en Supabase.
- Se confirmó que el Supabase persistente del repo sigue activo y la aplicación
  Docker está saludable. No se hizo E2E sobre esa base porque contiene datos
  persistentes y `scripts/e2e-mvp-local.ps1` exige una base desechable explícita.
- La copia `.qa-e2e-current` existe, pero su stack no está activo. No se borró la
  carpeta ni sus posibles datos locales.
- La última certificación E2E autenticada registrada antes de este seguimiento
  fue contra Supabase QA desechable y pasó alta, onboarding, invitaciones,
  cuatro roles, facturación/piloto y operación. No es una repetición de la
  prueba humana en el runtime persistente; sigue pendiente activar un piloto
  local y que un tester complete la guía en ese entorno.
- Limitación de red confirmada: el Docker local publica la app en loopback,
  pero los puertos auxiliares de Supabase/Mailpit aparecen enlazados a todas
  las interfaces. No usar esta instalación como staging ni abrir datos de QA a
  otras computadoras.
- No se cambió producción ni se enviaron correos externos. Un entorno remoto
  compartido sigue requiriendo staging aislado y configuración del proveedor.
- Revalidación de producción: `downtimeos.tech` redirige a `www.downtimeos.tech`.
  En el host canónico, `/acceso`, `/registro`, `/recuperar`, `/activar`,
  `/equipo` y `/suscripcion` responden 404; `/api/health` responde 200 y
  `/api/planta` anónimo responde 200 con campos JSON operativos. Solo se
  comprobó la presencia de esos campos; no se guardó ni reprodujo el contenido.
  No enviar testers ni usar el dominio con datos reales. La rama `Angel_Dev`
  sí exige sesión en esa API: local responde 401 sin Bearer y el smoke cubre
  esta guardia. El proyecto Vercel canónico sigue sirviendo otra revisión.
- Auditoría ampliada del host canónico: `/api/leads` y las rutas internas de IA,
  observabilidad y suscripciones administrativas rechazaron anónimos con 401;
  `/api/config`, `/api/health` y `/api/leads/stats` solo devolvieron contratos
  públicos. `/api/planta/equipo`, `/estado-vivo`, `/estructura`, `/plantas`,
  `/suscripcion` y `/exportacion` dieron 404: esas funciones del MVP no están
  desplegadas allí. No se intentaron métodos de escritura ni se inspeccionaron
  filas personales.
- Relectura agregada, solo consulta, del Supabase local: 1 suscripción vencida,
  3 canceladas, 0 vigentes; 0 invitaciones pendientes (5 aceptadas); 7
  membresías activas distribuidas en Dirección (3), Finanzas (1), Operaciones
  (1) y Operador (2). No se concedió piloto ni se mutaron estos datos.
- Negativos adicionales en el runtime local: `/api/leads`, `/api/ia/resumen`,
  `/api/observabilidad/uso` y sus métodos mutables sin sesión responden 401;
  el webhook de WhatsApp sin verificación responde 403. Los POST vacíos a
  `/api/cuenta` y `/api/leads` respondieron 400 antes de persistir. `/api/health`
  y `/api/leads/stats` responden 200 con estado mínimo y agregados públicos.

## 16. Integraciones: IA, PDF, WhatsApp y Administración

Todo vive en `lib/integraciones.js`; las llaves solo existen en el servidor.

**IA.** Proveedor por área (`finanzas`, `operaciones`): primero la tabla
`planta_proveedor_ia` (lo que se elige en Administración), si no, las variables
`AI_*_PROVIDER`. Gemini y Claude reciben **agregados ya calculados** y solo
redactan: el modelo nunca aritmetiza, o el texto y el tablero terminan
contradiciéndose. Cada análisis se guarda en `planta_analisis_ia` con su uso de
tokens.

**Reportes PDF.** `crearReporte()` genera un análisis dedicado con el
**proveedor activo para Finanzas** (el mismo que el panel), arma el PDF con
PDFKit y lo sube al bucket privado `reportes` (URL firmada de 24 h). La etiqueta
de la sección de IA usa el nombre real del modelo (`modeloDe()` es la única
fuente). La página 2 trae las tres gráficas de Dirección —dona por causa,
impacto por activo coloreado por línea y pérdida por turno y línea— dibujadas
como vectores con PDFKit (no hace falta navegador). Todo texto alineado a la
derecha termina en la guía `DERECHA` (36 pt dentro del margen) para que ninguna
impresora lo recorte. **Caché:** un reporte del mismo `(desde, hasta)` se
reutiliza solo si se cumplen las tres condiciones:
1. tiene menos de 5 minutos;
2. se hizo con el modelo activo;
3. **no cambió nada en la línea**: la huella `firmaDeDatos()` (paros del periodo
   con sus minutos y costo, y el estado de cada máquina) debe ser idéntica a la
   guardada en `planta_analisis_ia.entrada.firma_datos`.

Si alguna falla, se genera uno nuevo. El reutilizado es **el mismo archivo**:
conserva su `created_at` y la fecha «EMITIDO» impresa en el PDF, que son las de
su generación original. El tablero lo avisa con esa hora y el mensaje de
WhatsApp incluye «Generado: …». La huella no se envía a la IA.
`test/cache-reporte.test.js`, `test/cache-sin-cambios.test.js` y
`test/pdf-modelo.test.js` lo vigilan.

**WhatsApp.** Meta Cloud API por defecto (`WHATSAPP_PROVIDER`), Twilio de
respaldo. Destinatarios separados: `WHATSAPP_OPERACIONES_DESTINATARIO` para
paros y brigada, `WHATSAPP_FINANZAS_DESTINATARIO` para reportes. Con
`WHATSAPP_META_USE_TEMPLATES=false` los mensajes son texto libre y **Meta solo
los entrega dentro de la ventana de 24 h** tras un mensaje del destinatario; con
`true`, cada tipo exige su plantilla aprobada
([whatsapp-plantillas.md](whatsapp-plantillas.md)). La alerta automática al
registrar un paro solo se dispara con `WHATSAPP_ALERTAS_ACTIVAS=true`; el botón
«Notificar a Brigada» no depende de esa variable. No existe aviso automático al
crear una solicitud desde piso.

**Interruptores.** `planta_interruptores_integraciones` permite apagar IA,
WhatsApp o PDF desde Administración sin redeploy (`exigirIntegracionActiva()`).
Si la tabla no existe, todo queda encendido.

**Observabilidad.** `/api/observabilidad/uso` devuelve solo conteos (análisis,
tokens, reportes, mensajes por estado); **nunca** destinatarios, contenido,
errores del proveedor ni valores de variables.
