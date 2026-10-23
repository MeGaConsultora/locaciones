-- Control de saldos: el cálculo del total de un mes, hecho UNA vez en la base.
-- Correr a mano en el SQL Editor de Supabase. NO modifica ningún dato: solo crea
-- dos funciones de consulta.
--
--   total_calculado_pago(pago_id)  -> el total que le corresponde a ese mes
--   control_saldos(solo_diferencias) -> compara, mes por mes, el total y el saldo
--                                      GUARDADOS en la tabla pagos con los CALCULADOS
--
-- Es la misma regla que usa hoy el sistema (calcularTotal en index.html):
--   total = alquiler + servicios + extras
--   servicios: si el mes tiene importes por cuenta (pagos_suministros) → suma la parte del
--     inquilino de cada cuenta, y además los campos viejos monto_* de los tipos que NO
--     tienen cuenta cargada (siempre que el contrato exista); si no tiene → suma los
--     campos viejos monto_epe / agua / tgiu / seguro / internet / expensas.
--   extras: los que NO son a cargo del propietario; "descuento" y "crédito" restan.
--   saldo  = total − pagado_importe (nunca negativo).
--
-- Uso típico:
--   select * from control_saldos();                  -- solo los meses que NO coinciden
--   select * from control_saldos(false) limit 50;    -- todos

create or replace function public.total_calculado_pago(p_pago_id bigint)
returns numeric
language sql
stable
set search_path = ''
as $$
  with p as (select * from public.pagos where id = p_pago_id),
  ps as (   -- una fila por cuenta (si hubiera repetidas, vale la última)
    select distinct on (x.suministro_id) x.suministro_id, coalesce(x.importe, 0) as importe
      from public.pagos_suministros x
     where x.pago_id = p_pago_id
     order by x.suministro_id, x.id desc),
  cubiertos as (
    select distinct s.tipo
      from ps join public.contrato_suministros s on s.id = ps.suministro_id
     where s.tipo is not null),
  hay_contrato as (
    select 1 from public.contratos c join p on c.hoja = p.hoja limit 1),
  viejos as (
    select t.srv,
           case t.srv when 'epe' then p.monto_epe when 'agua' then p.monto_agua when 'tgiu' then p.monto_tgiu
                      when 'seguro' then p.monto_seguro when 'internet' then p.monto_internet
                      when 'expensas' then p.monto_expensas end as monto
      from p, (values ('epe'), ('agua'), ('tgiu'), ('seguro'), ('internet'), ('expensas')) as t(srv))
  select round((
      coalesce(p.importe_alquiler, 0)
    + case when exists (select 1 from ps) then
          coalesce((select sum(importe) from ps), 0)
        + case when exists (select 1 from hay_contrato) then
            coalesce((select sum(v.monto) from viejos v
                       where coalesce(v.monto, 0) <> 0
                         and v.srv not in (select tipo from cubiertos)), 0)
          else 0 end
      else
          coalesce(p.monto_epe, 0) + coalesce(p.monto_agua, 0) + coalesce(p.monto_tgiu, 0)
        + coalesce(p.monto_seguro, 0) + coalesce(p.monto_internet, 0) + coalesce(p.monto_expensas, 0)
      end
    + coalesce((select sum(case when e.tipo in ('descuento', 'credito') then -coalesce(e.importe, 0)
                                else coalesce(e.importe, 0) end)
                  from public.pagos_extras e
                 where e.pago_id = p_pago_id and e.a_cargo_de is distinct from 'propietario'), 0)
  )::numeric, 2)
  from p;
$$;

create or replace function public.control_saldos(solo_diferencias boolean default true)
returns table (
  pago_id bigint, hoja text, mes text,
  total_guardado numeric, total_calculado numeric, dif_total numeric,
  saldo_guardado numeric, saldo_calculado numeric, dif_saldo numeric,
  pagado_importe numeric
)
language sql
stable
set search_path = ''
as $$
  select * from (
    select p.id::bigint, p.hoja::text, p.mes::text,
           coalesce(p.total, 0)::numeric,
           c.total_calc,
           round(c.total_calc - coalesce(p.total, 0), 2),
           coalesce(p.saldo, 0)::numeric,
           greatest(0, round(c.total_calc - coalesce(p.pagado_importe, 0), 2)),
           round(greatest(0, round(c.total_calc - coalesce(p.pagado_importe, 0), 2)) - coalesce(p.saldo, 0), 2),
           coalesce(p.pagado_importe, 0)::numeric
      from public.pagos p
      cross join lateral (select public.total_calculado_pago(p.id) as total_calc) c
     where coalesce(p.pagado, '') <> 'RESCINDIDO'
  ) x(pago_id, hoja, mes, total_guardado, total_calculado, dif_total, saldo_guardado, saldo_calculado, dif_saldo, pagado_importe)
  where not solo_diferencias or abs(x.dif_total) > 0.009 or abs(x.dif_saldo) > 0.009
  order by greatest(abs(x.dif_total), abs(x.dif_saldo)) desc, x.pago_id;
$$;

revoke all on function public.total_calculado_pago(bigint) from public, anon;
revoke all on function public.control_saldos(boolean) from public, anon;
grant execute on function public.total_calculado_pago(bigint) to authenticated;
grant execute on function public.control_saldos(boolean) to authenticated;
