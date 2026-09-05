# HANDOFF TÉCNICO — DowntimeOS

> Documento de traspaso para quien continúe el proyecto. Describe **qué está
> construido, cómo, qué invariantes no se deben romper y qué sigue**.
> Fecha de corte: 2026-09-05.
>
> Si acabas de entrar al equipo, lee primero **[KEKAS.md](KEKAS.md)**: contexto,
> árbol de carpetas, inventario de herramientas y dónde encaja la IA.
> Para correrlo, **[README.md](README.md)**.

---

## 1. Contexto

Landing pública + demo multi-rol de **DowntimeOS**, un Micro-SaaS B2B que
traduce paros de máquina en pérdida monetaria en tiempo real. Es un entregable
académico (Ideación y Prototipado, TEC) que debe **correr 100 % local** y
demostrarse en vivo, y a la vez desplegarse en Vercel + Supabase.

**Estado: completo y verificado end-to-end.** No hay trabajo a medias.

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
npm test                     # 23 pruebas del motor de cálculo y validación
npm run dev                  # vercel dev contra Supabase real
npm run deploy               # despliegue a producción
```

---

## 4. Mapa de archivos

El árbol completo y comentado está en **[KEKAS.md](KEKAS.md) §4**. Aquí solo las
responsabilidades, para no mezclar capas:

- `public/js/calculator.js` **no toca el DOM**; `app.js` no contiene fórmulas.
- `main.py` no contiene reglas de negocio: delega en `calculo` / `validacion` /
  `store`.
- `lib/repositorio.js` es el único módulo que habla con Supabase.
- El frontend **nunca** lee `local/data/leads.json`; solo habla HTTP.
- La demo (`public/demo/`) **no llama a la API**: vive en `localStorage`. No
  puede ensuciar Supabase ni `leads.json` por diseño.

---

## 5. Contrato de datos

`local/data/leads.json` tiene la forma `{ meta: {...}, leads: [...] }`. En producción,
la tabla `public.leads` con la misma forma de registro; la API expone el `folio`
como `id` para mantener el contrato con `public/js/app.js`.

---

## 6. API

Tabla completa de rutas y reglas de validación en **[README.md](README.md)**.
Lo que importa para no romperla:

`POST /api/leads` **revalida y recalcula**. Los montos que llegan del cliente se
descartan. Si algún día alguien "optimiza" esto confiando en el navegador, se
acabó la integridad de los leads.

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
`app.js`. Detalle en **[README.md](README.md)**.

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

Lista completa en **[README.md](README.md)**. Lo relevante: PDF por
`window.print()`, video como placeholder, webhooks sin implementar,
autenticación simulada, IA sin conectar.

---

## 12. Próximos pasos sugeridos (priorizados)

1. **Conectar la IA.** Los dos reportes están especificados en
   [KEKAS.md](KEKAS.md) §5, con el punto de enganche ya aislado.
2. **Autenticación real** con Supabase Auth y políticas de fila, reemplazando
   `sesion.js` y `usuarios.js`.
3. **Migrar Tailwind del CDN a build**, o quitarlo: hoy advierte en consola que
   no es para producción y la identidad visual ya vive en `styles.css`.
4. **Trampa de foco en los modales.** Hoy se enfoca el primer input y `Escape`
   cierra, pero `Tab` puede salirse del modal.
5. **Decidir qué hacer con las 31 semillas** de Supabase: se calcularon con el
   modelo anterior y arrastran el promedio que muestra el hero. La vista
   `leads_por_modelo` permite separarlas; regenerarlas es la otra opción.

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

### 14.3 Estado del despliegue

La verificación end-to-end contra la landing desplegada es del 2026-09-01,
anterior al cambio de fórmula.

> ⚠️ Antes de desplegar la versión actual hay que ejecutar
> `supabase/migraciones/2026-09-04-factor-mttr-20.sql` (ver §7), o cada alta de
> lead será rechazada por la base.

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
| **AH** Alejandro Huerta | `alex@downtimeco.tech` | Sí | **Sí** | Sí | No |
| **AG** Alondra González | `alondra@downtimeco.tech` | Sí | No | No | Sí |
| **HH** Helio Huerta | `helio@downtimeco.tech` | **No** | No | No | No |

Contraseña de los tres: `demo1234`. Los permisos viven en un solo objeto por rol
en `usuarios.js` y cada vista **pregunta** en vez de asumir, así que mover una
capacidad es una línea.

### 15.2 Esto NO es autenticación

Los usuarios y la contraseña están en `usuarios.js`, que el navegador descarga en
claro, y la guarda entre vistas es un `location.replace()`.

**No intentes endurecerlo.** Cuando esto pase a producto, `sesion.js` y
`usuarios.js` se reemplazan por Supabase Auth con políticas de fila. Un candado
de cliente al que se le añaden capas solo parece seguro.

La pantalla de acceso lo dice explícitamente y las tres vistas llevan el badge
«Datos simulados». Si alguna vez se quita esa advertencia, la demo pasa a ser una
maqueta que finge seguridad, que es exactamente el problema.

### 15.3 Modelo de datos

`demo/js/datos.js` es la fuente única: **dos líneas y doce activos**, con 43
paros de los últimos 30 días fechados en relativo para que la demo siempre se vea
reciente.

**Regla del cuello de botella.** `C-01` (Línea 01) y `R-01` (Línea 02) no tienen
equipo redundante, así que sus paros se valoran a la tarifa de **su línea** —la
suma de sus estaciones: $19,750/h en L-01 y $6,600/h en L-02— y no a la propia.
Los demás activos tienen gemelo y cuestan lo suyo. De ahí sale el Registro #01
del PRD: 255 min × $19,750 = $4,796 USD.

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

Lo capturado en la demo va a `localStorage`, no a la API: no ensucia Supabase ni
`leads.json`, funciona sin conexión y se reinicia desde la pantalla de acceso.
El efecto secundario es el mejor momento de la demostración: un paro registrado
en la tableta aparece en el tablero del gerente y en el Pareto de dirección del
mismo navegador.

### 15.6 Ojo con la sincronía de cifras

Las cifras del showcase por rol de la landing salen de este mismo dataset. Si
cambias los eventos de `datos.js`, **recalcula y actualiza el HTML de la
landing**, o las dos superficies empiezan a contar historias distintas.
