# HANDOFF TÉCNICO — DowntimeOS

> Documento de traspaso para quien continúe el proyecto. Describe **qué está
> construido, cómo, qué invariantes no se deben romper y qué sigue**.
> Fecha de corte: 2026-09-23.
>
> Si acabas de entrar al equipo, lee primero el **[README](../README.md)**:
> estado actual, perfiles de la demo, estructura de carpetas, variables de
> entorno y cómo correrlo. Este documento es la capa de abajo: lo que no se ve
> en el código y se rompe fácil.

---

## 1. Contexto

Landing pública + demo multi-rol de **DowntimeOS**, un Micro-SaaS B2B que
traduce paros de máquina en pérdida monetaria en tiempo real. Es un entregable
académico (Ideación y Prototipado, TEC) que debe **correr 100 % local** y
demostrarse en vivo, y a la vez desplegarse en Vercel + Supabase.

**Estado: producción activa; demo multi-rol verificada.**

> 🚚 **DOS IMPLEMENTACIONES.** Las secciones 2 a 13 describen el prototipo local
> (Python), que sigue siendo la referencia ejecutable sin internet. Los
> artefactos de producción (Node + Supabase + Vercel) están en la **§14**. Lee
> la §14 antes de tocar nada relacionado con el deploy.

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
python local/server/main.py        # demo completa en :3000, sin dependencias
npm test                     # 38 pruebas: cálculo, validación, capacidad, WhatsApp y caché de reportes
npm run dev                  # vercel dev contra Supabase real
npm run deploy               # despliegue a producción
```

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

## 12. Próximos pasos sugeridos (priorizados)

1. **Autenticación real** con Supabase Auth y políticas de fila, reemplazando
   `sesion.js` y `usuarios.js`.
2. **Plantillas de WhatsApp aprobadas en Meta** y después
   `WHATSAPP_META_USE_TEMPLATES=true`. Sin ellas, los avisos de paro y de
   brigada solo llegan a números que escribieron al negocio en las últimas
   24 horas. Guía en [whatsapp-plantillas.md](whatsapp-plantillas.md).
3. **Despliegue automático:** hoy el repo no está conectado a Vercel y cada
   deploy es manual (`npm run deploy`). Conectarlo evita que GitHub y
   producción se desfasen.
4. **Migrar Tailwind del CDN a build**, o quitarlo: advierte en consola que no
   es para producción y la identidad visual ya vive en `styles.css`.
5. **Trampa de foco en los modales.** `Escape` cierra, pero `Tab` puede salirse.
6. **Decidir qué hacer con las 31 semillas** de leads calculadas con el modelo
   anterior (vista `leads_por_modelo`), y limpiar las solicitudes de paro de
   prueba que se acumulan en la bandeja de producción.

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

## 14. Producción: Vercel + Supabase + Node

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
   `/administracion`, `/dashboard/apiGastos`, `/api/observabilidad/uso` y el
   selector de proveedor de IA. Las credenciales viven solo en
   `DASHBOARD_ADMIN_EMAIL` / `DASHBOARD_ADMIN_PASSWORD`; **nunca** en
   `public/` ni en `usuarios.js` (que es de la demo y se descarga en claro).

### 14.3 Estado del despliegue

Producción en **downtimeos.tech** (y `www.`). El repo **no** está conectado a
Vercel: subir a `main` no despliega nada; hay que correr `npm run deploy` y
verificar contra `/api/health`. Tras cambiar una variable de entorno también hay
que volver a desplegar.

Para una base nueva: `supabase/EJECUTAR-TODO.sql` y después las migraciones del
2026-09-06 (proveedor de IA) y 2026-09-07 (interruptores). Ver
[ORDEN-DE-EJECUCION](../supabase/ORDEN-DE-EJECUCION.md).

### 14.4 Trampas ya resueltas — no repetir

1. `requirements.txt` en la raíz hacía que Vercel detectara Python.
2. Un `vercel deploy` sin sesión devuelve HTTP 200 con la página de login de
   Vercel, no tu app. Verifica siempre contra `/api/health`.
3. El CLI fijado en `^37` no veía la sesión de `vercel login`; `package.json` ya
   apunta a `^59`.

### 14.5 Contrato con `public/`: un campo legacy

`app.js` pinta el badge del footer con `persistencia.archivo`, campo que en la
era JSON era la ruta del archivo. La API nueva devuelve `tabla`, así que el badge
mostraba **"API OK · undefined"**. Se agregó `archivo` como alias en
`api/health.js`. Si algún día se toca esa respuesta, ese campo no se puede quitar
sin romper el footer.

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

Color: `RUN` verde, `STOP` ámbar, `STOP` + `cuelloBotella` rojo. No se inventa
un tercer estado.

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

## 16. Integraciones: IA, PDF, WhatsApp y Administración

Todo vive en `lib/integraciones.js`; las llaves solo existen en el servidor.

**IA.** Proveedor por área (`finanzas`, `operaciones`): primero la tabla
`planta_proveedor_ia` (lo que se elige en Administración), si no, las variables
`AI_*_PROVIDER`. Gemini y Claude reciben **agregados ya calculados** y solo
redactan: el modelo nunca aritmetiza, o el texto y el tablero terminan
contradiciéndose. Cada análisis se guarda en `planta_analisis_ia` con su uso de
tokens.

**Reportes PDF.** `crearReporte()` genera un análisis dedicado, arma el PDF con
PDFKit y lo sube al bucket privado `reportes` (URL firmada de 24 h). **Caché de
5 minutos:** si ya existe un reporte del mismo `(desde, hasta)` más reciente que
eso, se reutiliza. Por eso «Generar» y luego «Enviar por WhatsApp» no gastan
tokens dos veces. `test/cache-reporte.test.js` lo vigila.

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
