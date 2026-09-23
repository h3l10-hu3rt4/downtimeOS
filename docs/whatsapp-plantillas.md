# Plantillas de WhatsApp para DowntimeOS

Meta exige una plantilla aprobada para mensajes iniciados por la empresa fuera
de la ventana de conversación de 24 horas. Crea estas plantillas en WhatsApp
Manager, con categoría **Utilidad**. En las cuatro plantillas selecciona
**Texto** como tipo de variable (no Número): aunque algunos valores parezcan
numéricos, el sistema envía frases completas, folios y descripciones.
Conserva exactamente el idioma, orden y cantidad de variables indicados.

## 1. Resumen para Brigada

- Nombre: `downtimeos_alerta_paros`
- Idioma: `Spanish (MEX)` (`es_MX`)
- Cuerpo:

```text
ALERTA DE OPERACIÓN
{{1}}
Cuellos de botella: {{2}}

{{3}}

Atender primero los P1 y registrar el inicio de atención.
```

`{{1}}` contiene el número de paros; `{{2}}`, el número de cuellos de botella;
`{{3}}`, todos los paros activos ordenados por prioridad.

## 2. Alerta individual de activo

- Nombre: `downtimeos_alerta_activo`
- Idioma: `English (US)` (`en_US`)
- Cuerpo:

```text
PARO NO PROGRAMADO
Activo: {{1}}
Línea: {{2}}
Tiempo detenido: {{3}}
Causa: {{4}}
Prioridad: {{5}}
```

## 3. Reporte ejecutivo PDF

- Nombre: `downtimeos_reporte_ejecutivo`
- Idioma: `English (US)` (`en_US`)
- Encabezado: **Documento**.
- Cuerpo:

```text
REPORTE EJECUTIVO - DowntimeOS
{{1}}
```

El sistema adjunta el PDF firmado en el encabezado y entrega el texto de
acompañamiento en `{{1}}`.

## 4. Validación de paro

- Nombre: `downtimeos_validacion_paro`
- Idioma: `English (US)` (`en_US`)
- Cuerpo:

```text
VALIDACIÓN DE PARO REQUERIDA
Activo: {{1}}
Línea: {{2}}
Causa: {{3}}
Impacto estimado: {{4}}
Folio: {{5}}

¿Cómo deseas registrar esta solicitud?
```

Puede conservar los botones rápidos estáticos **Aprobar** y **Rechazar**. La
persona responsable también puede responder con `aprobar FOLIO` o `rechazar
FOLIO`; el webhook valida el folio y actualiza la solicitud. No agregues
variables a los botones.

## Variables del servidor Next.js

Una vez aprobadas, agrega o verifica estas variables en el entorno del servidor:

```ini
WHATSAPP_PROVIDER=meta
META_WHATSAPP_TEMPLATE_LANGUAGE=es_MX
META_WHATSAPP_TEMPLATE_PAROS=downtimeos_alerta_paros
META_WHATSAPP_TEMPLATE_PAROS_LANGUAGE=es_MX
META_WHATSAPP_TEMPLATE_ALERTA_ACTIVO=downtimeos_alerta_activo
META_WHATSAPP_TEMPLATE_ALERTA_ACTIVO_LANGUAGE=en_US
META_WHATSAPP_TEMPLATE_REPORTE=downtimeos_reporte_ejecutivo
META_WHATSAPP_TEMPLATE_REPORTE_LANGUAGE=en_US
META_WHATSAPP_TEMPLATE_APROBACION=downtimeos_validacion_paro
META_WHATSAPP_TEMPLATE_APROBACION_LANGUAGE=en_US
```

Configura el callback de Meta como
`https://downtimeos.tech/api/whatsapp/alerta`, registra el mismo valor privado
en `META_WHATSAPP_VERIFY_TOKEN`, y suscribe los campos `messages` y
`message_template_status_update`. La aplicación guarda inicialmente `queued`;
los webhooks posteriores la cambian a `sent`, `delivered`, `read` o `failed`.
