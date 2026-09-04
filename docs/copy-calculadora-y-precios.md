# Copy de producción — Calculadora de Margen Oculto y Estructura de Precios

**Producto:** DowntimeOS · Landing pública B2B
**Alcance:** Sección 3 (Lead Magnet) y Sección 6 (Pricing)
**Estado:** copy final, maquetado en `public/index.html`

Este documento resuelve tres inconsistencias de la versión anterior:

| # | Inconsistencia | Resolución |
| :-- | :--- | :--- |
| 1 | Se prometía «$0 hardware» en absoluto, pero Enterprise incluía sensores IoT | Los planes base son 100% Zero-Hardware; Enterprise ofrece telemetría **opcional** plug-and-play |
| 2 | Convivían un «recuperable del 35%» y un «callout del 15%», sin sustento | Modelo único: **20% de reducción de MTTR**, con la mano de obra absorbida separada del margen de contribución |
| 3 | Jerga de software en una página para directores de planta | Lenguaje industrial: confiabilidad, segregación de datos, aislamiento OT/IT |

---

# SECCIÓN 1: CALCULADORA DE MARGEN OCULTO (LEAD MAGNET INTERACTIVO)

### Titular y Subtitular

**Titular:**
> Calcula el margen que tu planta pierde sin registrarlo.

**Subtitular:**
> Los paros menores no llegan a la bitácora, pero sí llegan al estado de resultados. Ajusta los parámetros reales de tu operación y obtén la cifra en pesos, con el modelo de cálculo a la vista y sin supuestos ocultos.

---

### Parámetros de Configuración (Inputs de Usuario)

**Divisa del análisis**
`MXN` | `USD` — Predeterminado: MXN. Tipo de cambio de referencia: 17.50 MXN por USD.

**Activos críticos en el cuello de botella**
Deslizador de **1 a 30 equipos**. Predeterminado: 5.
*Microcopy:* «Cuenta solo los equipos cuyo paro detiene el flujo. Un activo con gemelo redundante no entra en este cálculo.»

**Esquema de turnos**
`1 Turno (8 h)` · `2 Turnos (16 h)` · `3 Turnos (24 h)` — Predeterminado: 2 turnos.
*Microcopy:* «El paro se declara por turno: dos turnos duplican la exposición diaria del mismo activo.»

**Tiempo de paro no programado por turno y activo**
Deslizador de **5 a 90 minutos**. Predeterminado: 25 minutos.
*Microcopy:* «Incluye el tiempo de detección y despacho, no solo la reparación. Es donde se esconde el margen: la brigada suele enterarse tarde.»

**Costo hora-máquina promedio (mano de obra absorbida + margen de contribución)**
Campo editable con tres benchmarks por tipo de celda:

| Tipo de celda | Costo hora-máquina | Mano de obra absorbida | Margen de contribución |
| :--- | ---: | ---: | ---: |
| Maquinado CNC | $950 MXN / $55 USD | $340 MXN / $20 USD | $610 MXN / $35 USD |
| Prensas y corte | $1,400 MXN / $80 USD | $470 MXN / $27 USD | $930 MXN / $53 USD |
| Ensamble manual | $500 MXN / $30 USD | $230 MXN / $14 USD | $270 MXN / $16 USD |

*Microcopy:* «Si capturas una tarifa propia, el diagnóstico la reparte 35% mano de obra y 65% margen de contribución, la proporción media de las tres celdas de referencia.»

---

### Modelo Matemático de Diagnóstico (Explicación Transparente)

El diagnóstico se resuelve en cuatro pasos auditables. No hay coeficientes ocultos ni factores de ajuste propietarios.

**Paso 1 — Exposición diaria**
```
Minutos de paro por día = Activos críticos × Turnos × Minutos por turno
```

**Paso 2 — Exposición anual**
```
Horas de paro al año = (Minutos de paro por día × 300 días hábiles) ÷ 60
```
El horizonte de 300 días hábiles corresponde a 25 días productivos por mes durante 12 meses. Es una base conservadora: descuenta domingos, festivos oficiales y paros programados de mantenimiento.

**Paso 3 — Fuga financiera anual**
```
Fuga anual = Horas de paro al año × Costo hora-máquina
```

**Paso 4 — Desglose del impacto**
```
Mano de obra absorbida  = Fuga anual × Proporción de mano de obra
Margen no generado      = Fuga anual × Proporción de contribución
```
La separación importa para el análisis financiero: la mano de obra absorbida es un costo que la planta paga aunque la máquina esté detenida, mientras que el margen de contribución es utilidad que simplemente no se generó. Son dos conversaciones distintas en el comité de dirección.

