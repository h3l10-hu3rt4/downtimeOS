# DowntimeOS — guía para Claude Code

Rama de trabajo: `Angel_Dev`. App Next.js 15 + React 19 + Supabase Auth, multiempresa, en Docker.
Destino de despliegue: DigitalOcean (no Vercel). Idioma del equipo: español.

## Cómo trabajar (ahorrar tokens)
- Una historia de `docs/BACKLOG.md` por sesión. Pedir "toma la HIST-NN" y no releer documentos enteros.
- Detalle técnico en `docs/HANDOFF.md`: leer solo la sección que toque (índice con `grep "^## "`).
- Hecho = pruebas en verde (`npm test`) + commit. Push solo si el usuario lo pide. Nunca desplegar sin pedirlo.
- Evitar capturas de pantalla del navegador si basta con leer texto o consultar el DOM.

## Comandos
- `npm install` · `npm test` (node --test) · `npm run build`
- Local aislado: `.\scripts\supabase-local.ps1 start`, luego `npm run docker:local`; estado: `npm run docker:status`.
- `npm run smoke` y `npm run qa:ui:public` para verificación.
- QA manual por API con la sesión real de cada rol: `node scripts/qa/aislamiento.mjs` (seguro) y `limites.mjs`/`ciclo.mjs` (modifican datos); ver `scripts/qa/README.md`.
- E2E del MVP: `.\scripts\e2e-mvp-local.ps1 -SupabaseWorkdir . -ConfirmDisposableDatabase`. Ver "E2E" abajo.

## Entorno Windows (problemas ya vistos)
- Ejecutar siempre los comandos de Supabase/npm **desde la raíz del repo**. `--workdir .` en otra carpeta (p. ej. `C:\WINDOWS\system32`) apunta al proyecto equivocado y `stop` no apaga nada.
- Para correr scripts `.ps1` desde Bash/otra shell: `powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/X.ps1`. Redirigir salida a un archivo si la CLI imprime llaves.
- Supabase Local usa los puertos 54321-54324. Windows los reparte al azar a conexiones salientes (Edge ya ocupó el 54322 y `supabase start` falló con "ports are not available"). Están reservados con `netsh int ipv4 add excludedportrange protocol=tcp startport=54321 numberofports=4` (admin, una vez por PC; verificar con `netsh int ipv4 show excludedportrange protocol=tcp`). Si falla de nuevo: apagar con `npx supabase stop --workdir .` (sin `--no-backup`), identificar quién tiene el puerto con `Get-NetTCPConnection -LocalPort N` y reintentar.
- `core.autocrlf=true`: los archivos quedan con CRLF. Los tests que leen código fuente con regex deben normalizar `\r\n`.
- `next` debe estar instalado en el host (`npm install`) para el E2E; la imagen Docker lo trae aparte y no basta.

## E2E (`e2e-mvp-local`)
- Exige base **vacía** y desechable; crea cuentas y datos y no los borra. Una segunda corrida necesita otra base vacía.
- Levanta su propia instancia de Next en :3001 (la app Docker queda en :3000) y vacía las llaves de WhatsApp, IA y correo externo.
- Antes de correrlo comprobar Mailpit y datos previos; si la base no está vacía, pedir al usuario que la reinicie (ver "No hacer").
- Los correos de Auth están en español (`supabase/config.toml`); si se cambian asuntos, actualizar los patrones de `confirmFromEmail` en `scripts/e2e-mvp-local.mjs`.
- Un fallo no se resuelve repitiendo: leer primero el log de Next (`%TEMP%\downtimeos-e2e-<pid>.err.log`) y diagnosticar antes de gastar otra base.

