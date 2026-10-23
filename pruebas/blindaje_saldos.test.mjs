// Pruebas de 16_blindaje_saldos.sql: la base corrige sola cualquier total/saldo mal guardado, se entera de
// los cambios en contratos y cuentas de servicio, y el botón de reparación funciona solo para administradores.
//   Requiere PGlite: npm install --no-save @electric-sql/pglite   (si no está, se saltea)

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { RAIZ } from './helpers.mjs';

const pglite = await import('@electric-sql/pglite').catch(() => null);
const skip = pglite ? false : 'PGlite no está instalado (npm install --no-save @electric-sql/pglite)';
const leerSql = f => fs.readFileSync(path.join(RAIZ, 'sql_historial_local', f), 'utf8');
const semilla = s => () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };

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
async function base() {
  const db = new pglite.PGlite();
  await db.exec(ESQUEMA);
  for (const f of ['14_control_saldos.sql', '15_totales_automaticos.sql', '16_blindaje_saldos.sql']) await db.exec(leerSql(f));
  return db;
}
const mes = async (db, id) => (await db.query('select total, saldo, pagado from public.pagos where id=$1', [id])).rows.map(r => [Number(r.total), Number(r.saldo), r.pagado])[0];

test('si la pantalla guarda un total o saldo viejo directamente, la base lo corrige en el acto', { skip }, async t => {
  const db = await base();
  await db.exec(`insert into public.contratos values (1,'A');
    insert into public.pagos (id,hoja,mes,importe_alquiler,pagado,pagado_importe) values (1,'A','2026-10-01',100000,'0',0);
    insert into public.pagos_extras (pago_id,importe,a_cargo_de,tipo) values (1,30000,'inquilino','debito');`);
  assert.deepEqual(await mes(db, 1), [130000, 130000, '0']);

  await t.test('un total viejo escrito a mano vuelve a su valor', async () => {
    await db.exec(`update public.pagos set total = 100000, saldo = 100000 where id = 1;`);       // la pantalla "no se enteró" del extra
    assert.deepEqual(await mes(db, 1), [130000, 130000, '0']);
  });
  await t.test('un saldo inventado también', async () => {
    await db.exec(`update public.pagos set saldo = 5 where id = 1;`);
    assert.deepEqual(await mes(db, 1), [130000, 130000, '0']);
  });
  await t.test('lo abonado manda: total viejo + abonado nuevo dan el saldo correcto', async () => {
    await db.exec(`update public.pagos set total = 1, pagado_importe = 30000, saldo = 0, pagado = 'SI' where id = 1;`);
    assert.deepEqual(await mes(db, 1), [130000, 100000, 'PARCIAL']);
  });
  await t.test('un cambio en una columna que no afecta el cálculo no rompe nada', async () => {
    await db.exec(`update public.pagos set mes = '2026-10-15' where id = 1;`);
    assert.deepEqual(await mes(db, 1), [130000, 100000, 'PARCIAL']);
  });
  await t.test('100 escrituras viejas al azar: siempre queda el valor correcto', async () => {
    const rnd = semilla(5);
    for (let i = 0; i < 100; i++) {
      await db.query('update public.pagos set total = $1, saldo = $2 where id = 1', [Math.round(rnd() * 1e6) / 100, Math.round(rnd() * 1e6) / 100]);
      assert.deepEqual(await mes(db, 1), [130000, 100000, 'PARCIAL']);
    }
  });
});

