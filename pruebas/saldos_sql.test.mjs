// Prueba "diferencial": el total de un mes calculado en la BASE (14_control_saldos.sql) tiene que dar
// EXACTAMENTE lo mismo que el cálculo de la pantalla (calcularTotal en index.html), para cientos de
// combinaciones al azar (servicios por cuenta y viejos, extras de todos los tipos, contratos que
// existen o no...). Si alguna vez difieren, uno de los dos cálculos cambió y hay que revisarlo.
//   Requiere PGlite: npm install --no-save @electric-sql/pglite   (si no está, se saltea)

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { RAIZ, cargar, c2 } from './helpers.mjs';

const pglite = await import('@electric-sql/pglite').catch(() => null);
const skip = pglite ? false : 'PGlite no está instalado (npm install --no-save @electric-sql/pglite)';

// Generador pseudoaleatorio con semilla fija: la prueba es siempre la misma
const semilla = s => () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
const TIPOS = ['epe', 'agua', 'tgiu', 'seguro', 'internet', 'expensas'];

test('total calculado en la base == total calculado en pantalla (500 casos al azar)', { skip }, async () => {
  const db = new pglite.PGlite();
  await db.exec(`
    create role anon; create role authenticated;   -- como en Supabase
    create table public.contratos (id integer primary key, hoja text);
    create table public.contrato_suministros (id integer primary key, contrato_id integer, tipo text, pct_inquilino numeric);
    create table public.pagos (id integer primary key, hoja text, mes date, importe_alquiler numeric, total numeric, saldo numeric, pagado text, pagado_importe numeric,
      monto_epe numeric, monto_agua numeric, monto_tgiu numeric, monto_seguro numeric, monto_internet numeric, monto_expensas numeric);
    create table public.pagos_extras (id serial primary key, pago_id integer, concepto text, importe numeric, a_cargo_de text, tipo text);
    create table public.pagos_suministros (id serial primary key, pago_id integer, suministro_id integer, importe numeric, importe_propietario numeric);
  `);
  await db.exec(fs.readFileSync(path.join(RAIZ, 'sql_historial_local', '14_control_saldos.sql'), 'utf8'));

  // Entorno de la pantalla (se va llenando caso por caso)
  const DB = { contratos: [] }, DB_SUMINISTROS = [];
  const { calcularTotal } = cargar('index.html', ['calcularTotal'], { DB, DB_SUMINISTROS });

  const rnd = semilla(20261022);
  const entre = (a, b) => a + rnd() * (b - a);
  const plata = (max) => Math.round(entre(0, max) * 100) / 100;
  const elegir = lista => lista[Math.floor(rnd() * lista.length)];
  const distintos = [];
  let sumId = 1, extraId = 1;

  for (let n = 1; n <= 500; n++) {
    const hoja = 'Contrato-' + n, contratoId = n;
    const existeContrato = rnd() < 0.9;
    if (existeContrato) { DB.contratos.push({ id: contratoId, hoja }); await db.query('insert into public.contratos values ($1,$2)', [contratoId, hoja]); }

    // cuentas de servicio del contrato y sus importes del mes
    const cuentas = TIPOS.filter(() => rnd() < 0.45).map(tipo => ({ id: sumId++, tipo }));
    for (const c of cuentas) { DB_SUMINISTROS.push({ id: c.id, contrato_id: contratoId, tipo: c.tipo, pct_inquilino: 100 }); await db.query('insert into public.contrato_suministros values ($1,$2,$3,100)', [c.id, contratoId, c.tipo]); }
    const conImportes = rnd() < 0.7 ? cuentas.filter(() => rnd() < 0.8) : [];
    const psData = {};
    for (const c of conImportes) {
      const inq = rnd() < 0.1 ? null : plata(80000), prop = plata(20000);
      psData[c.id] = { inq, prop };
      await db.query('insert into public.pagos_suministros (pago_id,suministro_id,importe,importe_propietario) values ($1,$2,$3,$4)', [n, c.id, inq, prop]);
    }
    // una fila de importes que apunta a una cuenta que no existe (pasa con datos viejos)
    if (rnd() < 0.1) { const inq = plata(5000); psData[99999 + n] = { inq, prop: 0 }; await db.query('insert into public.pagos_suministros (pago_id,suministro_id,importe,importe_propietario) values ($1,$2,$3,0)', [n, 99999 + n, inq]); }

    // campos viejos (null, 0, positivos y alguno negativo = descuento real)
    const viejos = {};
    for (const t of TIPOS) viejos['monto_' + t] = elegir([null, 0, plata(60000), plata(60000), -plata(3000)]);
    const alquiler = rnd() < 0.05 ? 0 : plata(600000);
    const p = { id: n, hoja, importe_alquiler: alquiler, ...viejos };

    // extras de todos los tipos
    const extras = [];
    for (let k = 0; k < Math.floor(rnd() * 4); k++) {
      extras.push({ importe: rnd() < 0.05 ? null : plata(90000), tipo: elegir(['debito', 'credito', 'descuento', null, 'cargo']), a_cargo_de: elegir(['inquilino', 'inquilino', 'propietario', null]) });
    }

    await db.query(`insert into public.pagos (id,hoja,mes,importe_alquiler,total,saldo,pagado,pagado_importe,monto_epe,monto_agua,monto_tgiu,monto_seguro,monto_internet,monto_expensas)
                    values ($1,$2,'2026-10-01',$3,0,0,'0',0,$4,$5,$6,$7,$8,$9)`,
      [n, hoja, alquiler, viejos.monto_epe, viejos.monto_agua, viejos.monto_tgiu, viejos.monto_seguro, viejos.monto_internet, viejos.monto_expensas]);
    for (const e of extras) await db.query('insert into public.pagos_extras (pago_id,importe,a_cargo_de,tipo) values ($1,$2,$3,$4)', [n, e.importe, e.a_cargo_de, e.tipo]);

    const enPantalla = calcularTotal(p, extras, Object.keys(psData).length ? psData : undefined);
    const enBase = Number((await db.query('select public.total_calculado_pago($1) as t', [n])).rows[0].t);
    if (Math.abs(c2(enPantalla) - c2(enBase)) > 0.005) distintos.push({ n, enPantalla, enBase });
  }
  assert.deepEqual(distintos.slice(0, 5), [], `${distintos.length} caso(s) donde la base y la pantalla no coinciden`);
});

