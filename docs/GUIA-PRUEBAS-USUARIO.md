# Guía rápida para probar DowntimeOS en local

Esta guía es para probar el MVP en una computadora con Docker Desktop. Los
correos se abren en Mailpit; **no llegan a Gmail ni Outlook**. La base local
guarda lo que registres y no debe usarse con datos reales de producción.

## 1. Levantar la aplicación

1. Abre Docker Desktop y espera a que indique que está listo.
2. Abre PowerShell en la carpeta del proyecto:

   ```powershell
   cd C:\Users\PC\Documents\HELIO\downtimeOS
   ```

3. Inicia Supabase local. Si ya está iniciado, puedes dejarlo como está:

   ```powershell
   npx supabase start
   ```

4. Si acabas de bajar cambios nuevos o se agregó una migración, aplica el
   esquema local actualizado:

   ```powershell
   npx supabase migration up --local
   ```

5. Construye y levanta la aplicación:

   ```powershell
   npm run docker:local
   ```

Cuando Docker muestre el contenedor `downtimeos-downtimeos-1` como saludable,
abre:

- Aplicación: [http://localhost:3000](http://localhost:3000)
- Correos de prueba: [http://localhost:54324](http://localhost:54324)

Supabase aparece como varios contenedores (Auth, base de datos, correo, API,
etc.); es normal. Solo hay un contenedor de la aplicación.

## 2. Crear una planta y probar el equipo

1. Entra a **Crea la cuenta de tu planta** y registra una empresa de prueba.
2. Abre Mailpit, localiza el mensaje dirigido a ese correo y pulsa el enlace de
   confirmación. Vuelve a la pestaña de DowntimeOS para continuar.
3. Configura la primera planta con una línea, máquinas, etapas y costos de
   prueba. No se agregan datos de producción automáticamente.
4. En **Equipo**, invita personas con los roles de Dirección, Finanzas,
   Operaciones u Operador. Cada invitación también aparece en Mailpit; ábrela
   y completa la contraseña para aceptar.
5. Prueba que cada persona pueda entrar a las pantallas de su rol. Dirección y
   Finanzas ven información financiera; Operaciones y Operador trabajan con
   paros y solicitudes según sus permisos.

## 3. Probar tableros con un piloto

Los tableros requieren una suscripción activa o un piloto. Para probar sin
cobrar ni transferir dinero:

1. Desde la cuenta de planta, abre **Suscripción** y envía una solicitud. Los
   periodos disponibles son semestral y anual; no hay plan mensual.
2. Entra a **Administración** (`/administracion/acceso`) con la cuenta
   administrativa local configurada para esta instalación.
3. En **Solicitudes de suscripción**, concede un piloto de 14 días a la cuenta
   de prueba. No uses una referencia de pago real ni hagas una transferencia
   para este ejercicio.
4. Vuelve a la cuenta de planta y prueba Dirección (`/direccion`), Operaciones
   (`/operaciones`) y Operador (`/operador`). Registra un paro de prueba,
   resuélvelo y confirma que los tableros reflejen el cambio.

La cuenta administrativa se configura localmente con `DASHBOARD_ADMIN_EMAIL` y
`DASHBOARD_ADMIN_PASSWORD` en `.env.local`. Si cambias esos valores, vuelve a
ejecutar `npm run docker:local`. **No compartas ni subas `.env.local` al
repositorio.**

## Si algo no abre

- Revisa que Docker Desktop siga activo y que la aplicación esté en
  `http://localhost:3000`.
- Si no llega el correo, revisa `http://localhost:54324`; en local no aparecerá
  en la bandeja personal.
- Si acabas de actualizar el proyecto, ejecuta primero
  `npx supabase migration up --local` y después `npm run docker:local`.
- No uses `docker compose down -v` ni `supabase stop --no-backup`: borrarían los
  datos de prueba guardados en la base local.
