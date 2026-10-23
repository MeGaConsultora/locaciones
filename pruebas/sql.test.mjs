// Pruebas de los scripts SQL (roles, datos del portal de propietarios y auditoría) en una base
// PostgreSQL de prueba que corre en memoria (PGlite). Si PGlite no está instalado, se saltean.
//   Instalar una vez:   npm install --no-save @electric-sql/pglite
//   Correr:             node --test

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { RAIZ } from './helpers.mjs';

const pglite = await import('@electric-sql/pglite').catch(() => null);
const skip = pglite ? false : 'PGlite no está instalado (npm install --no-save @electric-sql/pglite)';
const sql = f => fs.readFileSync(path.join(RAIZ, 'sql_historial_local', f), 'utf8');

const A = '00000000-0000-0000-0000-000000000001';
const u = n => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;

async function baseDePrueba() {
  const db = new pglite.PGlite();
  await db.exec(`
    create role anon; create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('test.jwt', true), '')::jsonb $$;
    create table public.usuarios (id serial primary key, email text, user_id text, aprobado boolean, admin boolean, rol text, persona_id integer, temp_password text);
    create table public.contratos (id integer primary key, hoja text, titulo text, locatario text, vigencia_desde date, vigencia_hasta date, fecha_rescision date, dia_vencimiento int, modalidad_pago text, periodicidad_actualizacion text, indice_actualizacion text, comision_porcentaje numeric, inquilino_id integer);
    create table public.contrato_personas (id integer primary key, contrato_id integer, persona_id integer, rol text, pct_alquiler numeric);
    create table public.pagos (id integer primary key, hoja text, mes date, importe_alquiler numeric, total numeric, saldo numeric, pagado text, pagado_importe numeric, recibo_prop_emitido boolean, rendido_prop_items jsonb);
    create table public.pagos_extras (id integer primary key, pago_id integer, concepto text, importe numeric, a_cargo_de text, tipo text, propietario_persona_id integer);
    create table public.pagos_suministros (id integer primary key, pago_id integer, suministro_id integer, importe numeric);
    create table public.movimientos_pagos (id integer primary key, pago_id integer, monto numeric);
    create table public.caja_movimientos (id integer primary key, fecha date, categoria text, monto numeric, moneda text, pago_id integer, persona_id integer, concepto text);
    create table public.recibos_propietario_emitidos (id integer primary key, pago_id integer, persona_id integer, items_rendidos jsonb, via_caja boolean default true);
    create table public.gastos_inicio_cuotas (id integer primary key, contrato_id integer, monto numeric);
    create table public.contrato_suministros (id integer primary key, contrato_id integer, tipo text);
    create function public.es_admin_activo() returns boolean language sql security definer stable as $$
      select exists (select 1 from public.usuarios where user_id = auth.uid()::text and aprobado = true and (admin = true or rol = 'admin')); $$;
    grant usage on schema public, auth to anon, authenticated;
    grant all on all tables in schema public to authenticated;
  `);
  return db;
}
const sesion = (db, uid, email) => db.exec(`select set_config('test.uid','${uid}',false); select set_config('test.jwt','${email ? `{"email":"${email}"}` : ''}',false);`);

