-- Defensa adicional para accesos futuros con la clave anónima. Los Route
-- Handlers usan service_role y ya verifican el perfil; RLS evita que un JWT
-- autenticado pueda leer por accidente filas de una planta distinta.
do $$
declare
  tabla text;
begin
  foreach tabla in array array[
    'planta_lineas', 'planta_activos', 'planta_estados', 'planta_eventos',
    'planta_solicitudes', 'planta_cancelaciones', 'planta_analisis_ia',
    'planta_reportes', 'planta_mensajes'
  ] loop
    execute format('alter table public.%I enable row level security', tabla);
    execute format('drop policy if exists "perfil lee su planta" on public.%I', tabla);
    execute format(
      'create policy "perfil lee su planta" on public.%I for select to authenticated using (planta_id in (select planta_id from public.planta_perfiles where user_id = auth.uid() and activo))',
      tabla
    );
  end loop;
end $$;
