-- Totales y saldos automáticos: la base mantiene sola el total / saldo / estado de pago de cada mes.
-- Correr a mano en el SQL Editor de Supabase, DESPUÉS de 14_control_saldos.sql.
--
-- Qué hace (en este orden, todo junto en una transacción: si algo falla, no queda nada a medias):
--   1. Reparación única: recalcula total, saldo y estado de los meses donde lo guardado no coincide
--      con lo calculado (los que lista control_saldos()). Los meses rescindidos no se tocan.
--   2. Función recalcular_pago(id): recalcula UN mes con la misma regla que usa la pantalla.
--   3. Triggers: cada vez que cambia el alquiler, un importe viejo de servicio, lo abonado,
--      un extra o un importe de servicio por cuenta, la base recalcula ese mes.
--
-- La regla es la misma que la de la pantalla (calcularTotal / recalcularFilaPago en index.html):
--   total  = alquiler + servicios + extras      (ver 14_control_saldos.sql)
--   saldo  = total − pagado_importe, nunca negativo
--   estado = 'SI' si el saldo es 0; 'PARCIAL' si hay algo abonado; si no, queda como estaba ('NO' si estaba vacío)
-- La pantalla sigue calculando y guardando igual: ahora ambos dan el mismo resultado, así que no se pisan.
--
-- Cada cambio queda registrado en la auditoría (13_auditoria.sql) con el valor anterior y el nuevo.

begin;

-- 1) Reparación única de los meses desfasados ------------------------------------------------------
update public.pagos p
   set total  = c.total_calc,
       saldo  = c.saldo_calc,
       pagado = case when c.saldo_calc <= 0 then 'SI'
                     when coalesce(p.pagado_importe, 0) > 0 then 'PARCIAL'
                     else coalesce(p.pagado, 'NO') end
  from (select x.id,
               public.total_calculado_pago(x.id) as total_calc,
               greatest(0, round(public.total_calculado_pago(x.id) - coalesce(x.pagado_importe, 0), 2)) as saldo_calc
          from public.pagos x
         where coalesce(x.pagado, '') <> 'RESCINDIDO') c
 where p.id = c.id
   and (abs(coalesce(p.total, 0) - c.total_calc) > 0.009
        or abs(coalesce(p.saldo, 0) - c.saldo_calc) > 0.009);

-- 2) Recalcular un mes -----------------------------------------------------------------------------
create or replace function public.recalcular_pago(p_pago_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
  t numeric;
  s numeric;
  est text;
begin
  select id, pagado, pagado_importe into v from public.pagos where id = p_pago_id;
  if not found or coalesce(v.pagado, '') = 'RESCINDIDO' then return; end if;
  t := public.total_calculado_pago(p_pago_id);
  s := greatest(0, round(t - coalesce(v.pagado_importe, 0), 2));
  est := case when s <= 0 then 'SI'
              when coalesce(v.pagado_importe, 0) > 0 then 'PARCIAL'
              else coalesce(v.pagado, 'NO') end;
  update public.pagos
     set total = t, saldo = s, pagado = est
   where id = p_pago_id
     and (total is distinct from t or saldo is distinct from s or pagado is distinct from est);
end;
$$;
revoke all on function public.recalcular_pago(bigint) from public, anon, authenticated;

-- 3) Triggers --------------------------------------------------------------------------------------
create or replace function public.trg_recalcular_desde_pago()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.recalcular_pago(new.id);
  return null;
exception when others then
  raise warning 'recalcular_pago (pagos %): %', new.id, sqlerrm;
  return null;
end;
$$;

create or replace function public.trg_recalcular_desde_detalle()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('INSERT', 'UPDATE') and new.pago_id is not null then perform public.recalcular_pago(new.pago_id); end if;
  if tg_op in ('UPDATE', 'DELETE') and old.pago_id is not null
     and (tg_op = 'DELETE' or old.pago_id is distinct from new.pago_id) then perform public.recalcular_pago(old.pago_id); end if;
  return null;
exception when others then
  raise warning 'recalcular_pago (%): %', tg_table_name, sqlerrm;
  return null;
end;
$$;
revoke all on function public.trg_recalcular_desde_pago() from public, anon, authenticated;
revoke all on function public.trg_recalcular_desde_detalle() from public, anon, authenticated;

drop trigger if exists totales_auto_pagos_ins on public.pagos;
create trigger totales_auto_pagos_ins after insert on public.pagos
  for each row execute function public.trg_recalcular_desde_pago();

drop trigger if exists totales_auto_pagos_upd on public.pagos;
create trigger totales_auto_pagos_upd after update of importe_alquiler, monto_epe, monto_agua, monto_tgiu,
    monto_seguro, monto_internet, monto_expensas, pagado_importe on public.pagos
  for each row execute function public.trg_recalcular_desde_pago();

drop trigger if exists totales_auto_extras on public.pagos_extras;
create trigger totales_auto_extras after insert or update or delete on public.pagos_extras
  for each row execute function public.trg_recalcular_desde_detalle();

drop trigger if exists totales_auto_suministros on public.pagos_suministros;
create trigger totales_auto_suministros after insert or update or delete on public.pagos_suministros
  for each row execute function public.trg_recalcular_desde_detalle();

commit;

-- Verificación (debería devolver 0 filas):
--   select * from control_saldos();