// ───────────────────────── Roles y datos del portal de propietarios ─────────────────────────
test('mis_roles y portal_propietario_datos', { skip }, async t => {
  const db = await baseDePrueba();
  await db.exec(sql('11_mis_roles.sql'));
  await db.exec(sql('12_portal_propietarios_detalle.sql'));
  await db.exec(`
    insert into public.usuarios (email,user_id,aprobado,admin,rol,persona_id) values
     ('admin-solo','${u(1)}',true,true,'admin',null), ('prop','${u(2)}',true,false,'propietario',1), ('inq','${u(3)}',true,false,'inquilino',9),
     ('inq-por-id','${u(4)}',true,false,'inquilino',11), ('prop+inq','${u(5)}',true,false,'inquilino',3), ('admin+prop','${u(6)}',true,true,'admin',2),
     ('sin-aprobar','${u(7)}',false,false,'propietario',1), ('sin-persona','${u(8)}',true,false,'inquilino',null);
    insert into public.contratos (id,hoja,titulo,locatario,vigencia_desde,vigencia_hasta,dia_vencimiento,modalidad_pago,comision_porcentaje,inquilino_id) values
     (10,'Gardella-Trutali','Gardella-Trutali','TRUTALI','2025-05-01','2027-04-30',10,'ADELANTADO',8,null),
     (20,'Gazzera','Gazzera','ESPINDOLA','2025-01-01','2026-12-31',10,'VENCIDO',8,null),
     (30,'Con-Inq-Id','Con-Inq-Id','X','2025-01-01','2026-12-31',10,'ADELANTADO',8,11);
    insert into public.contrato_personas (id,contrato_id,persona_id,rol,pct_alquiler) values
     (1,10,1,'propietario',50),(2,10,2,'propietario',50),(3,10,9,'inquilino',null),(4,10,3,'inquilino',null),(5,20,3,'propietario',100);
    insert into public.pagos (id,hoja,mes,importe_alquiler,total,saldo,pagado,pagado_importe,recibo_prop_emitido,rendido_prop_items) values
     (100,'Gardella-Trutali','2026-09-01',299395,300000,0,'SI',300000,false,null),
     (200,'Gazzera','2026-09-01',340000,340000,0,'SI',340000,true,'{"alquiler":{"monto":340000}}');
    insert into public.pagos_extras (id,pago_id,concepto,importe,a_cargo_de,tipo,propietario_persona_id) values
     (1,100,'Termotanque',30000,'propietario','debito',null), (2,100,'Solo del otro',5000,'propietario','debito',2),
     (3,100,'Solo mío',7000,'propietario','credito',1), (4,100,'Del inquilino',999,'inquilino','debito',null);
    insert into public.recibos_propietario_emitidos (id,pago_id,persona_id,items_rendidos,via_caja) values (1,100,1,'{"alquiler":{"monto":149697.5}}',false);
    insert into public.caja_movimientos (id,fecha,categoria,monto,moneda,pago_id,persona_id) values (1,'2026-09-25','Pago a propietario',312800,'ARS',200,null);
  `);
  const llamar = async (fn, uid) => { await sesion(db, uid); return (await db.query(`select public.${fn}() as d`)).rows[0].d; };

  await t.test('mis_roles detecta los roles por los datos', async () => {
    const esperado = {
      1: [true, false, false], 2: [false, true, false], 3: [false, false, true], 4: [false, false, true],
      5: [false, true, true], 6: [true, true, false], 7: [false, false, false], 8: [false, false, false]
    };
    for (const [n, [admin, propietario, inquilino]] of Object.entries(esperado)) {
      assert.deepEqual(await llamar('mis_roles', u(n)), { admin, propietario, inquilino }, `usuario ${n}`);
    }
    assert.deepEqual(await llamar('mis_roles', ''), { admin: false, propietario: false, inquilino: false });
  });

  await t.test('el propietario ve solo lo suyo, con su porcentaje y sus abonos', async () => {
    const d = await llamar('portal_propietario_datos', u(2));
    assert.deepEqual(d.contratos.map(c => [c.hoja, c.mi_porcentaje, Number(c.cant_propietarios)]), [['Gardella-Trutali', 50, 2]]);
    assert.equal(d.pagos.length, 1);
    const p = d.pagos[0];
    assert.equal(p.cobro_directo, true);       // la rendición de este propietario se cobró directo (fuera de Caja)
    // extras: el "Todos" y el propio; no el de otro propietario ni el del inquilino
    assert.deepEqual(p.extras_prop.map(e => e.concepto).sort(), ['Solo mío', 'Termotanque']);
  });
  await t.test('un propietario único ve lo abonado desde Caja aunque el movimiento no tenga persona', async () => {
    const d = await llamar('portal_propietario_datos', u(5));
    assert.deepEqual(d.contratos.map(c => c.hoja), ['Gazzera']);
    assert.equal(d.pagos[0].abonos.length, 1);
    assert.equal(Number(d.pagos[0].abonos[0].monto), 312800);
  });
  await t.test('quien no es propietario, no está aprobado o no tiene persona ve todo vacío', async () => {
    for (const n of [3, 7, 8]) {
      const d = await llamar('portal_propietario_datos', u(n));
      assert.deepEqual([d.contratos.length, d.pagos.length], [0, 0], `usuario ${n}`);
    }
  });
});

