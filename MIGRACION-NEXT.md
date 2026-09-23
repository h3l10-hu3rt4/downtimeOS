# Migración de DowntimeOS a Next.js + Docker

La aplicación ya tiene un runtime Next.js local. Las pantallas HTML existentes se conservan como fuente visual durante la migración para que la interfaz no cambie; las rutas limpias `/demo/operaciones`, `/demo/operador`, `/demo/direccion` y `/administracion` ya son páginas de Next que renderizan esa fuente y cargan sus scripts dentro del runtime de Next.

## Comandos locales

```powershell
npm install
npm run dev
npm test
npm run build
npm start
```

`npm start` sirve el artefacto standalone generado por el build:

```powershell
node .next/standalone/server.js
```

## Docker / DigitalOcean

El `Dockerfile` usa Node 22 multi-stage y genera el artefacto `standalone`. En el droplet se configura el archivo de variables del entorno, se construye la imagen y se expone el puerto 3000 detrás del proxy TLS del droplet.

```powershell
docker compose build
docker compose up -d
```

No se ejecuta ningún despliegue desde este repositorio. El despliegue a DigitalOcean queda como una operación posterior y explícita.

## WhatsApp

Las plantillas se envían solo si `WHATSAPP_META_USE_TEMPLATES=true`. Cada plantilla puede tener su idioma propio:

- `META_WHATSAPP_TEMPLATE_PAROS_LANGUAGE=es_MX`
- `META_WHATSAPP_TEMPLATE_ALERTA_ACTIVO_LANGUAGE=en_US`
- `META_WHATSAPP_TEMPLATE_REPORTE_LANGUAGE=en_US`
- `META_WHATSAPP_TEMPLATE_APROBACION_LANGUAGE=en_US`

Esto evita el error de Meta que ocurre cuando el nombre existe pero se solicita con el código de idioma equivocado. Los destinatarios numerados de operaciones y finanzas siguen siendo independientes y se mandan a todos los valores configurados.

La plantilla de validación no agrega botones que no estén definidos en Meta. La
brigada puede responder desde WhatsApp con `aprobar FOLIO` o `rechazar FOLIO`;
el webhook valida la respuesta y resuelve la solicitud en Supabase.
