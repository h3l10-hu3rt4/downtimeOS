# Staging para testers (HIST-14)

Entorno para que personas en **otras PCs** prueben DowntimeOS sin tocar
producción ni la PC de nadie. No se expone el Docker local ni los puertos de
Supabase.

## Qué es

| Pieza | Dónde vive | Expuesto a internet |
| :--- | :--- | :--- |
| App Next.js (Docker) | Droplet de DigitalOcean | Solo por HTTPS a través de Caddy (80/443) |
| Base de datos, Auth y Storage | **Proyecto de Supabase exclusivo de staging** | Solo su API HTTPS; Postgres no se publica |
| Correo de prueba (Mailpit) | El mismo droplet | Interfaz por HTTPS con contraseña; SMTP 587 con usuario, contraseña y STARTTLS |

Los correos de Auth (confirmación, invitación, recuperación) caen en el buzón de
pruebas y **no se entregan a direcciones reales**: un tester puede registrarse
con cualquier correo y leerlo en el buzón. El correo real es HIST-13.

WhatsApp e IA van **apagados** (llaves vacías): WhatsApp manda mensajes reales
y la IA consume créditos.

Archivos: `docker-compose.staging.yml`, `deploy/staging/Caddyfile`,
`deploy/staging/env.example`, `scripts/staging-check.mjs`.

## Lo que hay que conseguir antes (owner)

1. Un droplet Ubuntu (1 vCPU / 2 GB alcanza) con Docker y el plugin de Compose.
2. Dos registros DNS tipo A hacia la IP del droplet, por ejemplo
   `staging.TU_DOMINIO` y `correo-staging.TU_DOMINIO`.
3. Un proyecto nuevo de Supabase, solo para staging. No reutilizar el de
   producción ni sus llaves.

## Montaje

### 1. Supabase de staging

Desde la raíz del repo, en una PC con la CLI:

```bash
npx supabase login
```

```bash
npx supabase link --project-ref REF_DEL_PROYECTO_STAGING --workdir .
```

```bash
npx supabase db push --workdir .
```

`db push` aplica las migraciones de `supabase/migrations` (tablas, RLS, planes
y buckets). Revisar antes el `project-ref`: es el único comando de esta guía
que escribe en una base remota.

En el panel del proyecto de staging:

- **Authentication → URL Configuration:** Site URL `https://staging.TU_DOMINIO`
  y Redirect URL `https://staging.TU_DOMINIO/**`.
- **Authentication → Emails → SMTP Settings:** host `correo-staging.TU_DOMINIO`,
  puerto `587`, usuario y contraseña = `MAILPIT_SMTP_USER` / `MAILPIT_SMTP_PASSWORD`,
  remitente `staging@TU_DOMINIO`. Subir el límite de correos por hora (p. ej. 100).
- **Authentication → Emails → Templates:** pegar los asuntos y el HTML de
  `supabase/templates/` (los asuntos están en `supabase/config.toml`), para que
  los correos lleguen en español como en local.
- Confirmación de correo activada (igual que `enable_confirmations = true`).

### 2. Droplet

```bash
git clone <repositorio> downtimeos && cd downtimeos && git checkout Angel_Dev
```

```bash
cp deploy/staging/env.example .env.staging && chmod 600 .env.staging
```

Llenar `.env.staging` (dominios, llaves del proyecto de staging, admin propio,
contraseñas del buzón y `CRON_SECRET`). Nunca copiar `.env.local` al droplet.

Cortafuegos: solo SSH, web y el SMTP del buzón.

```bash
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 587/tcp && ufw enable
```

```bash
docker compose --env-file .env.staging -f docker-compose.staging.yml up -d --build
```

En el primer arranque Mailpit se reinicia unos segundos hasta que Caddy obtiene
el certificado del dominio del buzón; después queda estable. Si deja de aceptar
correos tras una renovación del certificado (cada ~60 días), reiniciarlo:

```bash
docker compose --env-file .env.staging -f docker-compose.staging.yml restart mailpit
```

Vencimientos de suscripción (opcional, una vez al día con `crontab -e`; mismo
encabezado que usa el cron de producción, ver `app/api/cron/suscripciones`):

```bash
curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://staging.TU_DOMINIO/api/cron/suscripciones
```

### 3. Comprobar desde otra PC

```bash
node scripts/staging-check.mjs https://staging.TU_DOMINIO https://correo-staging.TU_DOMINIO
```

Todo debe salir `PASS`: HTTPS, páginas públicas, API cerrada a anónimos, buzón
con contraseña y los puertos 3000, 5432, 54321-54324, 8025 y 1025 cerrados.
Después, recorrer `docs/GUIA-PRUEBAS-USUARIO.md` con una empresa de prueba:
registro → correo en el buzón → planta → invitación → paro.

## Acceso de los testers

- URL: `https://staging.TU_DOMINIO`. Cada tester registra su propia empresa; los
  datos de cada empresa están aislados (HIST-05).
- Buzón: `https://correo-staging.TU_DOMINIO` con `MAILPIT_UI_USER` /
  `MAILPIT_UI_PASSWORD`. El buzón es compartido: todos los testers ven todos los
  correos de prueba, así que no usar datos reales.
- Planes: los activa el owner desde `/administracion` con el admin del staging
  (pago simulado; ver HIST-07 y HIST-15).

## Actualizar

```bash
git pull && docker compose --env-file .env.staging -f docker-compose.staging.yml up -d --build
```

Si hay migraciones nuevas, repetir `npx supabase db push --workdir .` contra el
proyecto de staging antes de actualizar la app.

## No hacer

- No publicar el Docker local ni abrir los puertos 54321-54324 de una PC.
- No apuntar el staging al Supabase de producción, ni producción a este.
- No correr el E2E automático contra staging: exige base vacía y no borra datos.
- No llenar las llaves de WhatsApp o IA sin autorización del owner.
- No poner contraseña general (basic auth) delante de la app: la API usa el
  encabezado `Authorization` para la sesión y dejaría de funcionar.
