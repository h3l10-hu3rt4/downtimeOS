# Scripts de QA manual (Supabase Local)

Pruebas por API con la **sesión real de cada rol** (Auth `grant_type=password` + encabezado `x-downtimeos-planta`). Son más fiables que mirar pantallas: las páginas responden 200 y la restricción visual se aplica en el cliente; lo que protege los datos es la API.

Todos leen las credenciales de `.env.hist03.local` (ignorado por git, nunca se sube) y las llaves de `npx supabase status`. **Ninguno imprime tokens ni llaves.** Solo para la base **local y desechable**.

| Script | Historia | ¿Modifica datos? | Qué comprueba |
| :--- | :--- | :--- | :--- |
| `aislamiento.mjs` | HIST-05 | No (los intentos de escritura deben fallar) | Dos empresas no ven ni tocan datos de la otra: API con la planta ajena, PostgREST de las 14 tablas `planta_*`, escrituras cruzadas y anónimo. |
| `limites.mjs` | HIST-05 | Sí: crea y archiva M-05/M-06/M-07 | Starter: el 6.º equipo da 409 `PLAN_ASSET_LIMIT`, segunda planta 403; sin plan: 402. Exige empresa A con **Starter activo** y B sin plan. |
| `ciclo.mjs` | HIST-08 | **Sí: cancela y vence el plan de A** | Exportación (roles y auditoría), cancelación al fin del periodo y vencimiento (bloquea paros nuevos, deja cerrar el abierto, exportación sigue). Exige empresa A con plan activo. |

Uso (desde la raíz del repo, con Supabase Local y la app en :3000):

```bash
node scripts/qa/aislamiento.mjs
```

Las plantas se resuelven por nombre (`Planta Norte` = A, `Planta Sur` = B); se pueden forzar con `PLANTA_A` y `PLANTA_B`.

Los usuarios de prueba y sus contraseñas se generaron para HIST-03 a HIST-08; si la base se reinicia hay que recrearlos (ver `docs/BACKLOG.md`).
