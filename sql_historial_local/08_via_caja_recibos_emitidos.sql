begin;

-- ============================================================
-- FIX: en contratos con más de un propietario, no había forma de
-- distinguir en 'recibos_propietario_emitidos' una emisión REAL
-- (pendiente de girar por Caja) de un cobro "directo al propietario"
-- (el inquilino le pagó directo a ESE propietario — no hay nada que
-- girar). Las dos cosas se anotaban igual, así que "Recibos
-- Propietarios > Ya emitidos" no podía filtrar los cobros directos y
-- los mostraba como pendientes de pago (caso real: Bertolino-Rodríguez).
--
-- Esta columna nueva marca esa diferencia. Default true porque las
-- filas que ya existen en la tabla son, hasta ahora, siempre
-- emisiones reales (la función para marcar un cobro directo en un
-- contrato multi-propietario recién se agregó en esta sesión).
-- ============================================================
alter table public.recibos_propietario_emitidos
  add column if not exists via_caja boolean not null default true;

commit;
