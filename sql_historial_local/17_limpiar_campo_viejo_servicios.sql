-- Limpieza del campo viejo monto_xxx (epe, agua, tgiu, seguro, internet, expensas) en los meses desde nov 2026.
-- Correr a mano en el SQL Editor de Supabase. NO cambia ningún total ni saldo.
--
-- Por qué: hasta el cambio "Importe de servicios, paso 2" (12/11/2026) cargar un servicio con una cuenta real del
-- contrato dejaba el importe en pagos_suministros Y ADEMÁS en el campo viejo monto_xxx del mes. La regla del total
-- (total_calculado_pago / calcularTotal) ya ignora el campo viejo de un tipo cuando el mes tiene una fila de
-- pagos_suministros de ese tipo, así que el total estaba bien; era un doble registro. Desde el paso 2 las cargas
-- nuevas dejan el campo viejo en 0. Esto hace lo mismo con lo que se cargó antes.
--
-- Qué toca: solo los meses desde 2026-11-01, y solo el tipo de servicio que YA tiene una fila en pagos_suministros
-- en ese mes. Un servicio cargado únicamente en el campo viejo (sin cuenta real) NO se toca: ahí sí cuenta.
-- Cada cambio queda en la auditoría (13_auditoria.sql) y los triggers recalculan el mes (queda igual).
--
-- Antes de correrlo, ver cuántos meses afecta (la consulta 3 de la revisión de saldos) y cambiar la fecha si hace falta.

begin;

update public.pagos p
set monto_epe      = case when coalesce(p.monto_epe, 0)      <> 0 and t.epe      then 0 else p.monto_epe      end,
    monto_agua     = case when coalesce(p.monto_agua, 0)     <> 0 and t.agua     then 0 else p.monto_agua     end,
    monto_tgiu     = case when coalesce(p.monto_tgiu, 0)     <> 0 and t.tgiu     then 0 else p.monto_tgiu     end,
    monto_seguro   = case when coalesce(p.monto_seguro, 0)   <> 0 and t.seguro   then 0 else p.monto_seguro   end,
    monto_internet = case when coalesce(p.monto_internet, 0) <> 0 and t.internet then 0 else p.monto_internet end,
    monto_expensas = case when coalesce(p.monto_expensas, 0) <> 0 and t.expensas then 0 else p.monto_expensas end
from (
  select ps.pago_id,
         bool_or(cs.tipo = 'epe')      as epe,
         bool_or(cs.tipo = 'agua')     as agua,
         bool_or(cs.tipo = 'tgiu')     as tgiu,
         bool_or(cs.tipo = 'seguro')   as seguro,
         bool_or(cs.tipo = 'internet') as internet,
         bool_or(cs.tipo = 'expensas') as expensas
  from public.pagos_suministros ps
  join public.contrato_suministros cs on cs.id = ps.suministro_id
  group by ps.pago_id
) t
where t.pago_id = p.id
  and p.mes >= date '2026-11-01'
  and coalesce(p.pagado, '') <> 'RESCINDIDO'
  and (   (coalesce(p.monto_epe, 0)      <> 0 and t.epe)
       or (coalesce(p.monto_agua, 0)     <> 0 and t.agua)
       or (coalesce(p.monto_tgiu, 0)     <> 0 and t.tgiu)
       or (coalesce(p.monto_seguro, 0)   <> 0 and t.seguro)
       or (coalesce(p.monto_internet, 0) <> 0 and t.internet)
       or (coalesce(p.monto_expensas, 0) <> 0 and t.expensas));

commit;

-- Verificación (las dos deberían dar 0 filas):
--   select * from control_saldos();
--   (la consulta 3 de la revisión: servicios guardados en el campo viejo y en la cuenta real)
