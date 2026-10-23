// Pruebas de 15_totales_automaticos.sql: la reparación única y los triggers que mantienen sola la
// columna total / saldo / estado de cada mes. La última prueba hace 400 operaciones al azar y
// compara lo guardado por la base con el cálculo de la pantalla (calcularTotal en index.html).
//   Requiere PGlite: npm install --no-save @electric-sql/pglite   (si no está, se saltea)

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { RAIZ, cargar } from './helpers.mjs';

const pglite = await import('@electric-sql/pglite').catch(() => null);
const skip = pglite ? false : 'PGlite no está instalado (npm install --no-save @electric-sql/pglite)';
const leerSql = f => fs.readFileSync(path.join(RAIZ, 'sql_historial_local', f), 'utf8');
const semilla = s => () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };

const ESQUEMA = `
  create role anon; create role authenticated;
  create table public.contratos (id integer primary key, hoja text);
  create table public.contrato_suministros (id integer primary key, contrato_id integer, tipo text);
  create table public.pagos (id integer primary key, hoja text, mes date, importe_alquiler numeric, total numeric, saldo numeric, pagado text, pagado_importe numeric,
    monto_epe numeric, monto_agua numeric, monto_tgiu numeric, monto_seguro numeric, monto_internet numeric, monto_expensas numeric);
  create table public.pagos_extras (id serial primary key, pago_id integer, concepto text, importe numeric, a_cargo_de text, tipo text, cobrado boolean default false);
  create table public.pagos_suministros (id serial primary key, pago_id integer, suministro_id integer, importe numeric, importe_propietario numeric);
`;

test('reparación única: corrige los meses desfasados y deja control_saldos() vacío', { skip }, async () => {
  const db = new pglite.PGlite();
  await db.exec(ESQUEMA + `
    insert into public.contratos values (1,'A');
    insert into public.pagos (id,hoja,mes,importe_alquiler,total,saldo,pagado,pagado_importe) values
      (1,'A','2026-08-01',100000,100000,0,'SI',100000),          -- bien
      (2,'A','2026-09-01',272000,305024.73,0,'SI',136000),       -- bonificación agregada después: total guardado viejo, ya cobrado
      (3,'A','2026-11-01',677863,707863,707863,'0',0),           -- noviembre: seguro contado dos veces
      (4,'A','2026-06-01',100000,999,999,'RESCINDIDO',0),        -- rescindido: no se toca
      (5,'A','2026-10-01',100000,100000,50000,'PARCIAL',50000);  -- bien
    insert into public.pagos_suministros (pago_id,suministro_id,importe) values (3,77,15000);
    insert into public.pagos_extras (pago_id,importe,a_cargo_de,tipo) values (2,136000,'inquilino','credito'), (2,136000,'propietario','debito');
  `);
  await db.exec(leerSql('14_control_saldos.sql'));
  assert.equal((await db.query('select count(*)::int n from public.control_saldos()')).rows[0].n, 2);   // los meses 2 y 3
  await db.exec(leerSql('15_totales_automaticos.sql'));
  assert.equal((await db.query('select count(*)::int n from public.control_saldos()')).rows[0].n, 0);
  const f = (await db.query('select id, total, saldo, pagado from public.pagos order by id')).rows.map(r => [r.id, Number(r.total), Number(r.saldo), r.pagado]);
  assert.deepEqual(f, [
    [1, 100000, 0, 'SI'],
    [2, 136000, 0, 'SI'],              // 272.000 − bonificación 136.000 = 136.000, y estaba cobrado
    [3, 692863, 692863, '0'],          // 677.863 + 15.000 (el seguro una sola vez); sin cobrar, sigue sin cobrar
    [4, 999, 999, 'RESCINDIDO'],
    [5, 100000, 50000, 'PARCIAL']
  ]);
});