---

#### Fundamentación de la hipótesis de recuperación (20% de MTTR)

DowntimeOS no promete producir más rápido ni eliminar las fallas. Actúa sobre una sola variable, y por eso la proyección es acotada:

**El MTTR tiene dos componentes y solo uno es atacable por software:**

| Componente del MTTR | Qué lo compone | ¿DowntimeOS lo reduce? |
| :--- | :--- | :--- |
| Detección y despacho | Tiempo entre que el equipo se detiene y la brigada correcta se entera | **Sí.** Notificación automática al detenerse, con el activo, la causa y la prioridad |
| Reparación efectiva | Diagnóstico físico, refacción, mano de obra técnica | **No.** Depende de la brigada, del refaccionario y del estado del equipo |

En operaciones que registran paros en papel o en hoja de cálculo, la detección y el despacho concentran una parte sustancial del tiempo total de respuesta, porque la incidencia se conoce al cierre de turno. La proyección de DowntimeOS se limita a **20% de reducción del MTTR** por notificación y despacho automatizado.

```
Recuperación anual estimada = Fuga anual × 0.20
```

**Por qué 20% y no una cifra mayor.** Es el extremo conservador del rango que se observa al pasar de detección diferida a notificación inmediata. Se eligió deliberadamente por debajo de lo alcanzable para que el retorno se sostenga en el escenario pesimista: si el resultado real es mejor, la planta gana; si es peor, el modelo no se rompe. La cifra se valida contra la línea base de la propia planta durante el piloto de 14 días, y ese informe —no esta calculadora— es el que se lleva a la firma del contrato.

---

### Resultados del Diagnóstico (Outputs Visuales)

**Cifra de impacto (destacada, en rojo):**
> **Fuga financiera oculta anual**
> `$1,500,000 MXN`

**Desglose del diagnóstico:**

| Concepto | Ejemplo con valores predeterminados |
| :--- | ---: |
| Costo por minuto detenido (cuello de botella) | $100.00 MXN / min |
| Impacto financiero mensual estimado | $125,000 MXN |
| Pérdida anual acumulada | $1,500,000 MXN |
| Horas-máquina perdidas al año | 1,250 h |
| — Mano de obra absorbida | $525,000 MXN |
| — Margen de contribución no generado | $975,000 MXN |

**Proyección de recuperación neta (bloque verde):**
> **Recuperación anual estimada con DowntimeOS**
> `$300,000 MXN`
>
> Una reducción del 20% en el tiempo de detección y despacho, sobre 250 minutos de paro diario de flota. Frente al costo anual del plan Pro ($1,788 USD ≈ $31,290 MXN), la recuperación proyectada lo cubre **9.6 veces**.

*Nota al pie del panel:*
> Diagnóstico calculado en tu navegador, sin enviar datos a ningún servidor. Cifras estimadas con fines de diagnóstico; el número definitivo sale de la medición de tu propia línea durante el piloto.

---

### Llamado a la Acción (CTA)

**Botón primario:**
> Generar Reporte Ejecutivo para Dirección (PDF)

**Microcopy bajo el botón:**
> Recibes el desglose completo con tus parámetros, la separación entre mano de obra y margen, y el comparativo contra el costo de la suscripción. Formato listo para consejo o comité de inversión.

**Campos del formulario:** Nombre completo · Correo corporativo · Teléfono / WhatsApp · Empresa o parque industrial.

**Aviso de validación:**
> Solicitamos correo corporativo de planta. No aceptamos dominios de correo personal.

---

# SECCIÓN 2: ESTRUCTURA DE PRECIOS Y PLANES (PRICING MATRIX)

### Encabezado y Garantía de Infraestructura

**Titular:**
> Empieza sin comprar hardware. Escala a telemetría solo si la necesitas.

**Subtitular:**
> Los tres planes operan sobre tabletas comerciales que tu planta ya puede tener. La instrumentación electrónica es una opción del plan Enterprise, no un requisito de entrada.

**Bloque de garantía de infraestructura (destacado):**

> **Starter y Pro: arquitectura Zero-Hardware.**
> Captura 100% digital en tabletas o teléfonos comerciales sobre red celular o Wi-Fi de invitados. Sin comprar equipo, sin cableado a tableros, sin intervención en PLCs y sin abrir puertos en el firewall de planta.
>
> **Enterprise: telemetría no invasiva, y es opcional.**
> Si quieres capturar el paro de forma automática, se instalan sensores externos plug-and-play —clamps de corriente y acelerómetros magnéticos— que se sujetan por fuera del tablero y del equipo. **No se corta cableado, no se reprograman PLCs y no se toca la lógica de control.** Puedes contratar Enterprise por su alcance multiplanta y su integración con ERP y seguir operando con captura manual: la telemetría se cotiza aparte, por activo.

