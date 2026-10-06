# Backlog

Owner: Helio Huerta · Dirección técnica: Kekas · Rama: `Angel_Dev`

Cómo usarlo: una historia por sesión de Claude Code. Estados: `Por hacer` · `En curso` · `Hecho`.
Una historia está hecha cuando cumple sus criterios y queda registrado el resultado (qué pasó, qué falló).

## Sprint actual: validar el MVP de punta a punta en local (pedido de Kekas)
Todo se prueba en Docker + Supabase Local, nunca contra producción. Guía manual: `docs/GUIA-PRUEBAS-USUARIO.md`.

| ID | Historia (punto de Kekas) | Estado |
| :--- | :--- | :--- |
| HIST-01 | Entorno local listo (requisito de todo lo demás) | Hecho |
| HIST-02 | E2E automático en base desechable | Por hacer |
| HIST-03 | Registro, primera planta y configuración (puntos 1 y 2) | Por hacer |
| HIST-04 | Roles y permisos con cuatro usuarios (punto 3) | Por hacer |
| HIST-05 | Aislamiento entre empresas y límites del plan (puntos 4 y 5) | Por hacer |
| HIST-06 | Paro en piso, reportes y notificaciones (punto 6) | Por hacer |
| HIST-07 | Suscripción corporativa con comprobante (punto 7) | Por hacer |
| HIST-08 | Vencimiento, cancelación y exportación de datos (punto 8) | Por hacer |

## Siguientes
| ID | Historia | Estado |
| :--- | :--- | :--- |
| HIST-09 | Aprobar/rechazar por WhatsApp con firma de Meta | Por hacer |
| HIST-10 | Revisar la brecha del despliegue de Vercel | Por hacer |
| HIST-11 | Rotar llaves compartidas por chat | Por hacer |
| HIST-12 | Alinear docs de la demo con la cascada gris | Por hacer |
| HIST-13 | Correo externo (SMTP/Resend) | Por hacer |
| HIST-14 | Staging para testers desde otras PCs | Por hacer |

## Detalle del sprint

### HIST-01 · Entorno local listo
- WSL2 y Docker Desktop funcionando. Hecho el 2026-10-06.
- `npm install`, Supabase Local arriba y `npx supabase migration list --local --workdir .` sin diferencias.
- `npm run docker:local` deja la app en http://localhost:3000 y `npm run docker:status` la marca saludable.
- Mailpit abre en http://localhost:54324.

**Resultado (2026-10-06):** todo verde. 52 migraciones sin diferencias, app saludable en :3000, Mailpit responde, `npm test` 488/488.
Hallazgos corregidos: (1) `scripts/supabase-local.ps1` fallaba en PowerShell 5.1 porque el stderr de la CLI se volvía error fatal; (2) `test/estructura-archivo-sin-plan.test.js` fallaba con CRLF (autocrlf). Nota: si Edge u otro proceso ocupa el puerto 54322, `supabase start` falla con "ports are not available"; cerrar el proceso y reintentar.

### HIST-02 · E2E automático
Correr primero, en una base nueva: crea datos y no los borra, y el preflight falla si la base no está vacía.
- `.\scripts\e2e-mvp-local.ps1 -SupabaseWorkdir . -ConfirmDisposableDatabase`.
- Anotar qué suites pasan y leer las líneas `NO EJECUTADO` (correo y aprobación administrativa pueden omitirse).
- Una segunda corrida exige otra base desechable.

### HIST-03 · Registro, primera planta y configuración
- Registrar una empresa y su primera planta; el flujo lleva directo al asistente de configuración, sin pasos intermedios.
- Dato de Kekas: el asistente está en http://localhost:3000/configurar-planta y el correo de verificación llega ahí al poner el correo (en local, a Mailpit).
- Dar de alta líneas, etapas y máquinas reales con su costo/hora; verificar que el cálculo de pérdidas usa esos costos.

### HIST-04 · Roles y permisos
- Invitar a Dirección, Finanzas, Operaciones y Operador (correos en Mailpit) y entrar con cada uno.
- Registrar para cada rol qué pantallas y acciones ve y cuáles se le bloquean; el Operador no ve dinero.

### HIST-05 · Aislamiento y límites del plan
- Crear dos empresas y comprobar que ninguna ve datos, eventos, máquinas ni reportes de la otra (también por URL directa y por API).
- Verificar que los límites del plan activo (plantas, usuarios, etc.) se aplican.

### HIST-06 · Paro, reportes y notificaciones
- Registrar un paro como Operador, validarlo como Operaciones y cerrarlo; revisar costos y mapa.
- Generar el reporte PDF con IA (requiere `-IADesdeEnvLocal`; consume créditos).
- Confirmar notificaciones por WhatsApp (requiere `-WhatsAppDesdeEnvLocal`; envía mensajes reales a los números configurados).

### HIST-07 · Suscripción corporativa
- Solicitar un plan, adjuntar orden de compra o comprobante y activarlo manualmente desde `/administracion`.

### HIST-08 · Vencimiento, cancelación y exportación
- Vencimiento: un plan vencido bloquea nuevos paros pero deja cerrar el abierto.
- Cancelación: se programa al fin del periodo pagado y no corta el acceso antes.
- Exportación de datos: no encuentro nada que la implemente en el repo ni en las docs. Confirmar con Kekas si debe existir; si falta, crear una historia propia.

## Detalle de los siguientes

### HIST-09 · WhatsApp con firma de Meta
- Obtener `META_WHATSAPP_APP_SECRET` de Kekas (falta en su `.env.local`); sin ella el webhook rechaza los mensajes.
- Un rechazo con firma válida deshace el paro; con firma inválida o ausente responde 403.

### HIST-10 · Brecha del despliegue de Vercel
- Leer los commits "clarify live deployment security gap" y "confirm active Vercel deployment root cause".
- Decidir: apagar, proteger o retirar el despliegue. No desplegar nada sin autorización.

### HIST-11 · Rotar llaves
- Rotar: Supabase service role, Anthropic, Gemini, Twilio, token de Meta y contraseña de administración.
- Actualizar `.env.local` y los secretos del entorno de despliegue.

### HIST-12 · Docs de la demo
- README y HANDOFF §15.7 dicen que lo de aguas abajo pasa a rojo; la regla vigente es gris "A la espera".

### HIST-13 y HIST-14
- Correo externo: verificar dominio/remitente, configurar SMTP de Supabase Auth y probar confirmación, invitación y recuperación.
- Staging: entorno aislado con acceso y correo de prueba; no exponer el Docker local ni los puertos de Supabase.