test('control_saldos: encuentra los meses donde lo guardado no coincide con lo calculado', { skip }, async () => {
  const db = new pglite.PGlite();
  await db.exec(`
    create role anon; create role authenticated;   -- como en Supabase
    create table public.contratos (id integer primary key, hoja text);
    create table public.contrato_suministros (id integer primary key, contrato_id integer, tipo text);
    create table public.pagos (id integer primary key, hoja text, mes date, importe_alquiler numeric, total numeric, saldo numeric, pagado text, pagado_importe numeric,
      monto_epe numeric, monto_agua numeric, monto_tgiu numeric, monto_seguro numeric, monto_internet numeric, monto_expensas numeric);
    create table public.pagos_extras (id serial primary key, pago_id integer, concepto text, importe numeric, a_cargo_de text, tipo text);
    create table public.pagos_suministros (id serial primary key, pago_id integer, suministro_id integer, importe numeric, importe_propietario numeric);
    insert into public.contratos values (1,'A');
    insert into public.pagos (id,hoja,mes,importe_alquiler,total,saldo,pagado,pagado_importe) values
      (1,'A','2026-08-01',100000,100000,0,'SI',100000),        -- coincide
      (2,'A','2026-09-01',100000,100000,50000,'PARCIAL',50000),-- coincide
      (3,'A','2026-10-01',100000,100000,0,'SI',100000),        -- a este mes se le cargó un extra DESPUÉS y el total guardado quedó viejo
      (4,'A','2026-11-01',100000,100000,100000,'0',0),         -- el saldo guardado quedó mal
      (5,'A','2026-06-01',100000,100000,100000,'RESCINDIDO',0);-- rescindido: no se controla
    insert into public.pagos_extras (pago_id,importe,a_cargo_de,tipo) values (3,30000,'inquilino','debito');
    update public.pagos set saldo = 20000 where id = 4;
  `);
  await db.exec(fs.readFileSync(path.join(RAIZ, 'sql_historial_local', '14_control_saldos.sql'), 'utf8'));
  const dif = (await db.query('select pago_id, dif_total, dif_saldo from public.control_saldos()')).rows.map(r => [Number(r.pago_id), Number(r.dif_total), Number(r.dif_saldo)]);
  assert.deepEqual(dif, [[4, 0, 80000], [3, 30000, 30000]]);   // ordenado de mayor a menor diferencia
  assert.equal((await db.query('select count(*)::int n from public.control_saldos(false)')).rows[0].n, 4);   // todos menos el rescindido
});
