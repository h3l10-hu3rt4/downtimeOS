# Supabase · Orden de ejecución

> Qué correr, en qué orden, y cómo queda separado lo que ya existía de lo que
> se está agregando. Todo se ejecuta desde **Supabase → SQL Editor**.

---

## 1. Qué hay hoy en la base

Una sola tabla con datos reales: **`public.leads`**, los prospectos que deja la
landing. Dentro conviven dos generaciones de cifras:

| Generación | Cuántos | Factor de recuperación | Multiplica por turnos |
| :--- | :--- | :--- | :--- |
| Semilla original | 31 | 0.35 | No |
| Capturados desde el 2026-09-04 | los nuevos | 0.20 | Sí |

**No se reescriben los viejos.** Un lead guarda lo que se le prometió a ese
prospecto el día que llenó el formulario; corregirlo a posteriori sería falsear
el historial comercial. Lo que se hace es **marcarlos** para que ningún reporte
los mezcle por accidente.

---

## 2. Ejecuta en este orden

Los cuatro archivos son idempotentes: si dudas si ya corriste uno, vuelve a
correrlo.

### Paso 1 · Poner orden en lo viejo *(si aún no lo hiciste)*

```
supabase/migraciones/2026-09-04-factor-mttr-20.sql
```

Reemplaza la restricción `leads_ahorro_coherente`, que todavía tenía el factor
0.35 escrito dentro, y crea la vista `leads_por_modelo`.

> ⚠️ **Sin este paso, cada alta de lead falla en producción.** Los tres motores
> de cálculo ya emiten 0.20 y la restricción vieja los rechaza. La landing se
> ve perfecta y el formulario devuelve error.

La restricción nueva se crea `not valid`: se aplica a las filas nuevas sin
revalidar el histórico, que es justo lo que permite conservar los 31 originales.

**Comprueba:**

```sql
select modelo, count(*), min(created_at)::date as desde
from public.leads_por_modelo
group by modelo order by 2 desc;
```

Deberías ver `historico_35` con los 31 originales. Cuando captures un lead nuevo
desde la landing aparecerá como `mttr_20`.

---

### Paso 2 · Crear el esquema de planta

```
supabase/schema-planta.sql
```

Siete tablas nuevas, todas con prefijo `planta_`, más cuatro vistas de análisis
y tres funciones de negocio.

**No toca nada de lo anterior.** `public.leads` guarda *prospectos*; `planta_*`
guarda *operación*. Son dos dominios distintos y el prefijo existe para que la
distinción sea obvia al leer cualquier consulta.

Lo que se crea:

| Tabla | Qué guarda |
| :--- | :--- |
| `planta_lineas` | Las líneas de producción |
| `planta_causas` | Catálogo cerrado de causas raíz |
| `planta_activos` | Los equipos, su tarifa y si son cuello de botella |
| `planta_estados` | Estado vivo: operando o detenido |
| `planta_eventos` | La bitácora de paros |
| `planta_solicitudes` | La bandeja que revisa Mantenimiento |
| `planta_cancelaciones` | Rastro de los registros borrados (soft delete) |

Y tres funciones que ponen las reglas de negocio **dentro de la base**, para que
ninguna capa pueda calcularlas distinto por su cuenta:

- `planta_turno(instante)` — T1 06:00–14:00 · T2 14:00–22:00 · T3 22:00–06:00
- `planta_jornada(instante)` — el turno 3 cruza la medianoche, así que un paro
  de las 02:00 del día 5 pertenece a la jornada del día 4
- `planta_tarifa_aplicable(activo)` — un cuello de botella se valora a la suma
  de las tarifas de su línea, no a la suya

> **Zona horaria.** Está fijada a `America/Mexico_City` en `planta_zona()`. Si
> la planta estuviera en otro huso, se cambia ahí y se vuelve a ejecutar. No se
> deja a la zona de la sesión a propósito: si no, el mismo paro caería en un
> turno distinto según desde dónde se consulte.

---

### Paso 3 · Sembrar la planta de demostración

