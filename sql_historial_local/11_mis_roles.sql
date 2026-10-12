-- Un mismo usuario puede ser a la vez inquilino, propietario y/o admin: los
-- "roles" se detectan por los DATOS, no por el campo usuarios.rol (que solo
-- admite un valor):
--   admin       -> el mismo criterio que es_admin_activo() (admin=true o rol='admin')
--   propietario -> su persona figura como propietaria en algún contrato
--   inquilino   -> su persona figura como inquilina en algún contrato
--                  (contrato_personas o contratos.inquilino_id)
-- Cada portal usa esto para decidir si deja entrar y para ofrecer "Ver como…".
-- Correr a mano en el SQL Editor de Supabase.

create or replace function public.mis_roles()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_persona public.usuarios.persona_id%type;
  v_admin boolean := false;
  v_prop boolean := false;
  v_inq boolean := false;
begin
  select u.persona_id into v_persona
  from public.usuarios u
  where u.user_id = auth.uid()::text and u.aprobado = true
  limit 1;

  if not found then
    return jsonb_build_object('admin', false, 'propietario', false, 'inquilino', false);
  end if;

  v_admin := public.es_admin_activo();

  if v_persona is not null then
    v_prop := exists (select 1 from public.contrato_personas cp
                       where cp.persona_id = v_persona and cp.rol = 'propietario');
    v_inq := exists (select 1 from public.contrato_personas cp
                      where cp.persona_id = v_persona and cp.rol = 'inquilino')
          or exists (select 1 from public.contratos c where c.inquilino_id = v_persona);
  end if;

  return jsonb_build_object('admin', v_admin, 'propietario', v_prop, 'inquilino', v_inq);
end;
$$;

revoke all on function public.mis_roles() from public;
revoke all on function public.mis_roles() from anon;
grant execute on function public.mis_roles() to authenticated;

-- portal_propietario_datos(): igual que en 10_portal_propietarios.sql, pero ya
-- no exige usuarios.rol='propietario'. Alcanza con ser un usuario aprobado
-- cuya persona sea propietaria en algún contrato: la función igual devuelve
-- solo SUS contratos (si no es propietario, devuelve todo vacío).
create or replace function public.portal_propietario_datos()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_persona public.usuarios.persona_id%type;
  v_contratos jsonb;
  v_pagos jsonb;
begin
  select u.persona_id into v_persona
  from public.usuarios u
  where u.user_id = auth.uid()::text
    and u.aprobado = true
  limit 1;

  if v_persona is null then
    return jsonb_build_object('persona_id', null, 'contratos', '[]'::jsonb, 'pagos', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.vigencia_hasta desc nulls last), '[]'::jsonb)
  into v_contratos
  from (
    select c.id as contrato_id, c.hoja, c.titulo, c.locatario,
           c.vigencia_desde, c.vigencia_hasta, c.fecha_rescision,
           c.dia_vencimiento, c.modalidad_pago,
           c.periodicidad_actualizacion, c.indice_actualizacion,
           c.comision_porcentaje,
           cp.pct_alquiler as mi_porcentaje,
           (select count(*) from public.contrato_personas o
             where o.contrato_id = c.id and o.rol = 'propietario') as cant_propietarios
    from public.contrato_personas cp
    join public.contratos c on c.id = cp.contrato_id
    where cp.persona_id = v_persona and cp.rol = 'propietario'
  ) x;

  select coalesce(jsonb_agg(to_jsonb(y) order by y.mes desc), '[]'::jsonb)
  into v_pagos
  from (
    select
      p.id as pago_id, p.hoja, p.mes,
      p.importe_alquiler, p.total, p.saldo, p.pagado, p.pagado_importe,
      mc.cant_propietarios,
      coalesce((select sum(e.importe::numeric) from public.pagos_extras e
                 where e.pago_id = p.id
                   and e.a_cargo_de is distinct from 'propietario'
                   and e.tipo in ('descuento', 'credito')), 0) as creditos_inquilino,
      case when mc.cant_propietarios > 1 then r.items_rendidos::jsonb
           else p.rendido_prop_items::jsonb end as rendido_items,
      case when mc.cant_propietarios > 1
           then coalesce(r.via_caja = false, false)
           else (not coalesce(p.recibo_prop_emitido, false))
                and coalesce(p.rendido_prop_items::jsonb, '{}'::jsonb) <> '{}'::jsonb
      end as cobro_directo,
      (select coalesce(jsonb_agg(jsonb_build_object(
                'fecha', m.fecha, 'monto', m.monto, 'moneda', coalesce(m.moneda, 'ARS'))
              order by m.fecha), '[]'::jsonb)
         from public.caja_movimientos m
        where m.categoria = 'Pago a propietario'
          and m.pago_id = p.id
          and (m.persona_id = v_persona
               or (m.persona_id is null and mc.cant_propietarios <= 1))) as abonos,
      (select coalesce(jsonb_object_agg(e.id::text, e.tipo), '{}'::jsonb)
         from public.pagos_extras e
        where e.pago_id = p.id
          and (e.a_cargo_de = 'propietario' or e.propietario_persona_id is not null)) as extras_tipo
    from public.pagos p
    join (
      select c.hoja,
             (select count(*) from public.contrato_personas o
               where o.contrato_id = c.id and o.rol = 'propietario') as cant_propietarios
      from public.contrato_personas cp
      join public.contratos c on c.id = cp.contrato_id
      where cp.persona_id = v_persona and cp.rol = 'propietario'
    ) mc on mc.hoja = p.hoja
    left join public.recibos_propietario_emitidos r
           on r.pago_id = p.id and r.persona_id = v_persona
  ) y;

  return jsonb_build_object('persona_id', v_persona, 'contratos', v_contratos, 'pagos', v_pagos);
end;
$$;

revoke all on function public.portal_propietario_datos() from public;
revoke all on function public.portal_propietario_datos() from anon;
grant execute on function public.portal_propietario_datos() to authenticated;
