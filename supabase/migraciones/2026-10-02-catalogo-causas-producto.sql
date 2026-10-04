-- El catálogo operacional no depende de datos demo/semilla. Debe existir
-- también en instalaciones creadas aplicando únicamente migraciones.
begin;

insert into public.planta_causas(id,etiqueta,requiere_texto,orden) values
  ('ruptura-herramental','Ruptura de herramental',false,1),
  ('espera-material','Espera de material',false,2),
  ('cambio-modelo','Cambio de modelo sin SMED',false,3),
  ('ajuste-calidad','Ajuste de calidad / calibración',false,4),
  ('falla-electrica','Falla eléctrica menor',false,5),
  ('falta-operador','Falta de operador',false,6),
  ('otros','Otros (especificar)',true,7)
on conflict(id) do update set
  etiqueta=excluded.etiqueta,
  requiere_texto=excluded.requiere_texto,
  orden=excluded.orden;

commit;