```
supabase/seed-planta.sql
```

Dos líneas, doce activos, siete causas y cuarenta y tres paros de los últimos
treinta días.

Los eventos se siembran **relativos a la fecha en que ejecutes el archivo**
(`current_date - N`), así que la demo siempre se ve reciente sin regenerar nada.
El folio, la jornada, el turno, la tarifa y el costo los deriva el propio SQL con
las funciones del paso 2: la semilla no puede discrepar del resto de la base
porque usa exactamente las mismas reglas.

> Este archivo **se genera**, no se escribe a mano:
> ```bash
> node scripts/generar-seed-planta.js
> ```
> Se deriva de `public/demo/js/datos.js`, que es la misma fuente que alimenta la
> demo en modo local. Así la base y el navegador no pueden contar historias
> distintas.

**Comprueba:**

```sql
select 'activos' as que, count(*) from public.planta_activos
union all select 'eventos', count(*) from public.planta_eventos
union all select 'solicitudes abiertas', count(*) from public.planta_solicitudes where not cerrada;
```

Esperado: 12 activos, 43 eventos, 2 solicitudes.

```sql
select * from public.planta_pareto;
```

La causa principal debe ser «Ruptura de herramental» con alrededor de $194,000
y un 54 % del total.

---

### Paso 4 · Desplegar

```bash
npm run deploy
```

En Vercel → Settings → Environment Variables tienen que estar las mismas dos
claves que en tu `.env.local`:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

**Comprueba que la demo quedó conectada:** abre `/demo/`, entra con cualquier
perfil y mira la insignia de la barra superior.

| Insignia | Significa |
| :--- | :--- |
| 🟢 **Supabase · datos de demostración** | Todo se está guardando en Postgres |
| 🟡 **Local · datos de demostración** | No hay API: los datos viven en ese navegador |
| 🔴 **Sin conexión · cambios sin guardar** | Se perdió el servidor a media sesión |

---

## 3. Cómo queda separado lo viejo y lo nuevo

```
public.leads                    ← PROSPECTOS de la landing (ya existía)
  ├─ 31 filas   modelo 0.35     ← histórico, se conserva sin tocar
  └─ nuevas     modelo 0.20
  └─ vista leads_por_modelo     ← las separa para que ningún reporte las mezcle

public.planta_*                 ← OPERACIÓN de la planta (nuevo)
  └─ no comparte ninguna fila ni ninguna llave con lo anterior
```

Son dos dominios independientes. Un lead no se convierte en un evento de paro ni
al revés; el día que un prospecto se vuelva cliente, se le daría de alta su
propia planta en `planta_lineas` y `planta_activos`.

---

## 4. Si algo sale mal

**«relation planta_activos does not exist»** al abrir la demo — falta el paso 2.
La demo no se rompe: cae a modo local y lo dice en la insignia.

**El formulario de la landing devuelve error** — falta el paso 1. Ejecuta la
migración y vuelve a intentar.

**La demo dice «Local» aunque desplegaste** — revisa que las variables de
entorno estén en Vercel, no solo en `.env.local`. Sin ellas, `/api/planta`
devuelve 500 y el módulo cae al fallback.

**Quiero volver a empezar la planta desde cero:**

```sql
truncate public.planta_cancelaciones, public.planta_solicitudes,
         public.planta_eventos, public.planta_estados restart identity;
```

y vuelve a correr `seed-planta.sql`. Esto **no toca `public.leads`**.

---

## 5. Lo que todavía no hace la base

Row Level Security está **habilitado sin políticas** en todas las tablas
`planta_*`, igual que en `leads`: las llaves públicas no pueden leer ni escribir
nada, y todo pasa por la `service_role` desde el servidor.

Eso significa que el blindaje por rol de la demo **sigue siendo del lado del
cliente**. El esqueleto de las políticas que lo harían real —incluida la que
impide que el perfil de piso lea la columna de tarifas— está comentado al final
de `schema-planta.sql`, listo para cuando entre Supabase Auth.
