# Plantillas de WhatsApp para DowntimeOS

Meta exige una plantilla aprobada para mensajes iniciados por la empresa fuera
de la ventana de conversación de 24 horas. Crea estas plantillas en WhatsApp
Manager con categoría **Utilidad** y conserva exactamente el orden de variables
y botones indicado. Usa el idioma aprobado en cada plantilla; en el WABA local,
`downtimeos_alerta_paros` está en `es_MX` y las otras tres en `en`.

## 1. Resumen para Brigada

- Nombre: `downtimeos_alerta_paros`
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

- Botón de respuesta rápida 1: **Aprobar**.
- Botón de respuesta rápida 2: **Rechazar**.

No agregues ni cambies el orden de los botones: DowntimeOS les asigna los
payloads necesarios para resolver la solicitud recibida.

Por seguridad, una respuesta interactiva solo se aplica cuando el número
remitente de Meta coincide con un contacto personal verificado, con opt-in y
membresía activa de Operaciones en la misma planta. Cada persona registra su
propio número en **Mi WhatsApp**; para probar la titularidad, abre el enlace
prellenado desde ese teléfono y envía el desafío al WhatsApp oficial. El desafío
expira en 10 minutos, se guarda solo como hash y el webhook valida la firma de
Meta, el número remitente y la membresía. El sistema envía alertas a todos los
contactos verificados de Operaciones y reportes ejecutivos a todos los de
Dirección/Finanzas; no hay destinatarios globales ni números introducidos al
momento del envío.

## Variables para el host de producción (solo si se aprueba activar WhatsApp)

Las plantillas aprobadas deben configurarse en el almacén de secretos del entorno productivo, nunca en Git ni dentro de la imagen Docker.
cuando la suscripción esté activa. Esta guía no autoriza el despliegue ni la
activación. WhatsApp debe permanecer apagado hasta que el owner acuerde probar
mensajes reales y valide destinatarios y costos:

```ini
WHATSAPP_PROVIDER=meta
META_WHATSAPP_TEMPLATE_LANGUAGE=es_MX
META_WHATSAPP_TEMPLATE_PAROS=downtimeos_alerta_paros
META_WHATSAPP_TEMPLATE_ALERTA_ACTIVO=downtimeos_alerta_activo
META_WHATSAPP_TEMPLATE_REPORTE=downtimeos_reporte_ejecutivo
META_WHATSAPP_TEMPLATE_APROBACION=downtimeos_validacion_paro
META_WHATSAPP_TEMPLATE_REPORTE_LANGUAGE=en
META_WHATSAPP_TEMPLATE_APROBACION_LANGUAGE=en
META_WHATSAPP_TEMPLATE_ALERTA_ACTIVO_LANGUAGE=en
META_WHATSAPP_TEMPLATE_PAROS_LANGUAGE=es_MX
```

El idioma debe coincidir exactamente con la versión aprobada en Meta. La
plantilla `downtimeos_reporte_ejecutivo` usa encabezado multimedia de tipo
`Documento`; el PDF de ejemplo se carga en Business Manager para revisión y el
PDF real se envía mediante la URL firmada del reporte.

Configura el callback de Meta como
`https://downtimeos.tech/api/whatsapp/alerta`. El **Verify token** que escribes
en el administrador debe coincidir con `META_WHATSAPP_VERIFY_TOKEN`; es una
cadena que eliges tú. Además, configura el **App Secret** de la aplicación de
Meta en `META_WHATSAPP_APP_SECRET`: es distinto del Verify token y se usa para
validar la firma HMAC `X-Hub-Signature-256` en cada callback. Suscribe los
campos `messages` y `message_template_status_update`. La aplicación guarda inicialmente `queued`;
los webhooks posteriores la cambian a `sent`, `delivered`, `read` o `failed`.