test('triggers: cada cambio recalcula el mes (extras, servicios, alquiler, lo abonado)', { skip }, async t => {
  const db = new pglite.PGlite();
  await db.exec(ESQUEMA + `insert into public.contratos values (1,'A'); insert into public.contrato_suministros values (5,1,'epe');`);
  await db.exec(leerSql('14_control_saldos.sql'));
  await db.exec(leerSql('15_totales_automaticos.sql'));
  const mes = async id => (await db.query('select total, saldo, pagado from public.pagos where id=$1', [id])).rows.map(r => [Number(r.total), Number(r.saldo), r.pagado])[0];

  await db.exec(`insert into public.pagos (id,hoja,mes,importe_alquiler,total,saldo,pagado,pagado_importe) values (1,'A','2026-10-01',100000,0,0,'0',0);`);
  await t.test('al crear un mes se calcula solo', async () => assert.deepEqual(await mes(1), [100000, 100000, '0']));
  await t.test('un extra a cargo del inquilino sube el total y el saldo', async () => {
    await db.exec(`insert into public.pagos_extras (pago_id,importe,a_cargo_de,tipo) values (1,30000,'inquilino','debito');`);
    assert.deepEqual(await mes(1), [130000, 130000, '0']);
  });
  await t.test('lo abonado baja el saldo y marca el estado', async () => {
    await db.exec(`update public.pagos set pagado_importe = 50000 where id=1;`);
    assert.deepEqual(await mes(1), [130000, 80000, 'PARCIAL']);
    await db.exec(`update public.pagos set pagado_importe = 130000 where id=1;`);
    assert.deepEqual(await mes(1), [130000, 0, 'SI']);
  });
  await t.test('un descuento agregado DESPUÉS de cobrar deja saldo 0 (nunca negativo)', async () => {
    await db.exec(`insert into public.pagos_extras (pago_id,importe,a_cargo_de,tipo) values (1,20000,'inquilino','credito');`);
    assert.deepEqual(await mes(1), [110000, 0, 'SI']);
  });
  await t.test('borrar un extra revierte el total', async () => {
    await db.exec(`delete from public.pagos_extras where pago_id=1 and tipo='credito';`);
    assert.deepEqual(await mes(1), [130000, 0, 'SI']);
  });
  await t.test('un importe de servicio por cuenta suma la parte del inquilino', async () => {
    // (la pantalla, al revertir un cobro, guarda también el estado '0': se hace igual acá)
    await db.exec(`update public.pagos set pagado_importe = 0, pagado = '0' where id=1; insert into public.pagos_suministros (pago_id,suministro_id,importe,importe_propietario) values (1,5,8000,2000);`);
    assert.deepEqual(await mes(1), [138000, 138000, '0']);
    await db.exec(`update public.pagos_suministros set importe = 9000 where pago_id=1;`);
    assert.deepEqual(await mes(1), [139000, 139000, '0']);
  });
  await t.test('cambiar el alquiler recalcula', async () => {
    await db.exec(`update public.pagos set importe_alquiler = 120000 where id=1;`);
    assert.deepEqual(await mes(1), [159000, 159000, '0']);
  });
  await t.test('un extra que cambia de mes recalcula los dos', async () => {
    await db.exec(`insert into public.pagos (id,hoja,mes,importe_alquiler) values (2,'A','2026-11-01',50000);
                   update public.pagos_extras set pago_id = 2 where pago_id = 1;`);
    assert.deepEqual(await mes(1), [129000, 129000, '0']);
    assert.deepEqual(await mes(2), [80000, 80000, 'NO']);
  });
  await t.test('un mes rescindido no se toca', async () => {
    await db.exec(`update public.pagos set pagado='RESCINDIDO' where id=2; insert into public.pagos_extras (pago_id,importe,a_cargo_de,tipo) values (2,1000,'inquilino','debito');`);
    assert.deepEqual(await mes(2), [80000, 80000, 'RESCINDIDO']);
  });
});

