// 17_limpiar_campo_viejo_servicios.sql: pone en 0 el campo viejo monto_xxx de los servicios que ya están en
// pagos_suministros (desde nov 2026), sin mover ningún total ni saldo.
//   Requiere PGlite: npm install --no-save @electric-sql/pglite   (si no está, se saltea)

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { RAIZ } from './helpers.mjs';

const pglite = await import('@electric-sql/pglite').catch(() => null);
const skip = pglite ? false : 'PGlite no está instalado (npm install --no-save @electric-sql/pglite)';
const leerSql = f => fs.readFileSync(path.join(RAIZ, 'sql_historial_local', f), 'utf8');

const ESQUEMA = `
  create role anon; create role authenticated; create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create table public.usuarios (id serial primary key, user_id text, aprobado boolean, admin boolean, rol text);
  create function public.es_admin_activo() returns boolean language sql security definer stable as $$
    select exists (select 1 from public.usuarios where user_id = auth.uid()::text and aprobado = true and (admin = true or rol = 'admin')); $$;
  create table public.contratos (id integer primary key, hoja text);
  create table public.contrato_suministros (id integer primary key, contrato_id integer, tipo text);
  create table public.pagos (id integer primary key, hoja text, mes date, importe_alquiler numeric, total numeric, saldo numeric, pagado text, pagado_importe numeric,
    monto_epe numeric, monto_agua numeric, monto_tgiu numeric, monto_seguro numeric, monto_internet numeric, monto_expensas numeric);
  create table public.pagos_extras (id serial primary key, pago_id integer, concepto text, importe numeric, a_cargo_de text, tipo text, cobrado boolean default false);
  create table public.pagos_suministros (id serial primary key, pago_id integer, suministro_id integer, importe numeric, importe_propietario numeric);
`;

async function montar() {
  const db = new pglite.PGlite();
  await db.exec(ESQUEMA);
  for (const f of ['14_control_saldos.sql', '15_totales_automaticos.sql', '16_blindaje_saldos.sql']) await db.exec(leerSql(f));
  await db.exec(`
    insert into public.contratos values (1, 'A');
    insert into public.contrato_suministros values (11, 1, 'tgiu'), (12, 1, 'agua'), (13, 1, 'epe');
    -- 1) nov 2026: TGIU en la cuenta real Y en el campo viejo (el doble registro); el agua solo en el campo viejo
    insert into public.pagos (id,hoja,mes,importe_alquiler,pagado,pagado_importe,monto_tgiu,monto_agua) values (1,'A','2026-11-01',100000,'0',0,9000,5000);
    insert into public.pagos_suministros (pago_id,suministro_id,importe) values (1,11,9000);
    -- 2) oct 2026: mismo doble registro, pero es anterior a la fecha de corte
    insert into public.pagos (id,hoja,mes,importe_alquiler,pagado,pagado_importe,monto_tgiu) values (2,'A','2026-10-01',100000,'0',0,9000);
    insert into public.pagos_suministros (pago_id,suministro_id,importe) values (2,11,9000);
    -- 3) nov 2026: el campo viejo tiene valor y la cuenta real existe pero con importe 0 (cubre el tipo igual)
    insert into public.pagos (id,hoja,mes,importe_alquiler,pagado,pagado_importe,monto_epe) values (3,'A','2026-11-01',100000,'0',0,7000);
    insert into public.pagos_suministros (pago_id,suministro_id,importe) values (3,13,0);
    -- 4) dic 2026: sin campo viejo (no hay nada que limpiar)
    insert into public.pagos (id,hoja,mes,importe_alquiler,pagado,pagado_importe) values (4,'A','2026-12-01',100000,'0',0);
    insert into public.pagos_suministros (pago_id,suministro_id,importe) values (4,11,9000);
    -- 5) nov 2026 rescindido: no se toca
    insert into public.pagos (id,hoja,mes,importe_alquiler,pagado,pagado_importe,monto_tgiu) values (5,'A','2026-11-01',0,'RESCINDIDO',0,9000);
    insert into public.pagos_suministros (pago_id,suministro_id,importe) values (5,11,9000);
  `);
  return db;
}
const estado = async db => (await db.query('select id, total::float, saldo::float, monto_tgiu::float tgiu, monto_agua::float agua, monto_epe::float epe from public.pagos order by id')).rows;
const porId = (filas, id) => filas.find(f => f.id === id);

test('la limpieza pone en 0 el campo viejo solo donde la cuenta real ya cubre ese servicio, y no mueve ningún total', { skip }, async () => {
  const db = await montar();
  const antes = await estado(db);
  assert.equal(porId(antes, 1).total, 114000);                 // alquiler + TGIU de la cuenta (una vez) + agua del campo viejo
  await db.exec(leerSql('17_limpiar_campo_viejo_servicios.sql'));
  const despues = await estado(db);

  assert.equal(porId(despues, 1).tgiu, 0);                     // TGIU: ya está en la cuenta real → campo viejo en 0
  assert.equal(porId(despues, 1).agua, 5000);                  // agua: solo en el campo viejo → NO se toca (ahí sí cuenta)
  assert.equal(porId(despues, 2).tgiu, 9000);                  // mes anterior a la fecha de corte → no se toca
  assert.equal(porId(despues, 3).epe, 0);                      // cuenta real con importe 0: igual cubre el servicio
  assert.equal(porId(despues, 5).tgiu, 9000);                  // rescindido → no se toca

  for (const f of antes) assert.equal(porId(despues, f.id).total, f.total, `el total del mes ${f.id} no puede cambiar`);
  for (const f of antes) assert.equal(porId(despues, f.id).saldo, f.saldo, `el saldo del mes ${f.id} no puede cambiar`);
  assert.equal((await db.query('select count(*)::int n from public.control_saldos()')).rows[0].n, 0);
});

test('la limpieza es repetible: correrla de nuevo no cambia nada', { skip }, async () => {
  const db = await montar();
  await db.exec(leerSql('17_limpiar_campo_viejo_servicios.sql'));
  const una = await estado(db);
  await db.exec(leerSql('17_limpiar_campo_viejo_servicios.sql'));
  assert.deepEqual(await estado(db), una);
});

test('el total con el servicio duplicado es el mismo que el JS: el campo viejo de un tipo cubierto nunca suma', { skip }, async () => {
  const db = await montar();
  // mes 1 tiene TGIU duplicado (9000 en cuenta + 9000 en campo viejo): el total cuenta 9000 una sola vez
  const { rows } = await db.query('select total_calculado_pago(1)::float t');
  assert.equal(rows[0].t, 100000 + 9000 + 5000);
});