test('cambios en cuentas de servicio y contratos recalculan los meses afectados', { skip }, async t => {
  const db = await base();
  await db.exec(`insert into public.contrato_suministros values (5,1,'epe');
    insert into public.pagos (id,hoja,mes,importe_alquiler,pagado,pagado_importe,monto_epe) values (1,'X','2026-10-01',100000,'0',0,5000);
    insert into public.pagos_suministros (pago_id,suministro_id,importe) values (1,5,8000);`);

  await t.test('sin contrato, los montos viejos de servicios no cuentan (solo la cuenta nueva)', async () => {
    assert.deepEqual(await mes(db, 1), [108000, 108000, '0']);
  });
  await t.test('al crearse el contrato con esa hoja, los montos viejos de otros tipos empiezan a contar', async () => {
    await db.exec(`update public.pagos set monto_agua = 700 where id = 1;`);                      // agua vieja: sin cuenta de agua, cuenta si hay contrato
    assert.deepEqual(await mes(db, 1), [108000, 108000, '0']);
    await db.exec(`insert into public.contratos values (1,'X');`);
    assert.deepEqual(await mes(db, 1), [108700, 108700, '0']);
  });
  await t.test('si la cuenta de servicio cambia de tipo, cambia qué monto viejo se cuenta', async () => {
    // la cuenta 5 era "epe": el monto_epe viejo (5000) quedaba tapado. Ahora pasa a "agua": se destapa el epe y se tapa el agua.
    await db.exec(`update public.contrato_suministros set tipo = 'agua' where id = 5;`);
    assert.deepEqual(await mes(db, 1), [108000 + 5000, 108000 + 5000, '0']);
  });
  await t.test('si se borra la cuenta, el importe por cuenta sigue contando y los montos viejos se destapan', async () => {
    await db.exec(`delete from public.contrato_suministros where id = 5;`);
    assert.deepEqual(await mes(db, 1), [100000 + 8000 + 5000 + 700, 100000 + 8000 + 5000 + 700, '0']);
  });
  await t.test('si el contrato cambia de hoja, los meses de la hoja vieja se recalculan', async () => {
    await db.exec(`update public.contratos set hoja = 'Y' where id = 1;`);                         // los meses de 'X' se quedan sin contrato
    assert.deepEqual(await mes(db, 1), [108000, 108000, '0']);
  });
  await t.test('si se borra el contrato, también', async () => {
    await db.exec(`update public.contratos set hoja = 'X' where id = 1;`);
    assert.deepEqual(await mes(db, 1), [100000 + 8000 + 5000 + 700, 100000 + 8000 + 5000 + 700, '0']);
    await db.exec(`delete from public.contratos where id = 1;`);
    assert.deepEqual(await mes(db, 1), [108000, 108000, '0']);
  });
});

test('recalcular_todos_los_pagos: repara de una vez y solo lo puede usar un administrador', { skip }, async t => {
  const db = await base();
  await db.exec(`insert into public.contratos values (1,'A');
    insert into public.usuarios (user_id, aprobado, admin, rol) values ('00000000-0000-0000-0000-000000000001', true, true, 'admin'), ('00000000-0000-0000-0000-000000000002', true, false, 'inquilino');
    insert into public.pagos (id,hoja,mes,importe_alquiler,pagado,pagado_importe) values (1,'A','2026-08-01',100000,'0',0),(2,'A','2026-09-01',200000,'0',0),(3,'A','2026-10-01',300000,'0',0);`);
  // Se simula un desfase "de fábrica" (cambios hechos saltándose los triggers)
  await db.exec(`set session_replication_role = replica; update public.pagos set total = 1, saldo = 1 where id in (1,3); reset session_replication_role;`);
  assert.equal((await db.query('select count(*)::int n from public.control_saldos()')).rows[0].n, 2);

  await t.test('un usuario que no es administrador no puede', async () => {
    await db.exec(`select set_config('test.uid','00000000-0000-0000-0000-000000000002',false); set session authorization authenticated;`);
    await assert.rejects(db.query('select public.recalcular_todos_los_pagos()'), /Solo los administradores/);
    await db.exec('set session authorization postgres');
    assert.equal((await db.query('select count(*)::int n from public.control_saldos()')).rows[0].n, 2);
  });
  await t.test('un administrador repara todos los meses desfasados y se informa cuántos', async () => {
    await db.exec(`select set_config('test.uid','00000000-0000-0000-0000-000000000001',false); set session authorization authenticated;`);
    const r = await db.query('select public.recalcular_todos_los_pagos() as n');
    await db.exec('set session authorization postgres');
    assert.equal(r.rows[0].n, 2);
    assert.equal((await db.query('select count(*)::int n from public.control_saldos()')).rows[0].n, 0);
    assert.deepEqual(await mes(db, 1), [100000, 100000, '0']);
    assert.deepEqual(await mes(db, 3), [300000, 300000, '0']);
  });
  await t.test('sin nada para reparar devuelve 0', async () => {
    assert.equal((await db.query('select public.recalcular_todos_los_pagos() as n')).rows[0].n, 0);
  });
});