## No hacer
- No usar `npm run dev` directo: `.env.local` apunta al Supabase en la nube.
- No `docker compose down -v`, `supabase db reset`, `supabase stop --no-backup` ni `prune`: borran datos locales. Si hace falta una base vacía (p. ej. para el E2E), preguntar antes qué datos locales hay que conservar y pedir al usuario que corra el reset él mismo: el entorno de Claude Code bloquea estos comandos aunque el usuario los autorice por chat.
- No subir `.env*` ni pegar llaves en el chat o en archivos del repo.
- WhatsApp (`-WhatsAppDesdeEnvLocal`) puede mandar mensajes reales; IA (`-IADesdeEnvLocal`) consume créditos.

## Invariantes (detalle en docs/HANDOFF.md §7, §14.2, §15.4)
- El cliente nunca decide cifras financieras: el servidor las recalcula.
- La fórmula está espejada en varios archivos; si cambias una, revisa las demás (HANDOFF §7).
- El operador (personal de piso) nunca ve dinero. Operaciones, Finanzas y Dirección sí lo ven (decisión del owner, 2026-10-06).
- El cronómetro de un paro corre desde que lo reporta el operador, no desde que Mantenimiento lo valida.
- Un rechazo de solicitud deshace el paro (máquina a RUN, sin evento ni costo); lo aplica el servidor.
- Cascada del mapa: paro total de una etapa = rojo; lo funcional aguas abajo = gris "A la espera"; un paro propio conserva su color.

## Pruebas manuales con el navegador integrado
- La app en :3000 usa Supabase Local; el panel `/administracion` necesita un admin de prueba propio: levantar con `DOWNTIMEOS_LOCAL_DASHBOARD_ADMIN_EMAIL`/`_PASSWORD` definidos y `powershell -File scripts/docker-local.ps1` (NO `npm run docker:local`, que lee el admin real de `.env.local`).
- Credenciales de prueba generadas: guardarlas en `.env.hist03.local` (ignorado por git); no imprimirlas en el chat ni en el repo.
- Los formularios React ignoran `.value=`: usar el setter nativo y disparar `input`/`change` (ver ejemplos en el historial de HIST-03..08), o `form_input`.
- Los tableros se redibujan cada pocos segundos: las referencias (`ref_N`) caducan; clics por DOM (`.click()`) dentro de la misma llamada JS son más fiables. Las acciones del panel admin usan `window.confirm`: sobrescribirlo a `() => true` solo en esa página.
- Para comprobar permisos y aislamiento es más fiable una prueba por API con la sesión real de cada rol (Auth `grant_type=password` + `x-downtimeos-planta`) que mirar pantallas: las páginas responden 200 y la restricción se aplica en el cliente.
- Los planes limitan equipos y plantas, **no usuarios** (por ahora). Starter no incluye IA ni PDF mensual. Mejora inmediata (HIST-15): pedir un plan superior al vigente se paga completo, sin prorrateo, y al validarlo el admin reemplaza al plan actual (estado `reemplazada`); QA con `node scripts/qa/mejora.mjs`.
- Dejar una empresa de prueba "vencida" o con datos de E2E no estorba, pero cada E2E automático exige base vacía: avisar antes de resetear.
- Espacio en C:: con menos de ~10 GB libres Docker Desktop puede caerse (`containerd: bus error`). Revisar el espacio antes de reconstruir imágenes. Si Docker cae durante un build, la imagen puede quedar dañada (`ERR_INVALID_PACKAGE_CONFIG`): reconstruirla con `DOWNTIMEOS_LOCAL_SUPABASE_PUBLISHABLE_KEY=x DOWNTIMEOS_LOCAL_SUPABASE_SECRET_KEY=x docker compose build --no-cache downtimeos` (valores ficticios solo para el build) y luego `scripts/docker-local.ps1`.
- Tras una caída de Docker, si Windows no alcanza `localhost:54321` (respuesta vacía) o la app no alcanza `host.docker.internal`: `npx supabase stop --workdir .` (sin `--no-backup`) y `supabase-local.ps1 start`. Los datos se conservan.
- El análisis de IA y el PDF solo se generan con plan Pro/Enterprise, y recargar `/direccion` ya dispara un análisis (consume tokens): no recargar en bucle con `-IADesdeEnvLocal`.