test('triggers == pantalla: tras 400 operaciones al azar, lo guardado coincide con calcularTotal y las reglas de saldo', { skip }, async () => {
  const db = new pglite.PGlite();
  await db.exec(ESQUEMA + `
    insert into public.contratos select g, 'C' || g from generate_series(1, 6) g;
    insert into public.contrato_suministros select g, ((g - 1) / 3) + 1, (array['epe','agua','tgiu'])[((g - 1) % 3) + 1] from generate_series(1, 6) g;`);
  await db.exec(leerSql('14_control_saldos.sql'));
  await db.exec(leerSql('15_totales_automaticos.sql'));
  await db.exec(leerSql('16_blindaje_saldos.sql'));   // el blindaje no debe cambiar ningún resultado

  // Espejo del estado, para calcular con las funciones de la pantalla
  const DB = { contratos: [1, 2, 3, 4, 5, 6].map(i => ({ id: i, hoja: 'C' + i })) };
  const DB_SUMINISTROS = [1, 2, 3, 4, 5, 6].map(g => ({ id: g, contrato_id: Math.floor((g - 1) / 3) + 1, tipo: ['epe', 'agua', 'tgiu'][(g - 1) % 3], pct_inquilino: 100 }));
  const { calcularTotal } = cargar('index.html', ['calcularTotal'], { DB, DB_SUMINISTROS });
  const rnd = semilla(77), elegir = l => l[Math.floor(rnd() * l.length)], plata = m => Math.round(rnd() * m * 100) / 100;
  const pagos = {}, extras = {}, ps = {};
  const NP = 8;

  const esperado = id => {
    const p = pagos[id];
    const psData = Object.keys(ps[id]).length ? Object.fromEntries(Object.entries(ps[id]).map(([k, v]) => [k, { inq: v, prop: 0 }])) : undefined;
    const total = calcularTotal(p, extras[id], psData);
    const saldo = Math.max(0, Math.round((total - (p.pagado_importe || 0)) * 100) / 100);
    const pagado = saldo <= 0 ? 'SI' : ((p.pagado_importe || 0) > 0 ? 'PARCIAL' : (p.pagado || 'NO'));
    return { total, saldo, pagado };
  };
  for (let id = 1; id <= NP; id++) {
    pagos[id] = { id, hoja: 'C' + (((id - 1) % 6) + 1), importe_alquiler: plata(500000), pagado_importe: 0, pagado: '0', monto_seguro: elegir([0, null, plata(20000)]), monto_epe: elegir([0, null, plata(20000)]) };
    extras[id] = []; ps[id] = {};
    await db.query(`insert into public.pagos (id,hoja,mes,importe_alquiler,total,saldo,pagado,pagado_importe,monto_seguro,monto_epe) values ($1,$2,'2026-10-01',$3,0,0,'0',0,$4,$5)`,
      [id, pagos[id].hoja, pagos[id].importe_alquiler, pagos[id].monto_seguro, pagos[id].monto_epe]);
    pagos[id].pagado = esperado(id).pagado;      // el trigger ya lo dejó así
  }

  const fallas = [];
  for (let paso = 1; paso <= 400; paso++) {
    const id = 1 + Math.floor(rnd() * NP), op = Math.floor(rnd() * 8);
    const contrato = ((id - 1) % 6) + 1, cuentasDelContrato = contrato <= 2 ? [1, 2, 3].slice(0, 3) : [];
    if (op === 0) {
      const e = { importe: plata(80000), tipo: elegir(['debito', 'credito', 'descuento', null]), a_cargo_de: elegir(['inquilino', 'propietario', null]) };
      const r = await db.query('insert into public.pagos_extras (pago_id,importe,tipo,a_cargo_de) values ($1,$2,$3,$4) returning id', [id, e.importe, e.tipo, e.a_cargo_de]);
      extras[id].push({ id: r.rows[0].id, ...e });
    } else if (op === 1 && extras[id].length) {
      const e = elegir(extras[id]); e.importe = plata(80000);
      await db.query('update public.pagos_extras set importe=$1 where id=$2', [e.importe, e.id]);
    } else if (op === 2 && extras[id].length) {
      const e = elegir(extras[id]); extras[id] = extras[id].filter(x => x !== e);
      await db.query('delete from public.pagos_extras where id=$1', [e.id]);
    } else if (op === 3) {
      const s = contrato <= 2 ? elegir([1, 2, 3]) : elegir([4, 5, 6]), imp = plata(30000);
      await db.query('delete from public.pagos_suministros where pago_id=$1 and suministro_id=$2', [id, s]);
      await db.query('insert into public.pagos_suministros (pago_id,suministro_id,importe) values ($1,$2,$3)', [id, s, imp]);
      ps[id][s] = imp;
    } else if (op === 4 && Object.keys(ps[id]).length) {
      const s = elegir(Object.keys(ps[id]));
      await db.query('delete from public.pagos_suministros where pago_id=$1 and suministro_id=$2', [id, s]); delete ps[id][s];
    } else if (op === 5) {
      pagos[id].importe_alquiler = plata(500000);
      await db.query('update public.pagos set importe_alquiler=$1 where id=$2', [pagos[id].importe_alquiler, id]);
    } else if (op === 6) {
      pagos[id].pagado_importe = elegir([0, plata(300000), esperado(id).total, esperado(id).total + plata(5000)]);
      await db.query('update public.pagos set pagado_importe=$1 where id=$2', [pagos[id].pagado_importe, id]);
    } else if (op === 7) {
      pagos[id].monto_seguro = elegir([0, null, plata(20000)]);
      await db.query('update public.pagos set monto_seguro=$1 where id=$2', [pagos[id].monto_seguro, id]);
    } else continue;
    const e = esperado(id);
    pagos[id].pagado = e.pagado;
    const g = (await db.query('select total, saldo, pagado from public.pagos where id=$1', [id])).rows[0];
    if (Math.abs(Number(g.total) - e.total) > 0.005 || Math.abs(Number(g.saldo) - e.saldo) > 0.005 || g.pagado !== e.pagado) fallas.push({ paso, op, id, guardado: g, esperado: e });
  }
  assert.deepEqual(fallas.slice(0, 3), []);
  assert.equal((await db.query('select count(*)::int n from public.control_saldos()')).rows[0].n, 0);
});
