-- ============================================================
-- 18 — Boletas de servicios: el inquilino SOLO puede abrir archivos "boletas/…" (una boleta por archivo)
-- ============================================================
-- Contexto: las boletas de agua/TGIU/EPE se importaban desde un PDF con las boletas de MUCHOS clientes, y a cada
-- inquilino se le adjuntaba ese mismo archivo completo. Aunque el visor mostrara una sola página, el archivo entero
-- podía bajarse. Ahora cada boleta se guarda como su propio archivo de una página, en "servicios/boletas/<pago>/…".
--
-- ORDEN (importante):
--   1) Subir a producción la versión de la app que separa las boletas al importar.
--   2) En la app de gestión (admin): Mantenimiento → "Separar boletas por página" → Contar → Separar ahora.
--   3) Correr ESTE script. Si todavía queda alguna boleta sin separar, el script se detiene sin cambiar nada y
--      avisa cuántas son (así ningún inquilino se queda sin poder ver su boleta).
--
-- Efecto: se reemplaza la política de lectura del inquilino sobre el bucket "servicios": además de ser un archivo
-- de uno de SUS pagos, el archivo tiene que estar bajo "boletas/". Los PDF completos originales quedan solo para
-- el administrador. Para volver atrás: ver el final del archivo.
-- No toca datos, solo una política de acceso.

begin;

do $$
declare pendientes integer;
begin
  select count(*) into pendientes from public.pagos_pdf where pdf_path is not null and pdf_path not like 'boletas/%';
  if pendientes > 0 then
    raise exception 'Todavía hay % boleta(s) sin separar (pagos_pdf.pdf_path no empieza con "boletas/"). Separalas desde Mantenimiento → Separar boletas por página y volvé a correr este script.', pendientes;
  end if;
end $$;

drop policy if exists "inquilino lee sus boletas de servicios" on storage.objects;

create policy "inquilino lee sus boletas de servicios" on storage.objects
for select using (
  bucket_id = 'servicios'
  and storage.objects.name like 'boletas/%'
  and exists (
    select 1 from public.pagos_pdf pp
    where pp.pdf_path = storage.objects.name and public.es_mi_pago(pp.pago_id)
  )
);

commit;

-- ------------------------------------------------------------
-- Verificación (debe dar 0 filas):
--   select id, pago_id, servicio, pdf_path from public.pagos_pdf where pdf_path not like 'boletas/%';
-- Para volver atrás (el inquilino vuelve a poder abrir cualquier archivo que figure en sus pagos):
--   drop policy "inquilino lee sus boletas de servicios" on storage.objects;
--   create policy "inquilino lee sus boletas de servicios" on storage.objects
--   for select using (bucket_id = 'servicios' and exists (
--     select 1 from public.pagos_pdf pp where pp.pdf_path = storage.objects.name and public.es_mi_pago(pp.pago_id)));
-- ------------------------------------------------------------
