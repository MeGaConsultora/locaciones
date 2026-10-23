-- Auditoría: registro de QUIÉN cambió QUÉ y CUÁNDO en las tablas que mueven plata
-- o definen contratos y accesos. Correr a mano en el SQL Editor de Supabase.
--
-- Cómo funciona:
--  * Un trigger por tabla anota cada INSERT / UPDATE / DELETE en public.auditoria.
--  * En un UPDATE se guardan SOLO las columnas que cambiaron (antes / después).
--    Si un guardado no cambia nada (pasa seguido: recálculos de saldo), no se anota.
--  * Se guarda el usuario (id y email del token). Si el cambio viene de una Edge
--    Function o del SQL Editor (sin sesión de persona), queda "(sin sesión: …)".
--  * Se saca la columna temp_password: una contraseña temporal nunca se copia acá.
--  * Los administradores pueden LEER la tabla; nadie puede modificarla ni borrarla
--    desde la app (no hay permisos de escritura para usuarios autenticados).
--  * La auditoría NUNCA frena una operación: si el registro falla, se avisa con
--    un warning y el cambio de negocio sigue.

create table if not exists public.auditoria (
  id bigint generated always as identity primary key,
  fecha timestamptz not null default now(),
  tabla text not null,
  operacion text not null check (operacion in ('INSERT', 'UPDATE', 'DELETE')),
  fila_id text,
  usuario_id text,
  usuario_email text,
  contexto jsonb,   -- hoja (contrato), mes, pago_id, etc., para poder buscar
  antes jsonb,      -- UPDATE: columnas que cambiaron (valor anterior) · DELETE: la fila completa
  despues jsonb     -- UPDATE: columnas que cambiaron (valor nuevo) · INSERT: la fila completa
);

create index if not exists auditoria_fecha_idx on public.auditoria (fecha desc);
create index if not exists auditoria_tabla_fecha_idx on public.auditoria (tabla, fecha desc);
create index if not exists auditoria_hoja_idx on public.auditoria ((contexto ->> 'hoja'));

-- Permisos: solo lectura para administradores
alter table public.auditoria enable row level security;
revoke all on public.auditoria from public, anon, authenticated;
grant select on public.auditoria to authenticated;
drop policy if exists auditoria_solo_admin_lee on public.auditoria;
create policy auditoria_solo_admin_lee on public.auditoria
  for select to authenticated using (public.es_admin_activo());

create or replace function public.auditar_cambio()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_excluir text[] := array['temp_password'];
  v_old jsonb;
  v_new jsonb;
  v_base jsonb;
  v_antes jsonb;
  v_despues jsonb;
  v_hoja text;
  v_mes text;
  v_email text;
begin
  if tg_op in ('UPDATE', 'DELETE') then v_old := to_jsonb(old) - v_excluir; end if;
  if tg_op in ('UPDATE', 'INSERT') then v_new := to_jsonb(new) - v_excluir; end if;

  if tg_op = 'UPDATE' then
    if v_old = v_new then return null; end if;   -- no cambió nada: no se anota
    select jsonb_object_agg(k, v_old -> k), jsonb_object_agg(k, v_new -> k)
      into v_antes, v_despues
      from jsonb_object_keys(v_new) as k
     where (v_old -> k) is distinct from (v_new -> k);
  elsif tg_op = 'INSERT' then
    v_despues := v_new;
  else
    v_antes := v_old;
  end if;

  v_base := coalesce(v_new, v_old);
  v_hoja := v_base ->> 'hoja';
  v_mes := v_base ->> 'mes';

  -- Para poder buscar por contrato aunque la fila solo traiga pago_id / contrato_id
  begin
    if v_hoja is null and (v_base ->> 'pago_id') is not null then
      select p.hoja, p.mes::text into v_hoja, v_mes
        from public.pagos p where p.id = (v_base ->> 'pago_id')::bigint;
    end if;
    if v_hoja is null and (v_base ->> 'contrato_id') is not null then
      select c.hoja into v_hoja
        from public.contratos c where c.id = (v_base ->> 'contrato_id')::bigint;
    end if;
  exception when others then
    null;
  end;

  v_email := auth.jwt() ->> 'email';

  insert into public.auditoria (tabla, operacion, fila_id, usuario_id, usuario_email, contexto, antes, despues)
  values (
    tg_table_name, tg_op, v_base ->> 'id',
    auth.uid()::text,
    coalesce(v_email, '(sin sesión: ' || session_user || ')'),
    jsonb_strip_nulls(jsonb_build_object(
      'hoja', v_hoja, 'mes', v_mes,
      'pago_id', v_base ->> 'pago_id', 'contrato_id', v_base ->> 'contrato_id',
      'persona_id', v_base ->> 'persona_id')),
    v_antes, v_despues
  );
  return null;
exception when others then
  raise warning 'auditar_cambio (%): %', tg_table_name, sqlerrm;
  return null;
end;
$$;

revoke all on function public.auditar_cambio() from public, anon, authenticated;

-- Un trigger por tabla auditada
do $$
declare t text;
begin
  foreach t in array array[
    'pagos', 'pagos_extras', 'pagos_suministros', 'movimientos_pagos',
    'caja_movimientos', 'recibos_propietario_emitidos', 'gastos_inicio_cuotas',
    'contratos', 'contrato_personas', 'contrato_suministros', 'usuarios'
  ] loop
    execute format('drop trigger if exists auditoria_%1$s on public.%1$I', t);
    execute format(
      'create trigger auditoria_%1$s after insert or update or delete on public.%1$I
         for each row execute function public.auditar_cambio()', t);
  end loop;
end $$;
