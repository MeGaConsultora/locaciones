-- Blindaje de saldos: cierra los huecos por donde un total o saldo guardado podría volver a desfasarse.
-- Correr a mano en el SQL Editor de Supabase, DESPUÉS de 14 y 15.
--
-- Qué agrega:
--  1. El trigger de pagos ahora se dispara ante CUALQUIER cambio de un mes (antes solo ante algunas
--     columnas). Así, si la pantalla guarda un total o saldo viejo directamente, la base lo corrige
--     en el acto con el cálculo correcto.
--  2. Triggers sobre las dos tablas de las que depende el cálculo y que antes no se vigilaban:
--     contrato_suministros (si una cuenta cambia de tipo o se borra) y contratos (si se crea, se borra
--     o cambia de nombre/hoja un contrato), que cambian qué servicios cuentan en cada mes.
--  3. recalcular_todos_los_pagos(): botón de reparación para administradores. Recalcula todos los meses
--     que hoy no coinciden y devuelve cuántos arregló.
--
-- La regla de cálculo no cambia (ver 14_control_saldos.sql y 15_totales_automaticos.sql).
-- Cada cambio queda registrado en la auditoría (13_auditoria.sql).

begin;

-- 1) El trigger de pagos: ante cualquier UPDATE. La guarda pg_trigger_depth() evita que el propio
--    recálculo (que actualiza la fila) vuelva a dispararse a sí mismo.
create or replace function public.trg_recalcular_desde_pago()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  perform public.recalcular_pago(new.id);
  return null;
exception when others then
  raise warning 'recalcular_pago (pagos %): %', new.id, sqlerrm;
  return null;
end;
$$;
revoke all on function public.trg_recalcular_desde_pago() from public, anon, authenticated;

drop trigger if exists totales_auto_pagos_upd on public.pagos;
create trigger totales_auto_pagos_upd after update on public.pagos
  for each row execute function public.trg_recalcular_desde_pago();

-- 2a) Una cuenta de servicio cambia de tipo o se borra: se recalculan los meses que la usan
create or replace function public.trg_recalcular_desde_cuenta()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in select distinct pago_id from public.pagos_suministros where suministro_id = old.id loop
    perform public.recalcular_pago(r.pago_id);
  end loop;
  return null;
exception when others then
  raise warning 'recalcular_pago (contrato_suministros): %', sqlerrm;
  return null;
end;
$$;
revoke all on function public.trg_recalcular_desde_cuenta() from public, anon, authenticated;

drop trigger if exists totales_auto_cuentas on public.contrato_suministros;
create trigger totales_auto_cuentas after update of tipo or delete on public.contrato_suministros
  for each row execute function public.trg_recalcular_desde_cuenta();

-- 2b) Un contrato se crea, se borra o cambia de hoja: se recalculan los meses de esa hoja
create or replace function public.trg_recalcular_desde_contrato()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if tg_op in ('INSERT', 'UPDATE') then
    for r in select id from public.pagos where hoja = new.hoja loop perform public.recalcular_pago(r.id); end loop;
  end if;
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.hoja is distinct from new.hoja) then
    for r in select id from public.pagos where hoja = old.hoja loop perform public.recalcular_pago(r.id); end loop;
  end if;
  return null;
exception when others then
  raise warning 'recalcular_pago (contratos): %', sqlerrm;
  return null;
end;
$$;
revoke all on function public.trg_recalcular_desde_contrato() from public, anon, authenticated;

drop trigger if exists totales_auto_contratos on public.contratos;
create trigger totales_auto_contratos after insert or delete or update of hoja on public.contratos
  for each row execute function public.trg_recalcular_desde_contrato();

-- 3) Reparación con un clic (solo administradores; también desde el SQL Editor)
create or replace function public.recalcular_todos_los_pagos()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer := 0;
  r record;
begin
  if not (public.es_admin_activo() or session_user in ('postgres', 'supabase_admin')) then
    raise exception 'Solo los administradores pueden recalcular los saldos';
  end if;
  for r in select x.pago_id from public.control_saldos(true) x loop
    perform public.recalcular_pago(r.pago_id);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.recalcular_todos_los_pagos() from public, anon;
grant execute on function public.recalcular_todos_los_pagos() to authenticated;

commit;

-- Verificación (debería devolver 0 filas):
--   select * from control_saldos();
