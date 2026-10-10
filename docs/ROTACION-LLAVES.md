# Rotación de llaves (HIST-11)

Las llaves reales se compartieron por chat, así que hay que darlas por
expuestas: se generan nuevas, se **revocan las anteriores** y se actualizan
donde se usan. Cambiar el valor en `.env.local` sin revocar la anterior en el
proveedor no sirve.

La rotación la hace el owner en el panel de cada proveedor. Las llaves no se
pegan en el chat ni en archivos del repo.

## Estado al 2026-10-06

- **Historial de git limpio:** se revisaron los 276 commits de todas las ramas
  locales buscando llaves de Anthropic, Gemini, Meta, Twilio, Supabase, Resend,
  JWT y llaves privadas: cero coincidencias. No hace falta reescribir historial.
- **Todas las llaves siguen vivas:** `node scripts/verificar-llaves.mjs` confirmó
  que Supabase (servidor y pública), Anthropic, Gemini, Twilio y Meta aceptan
  las llaves actuales de `.env.local`. Ninguna se ha rotado todavía.
- **Copia vieja con llave viva:** `.env.local.antes-de-kekas` contiene la misma
  llave de servidor de Supabase que `.env.local`. Borrarlo al terminar.
- Dónde hay copias: `.env.local`, `.env.local.antes-de-kekas` y las variables
  del proyecto histórico de Vercel `try1` (ver HIST-10). No agregues ni rotes
  secretos allí para publicar el MVP. Azure Container Apps todavía no está
  aprovisionado; cuando la suscripción se autorice, configura allí las llaves
  nuevas y revoca las anteriores desde cada proveedor.
- Las llaves de `supabase/.temp/` son del Supabase Local de esta PC: no se rotan.

## Antes de empezar

Guardar una copia para que el verificador pueda comprobar que las anteriores
quedaron revocadas (el archivo queda ignorado por git por la regla `.env*`):

```bash
cp .env.local .env.local.antes-de-rotar
```

Para generar secretos propios (contraseña de administración, `CRON_SECRET`,
token de verificación de Meta):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

## Qué rotar y cómo

Orden sugerido: primero lo que da más acceso. Los nombres de los menús pueden
variar un poco según la versión de cada panel.

| # | Llave (variable) | Dónde se rota | Efecto al rotar |
| :- | :--- | :--- | :--- |
| 1 | Supabase, llave de servidor (`SUPABASE_SERVICE_ROLE_KEY`) | Panel de Supabase → Project Settings → API Keys | Ver nota abajo |
| 2 | Contraseña de administración (`DASHBOARD_ADMIN_PASSWORD`) | Se genera en la PC; no hay panel | Cierra las sesiones abiertas de `/administracion` |
| 3 | Anthropic (`ANTHROPIC_API_KEY`) | console.anthropic.com → API Keys: crear una nueva y borrar la anterior | Ninguno si se actualiza el entorno |
| 4 | Gemini (`GEMINI_API_KEY`) | Google AI Studio → API keys: crear una nueva y borrar la anterior | Ninguno si se actualiza el entorno |
| 5 | Twilio (`TWILIO_AUTH_TOKEN`) | Consola de Twilio → Account → API keys & tokens: crear token secundario y promoverlo a primario | El token anterior deja de servir al promover |
| 6 | Meta WhatsApp (`META_WHATSAPP_ACCESS_TOKEN`) | Meta Business → Usuarios del sistema: generar token nuevo y revocar el anterior | Los envíos fallan hasta actualizar el entorno |
| 7 | Meta, verificación y firma del webhook (`META_WHATSAPP_VERIFY_TOKEN`, `META_WHATSAPP_WEBHOOK_SECRET` / `META_WHATSAPP_APP_SECRET`) | Token de verificación: se genera en la PC y se vuelve a registrar en el webhook de la app de Meta. Secreto de la app: Configuración → Básica → restablecer | El webhook rechaza eventos hasta que ambos lados coincidan |

**Nota de Supabase.** La llave actual es del tipo JWT heredado (`service_role`).
Hay dos caminos:

- **Recomendado:** crear las llaves nuevas (`sb_secret_…` y `sb_publishable_…`),
  ponerlas en `SUPABASE_SECRET_KEY` y `SUPABASE_PUBLISHABLE_KEY` /
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, quitar `SUPABASE_SERVICE_ROLE_KEY` y después
  **desactivar las llaves heredadas** en el panel. El código ya prefiere
  `SUPABASE_SECRET_KEY` (`lib/supabase.js`). No cierra la sesión de nadie.
- Alternativa: rotar el secreto JWT del proyecto. Cambia a la vez la llave de
  servidor y la pública y cierra la sesión de todos los usuarios.

La llave pública (anon/publishable) no es secreta: viaja al navegador. Solo
cambia si se sigue uno de los dos caminos anteriores.

## Dónde actualizar los valores nuevos

1. `.env.local` de cada PC de desarrollo (owner y Kekas, por un canal seguro,
   no por chat).
2. Si las llaves se mantienen para el sitio histórico `try1`, rotarlas allí es
   una decisión separada; no desplegar ni actualizar ese proyecto por el MVP.
3. Cuando Azure esté autorizado: guardar llaves nuevas en Azure Container Apps
   Secrets, usar Supabase exclusivo de staging y una cuenta admin propia. No
   copiar las llaves de desarrollo/local o producción a staging.

La app local en Docker no usa estas llaves salvo que se levante con
`-WhatsAppDesdeEnvLocal`, `-IADesdeEnvLocal` o `-AdminDesdeEnvLocal`.

## Comprobar

```bash
node scripts/verificar-llaves.mjs --anteriores .env.local.antes-de-rotar
```

Debe dar todo `PASS`: cada llave nueva es aceptada por su proveedor, cada valor
cambió y cada llave anterior ya es rechazada. El script solo hace consultas de
lectura (no envía WhatsApp ni gasta créditos de IA) y nunca imprime valores.

Al terminar, borrar las copias con llaves viejas:

```bash
rm .env.local.antes-de-rotar .env.local.antes-de-kekas
```

Y registrar la fecha en `docs/BACKLOG.md` (HIST-11).

## Para que no vuelva a pasar

- Las llaves se comparten por un gestor de contraseñas o un canal de un solo
  uso, nunca por chat ni por correo.
- `.env*` está en `.gitignore` y `.dockerignore`; solo `.env.example` (sin
  valores) se sube.
- Si una llave se pega por error en un chat o en un commit, se rota ese mismo día.