// ───────────────────────── Auditoría de cambios ─────────────────────────
test('auditoría: registra quién cambió qué, sin secretos y sin frenar el negocio', { skip }, async t => {
  const db = await baseDePrueba();
  await db.exec(sql('13_auditoria.sql'));
  await db.exec(`
    insert into public.usuarios (email,user_id,aprobado,admin,rol,temp_password) values ('hugo@x.com','${A}',true,true,'admin','secreta1'),('inq@x.com','${u(2)}',true,false,'inquilino',null);
    insert into public.contratos (id,hoja,titulo) values (7,'Corroquer','Corroquer'); truncate public.auditoria;`);
  const comoAdmin = async s => { await sesion(db, A, 'hugo@x.com'); await db.exec(s); };
  const filas = async () => (await db.query('select tabla, operacion, usuario_email, contexto, antes, despues from public.auditoria order by id')).rows;

  await t.test('anota altas, cambios (solo columnas modificadas) y bajas, con la hoja resuelta', async () => {
    await comoAdmin(`insert into public.pagos (id,hoja,mes,total,saldo,pagado,pagado_importe) values (1,'Corroquer','2026-10-01',726397.04,726397.04,'0',0);`);
    await comoAdmin(`update public.pagos set pagado_importe=730000, saldo=0, pagado='SI' where id=1;`);
    await comoAdmin(`insert into public.pagos_extras (id,pago_id,concepto,importe) values (5,1,'EPE',168261.22);`);
    await comoAdmin(`delete from public.pagos_extras where id=5;`);
    const f = await filas();
    assert.deepEqual(f.map(x => [x.tabla, x.operacion]), [['pagos', 'INSERT'], ['pagos', 'UPDATE'], ['pagos_extras', 'INSERT'], ['pagos_extras', 'DELETE']]);
    assert.deepEqual(f[1].antes, { saldo: 726397.04, pagado: '0', pagado_importe: 0 });
    assert.deepEqual(f[1].despues, { saldo: 0, pagado: 'SI', pagado_importe: 730000 });
    assert.equal(f[2].contexto.hoja, 'Corroquer');          // el extra solo trae pago_id: la hoja se resuelve sola
    assert.ok(f.every(x => x.usuario_email === 'hugo@x.com'));
  });
  await t.test('un guardado que no cambia nada no deja registro', async () => {
    const antes = (await filas()).length;
    await comoAdmin(`update public.pagos set saldo=0, total=726397.04 where id=1;`);
    assert.equal((await filas()).length, antes);
  });
  await t.test('la contraseña temporal nunca se copia', async () => {
    await comoAdmin(`update public.usuarios set rol='propietario', temp_password='nueva2' where email='inq@x.com';`);
    const todo = JSON.stringify(await filas());
    assert.ok(!todo.includes('secreta1') && !todo.includes('nueva2'));
  });
  await t.test('un cambio sin sesión (SQL Editor / función del sistema) queda identificado como tal', async () => {
    await sesion(db, '', '');
    await db.exec(`insert into public.caja_movimientos (id,pago_id,monto) values (1,1,500);`);
    const ultima = (await filas()).at(-1);
    assert.match(ultima.usuario_email, /^\(sin sesión: /);
  });
  await t.test('permisos: solo los administradores leen; nadie escribe ni ejecuta el trigger', async () => {
    const intentar = async (uid, consulta) => {
      await db.exec(`select set_config('test.uid','${uid}',false); set role authenticated;`);
      try { const r = await db.query(consulta); await db.exec('reset role'); return { ok: true, filas: r.rows?.length }; }
      catch (e) { await db.exec('reset role'); return { ok: false, error: e.message }; }
    };
    assert.equal((await intentar(A, 'select id from public.auditoria')).ok, true);
    assert.equal((await intentar(u(2), 'select id from public.auditoria')).filas, 0);   // no-admin: no ve nada
    for (const q of ['delete from public.auditoria', "update public.auditoria set tabla='x'", "insert into public.auditoria (tabla,operacion) values ('x','INSERT')", 'select public.auditar_cambio()']) {
      assert.equal((await intentar(A, q)).ok, false, q);
    }
  });
  await t.test('si el registro de auditoría fallara, el cambio de negocio igual se guarda', async () => {
    await db.exec(`alter table public.auditoria add constraint rompe check (tabla <> 'pagos_extras') not valid`);
    await comoAdmin(`insert into public.pagos_extras (id,pago_id,concepto,importe) values (6,1,'Otro',10);`);
    assert.equal((await db.query('select count(*)::int n from public.pagos_extras where id=6')).rows[0].n, 1);
  });
});