---

### Tarjetas de Planes

#### 1. Starter — Validación táctica en PyME

**$49 USD / mes**, facturado anual ($588 USD al año). Mensual sin compromiso: $59 USD.

*Enfoque:* poner números al paro en el cuello de botella, sin proyecto de TI y sin inversión en equipo.

- Hasta **5 activos críticos**
- Captura en piso 100% digital, sobre tabletas comerciales ilimitadas
- **Cero hardware:** ninguna compra de equipo para operar
- Registro de incidencias con catálogo cerrado de causas
- Indicadores base de disponibilidad y OEE
- Historial exportable de paros
- Soporte por WhatsApp en horario hábil

**CTA:** Iniciar Piloto de 14 Días

---

#### 2. Pro — Control de planta y brigadas rápidas · *Recomendado para PyME industrial*

**$149 USD / mes**, facturado anual ($1,788 USD al año). Mensual sin compromiso: $179 USD.

*Enfoque:* abatir el tiempo de detección y despacho, que es donde vive la recuperación del 20% de MTTR.

- Hasta **20 activos** de planta
- Todo lo de Starter, y además:
- **Cero hardware:** sigue operando sobre tabletas comerciales
- Tablero financiero en tiempo real en pantallas de piso ($/minuto)
- Pareto 80/20 de causas raíz con concentración de impacto
- Cálculo automático de MTTR y MTBF por activo y por turno
- **Despacho automatizado a brigadas** por WhatsApp al detenerse un equipo crítico
- Priorización por cuello de botella, no por orden de llegada
- Reporte mensual en PDF para comité de dirección
- Soporte prioritario con tiempo de respuesta comprometido

**CTA:** Iniciar Piloto de 14 Días

---

#### 3. Enterprise — Integración industrial y multiplanta

**$299 USD / mes por sitio**, facturado anual ($3,588 USD al año). Cotización corporativa a partir de tres sitios.

*Enfoque:* consolidar varias plantas y conectar el paro con los sistemas que ya gobiernan la operación.

- **Activos ilimitados** y consolidación multiplanta
- Todo lo de Pro, y además:
- **Telemetría IoT no invasiva, opcional y cotizada por activo:** clamps externos de corriente y acelerómetros magnéticos, sujetos por fuera del equipo. Sin cortar cableado ni reprogramar PLCs
- Integración con ERP por API (SAP, Epicor, Intelisis) en ambos sentidos
- Segregación lógica de datos por planta y por sociedad
- Perfiles de acceso diferenciados: dirección, operaciones y piso
- Disponibilidad de servicio comprometida por contrato: **99.9%**
- Auditor industrial asignado, con revisión mensual de productividad
- Acompañamiento en el despliegue de cada sitio

**CTA:** Solicitar Cotización Corporativa

---

### Tabla comparativa de infraestructura

| | Starter | Pro | Enterprise |
| :--- | :---: | :---: | :---: |
| Compra de hardware para operar | No | No | No |
| Tabletas comerciales | Sí | Sí | Sí |
| Intervención en PLCs o cableado | Nunca | Nunca | Nunca |
| Puertos abiertos en firewall de planta | Ninguno | Ninguno | Ninguno |
| Telemetría automática por sensor externo | — | — | Opcional, por activo |
| Integración con ERP | — | — | Sí |
| Consolidación multiplanta | — | — | Sí |

---

### Nota de Blindaje y Transparencia

**Piloto de 14 días, sin riesgo de migración.**
Se instrumenta un solo activo —tu cuello de botella— en menos de 48 horas. Al día 14 recibes un informe con las fugas reales medidas en tu línea, comparadas contra el costo de la suscripción anual. Si el número no justifica la contratación, no continúas y te llevas el histórico levantado durante el piloto.

**Facturación corporativa.**
Pago por transferencia bancaria contra Orden de Compra. Crédito comercial a 30 y 60 días para plantas calificadas. Facturación fiscal por sitio o consolidada, según lo requiera tu área de cuentas por pagar.

**Cancelación.**
Los planes anuales se cancelan con 30 días de aviso al término del periodo contratado. Los planes mensuales se cancelan en cualquier momento, sin penalización.

**Portabilidad de la información.**
El histórico de paros, el Pareto de causas y los indicadores de disponibilidad son propiedad de la planta y se exportan en formato abierto en cualquier momento, durante y después de la relación comercial.
