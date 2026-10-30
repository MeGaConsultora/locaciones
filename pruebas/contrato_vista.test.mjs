// Pantalla de contrato (vista nueva): la preferencia de vista y la barra de vigencia.

import test from 'node:test';
import assert from 'node:assert/strict';
import { cargar } from './helpers.mjs';

const fechaCorta = (d, conDia) => d.substring(0, 10);   // formatDate simplificado: acá solo importa que no rompa
function armar(hoy, almacen = {}) {
  const localStorage = {
    getItem: k => (k in almacen ? almacen[k] : null),
    setItem: (k, v) => { almacen[k] = String(v); },
  };
  return cargar('index.html', ['vistaContratoNueva', 'cambiarVistaContrato', 'cnBarraVigencia', 'cnVistaMeses', 'cnCambiarVistaMeses'],
    { localStorage, TODAY: hoy, formatDate: fechaCorta, contratoActual: null, openContrato() {}, document: { getElementById: () => null, querySelectorAll: () => [] }, ajustarZoomGrilla() {} });
}

test('la vista nueva es la de arranque, y se puede volver a la clásica y a la nueva', () => {
  const almacen = {};
  const f = armar('2026-10-30', almacen);
  assert.equal(f.vistaContratoNueva(), true);
  f.cambiarVistaContrato('clasica');
  assert.equal(almacen.mega_vista_contrato, 'clasica');
  assert.equal(f.vistaContratoNueva(), false);
  f.cambiarVistaContrato('nueva');
  assert.equal(f.vistaContratoNueva(), true);
});

test('si el navegador no deja guardar preferencias, igual arranca en la vista nueva', () => {
  const f = cargar('index.html', ['vistaContratoNueva'], { localStorage: { getItem() { throw new Error('bloqueado'); } } });
  assert.equal(f.vistaContratoNueva(), true);
});

test('la tira es la vista de meses por defecto y recuerda la elección', () => {
  const almacen = {};
  const f = armar('2026-10-30', almacen);
  assert.equal(f.cnVistaMeses(), 'tira');
  f.cnCambiarVistaMeses('tabla');
  assert.equal(almacen.mega_vista_meses, 'tabla');
  assert.equal(f.cnVistaMeses(), 'tabla');
  f.cnCambiarVistaMeses('tira');
  assert.equal(f.cnVistaMeses(), 'tira');
});

test('barra de vigencia: cuánto falta, mañana, hoy, venció, rescindido', () => {
  const c = (hasta, extra = {}) => ({ vigencia_desde: '2025-12-01', vigencia_hasta: hasta, ...extra });
  const f = armar('2026-10-30');
  assert.match(f.cnBarraVigencia(c('2026-11-30')), /Vence en 31 días/);
  assert.match(f.cnBarraVigencia(c('2026-10-31')), /Vence mañana/);
  assert.match(f.cnBarraVigencia(c('2026-10-30')), /Vence hoy/);
  assert.match(f.cnBarraVigencia(c('2026-10-29')), /Venció ayer/);
  assert.match(f.cnBarraVigencia(c('2026-10-20')), /Venció hace 10 días/);
  assert.match(f.cnBarraVigencia(c('2027-02-28', { fecha_rescision: '2026-09-30' })), /Rescindido 2026-09-30/);
  assert.equal(f.cnBarraVigencia({ vigencia_desde: '2025-12-01', vigencia_hasta: null }), '');
});

test('barra de vigencia: el avance va de 0 a 100 aunque la fecha esté fuera del contrato', () => {
  const ancho = h => Number(/width:([\d.]+)%/.exec(h)[1]);
  assert.equal(ancho(armar('2025-01-01').cnBarraVigencia({ vigencia_desde: '2025-12-01', vigencia_hasta: '2026-11-30' })), 0);
  assert.equal(ancho(armar('2030-01-01').cnBarraVigencia({ vigencia_desde: '2025-12-01', vigencia_hasta: '2026-11-30' })), 100);
  const medio = ancho(armar('2026-06-01').cnBarraVigencia({ vigencia_desde: '2025-12-01', vigencia_hasta: '2026-11-30' }));
  assert.ok(medio > 40 && medio < 60, `a mitad de contrato debería rondar el 50%, dio ${medio}`);
});

// --- Tira de meses: qué se ve (mes corriente, deuda anterior, meses siguientes con importes) ---
// r = un mes tal como lo arma renderGrilla; solo se completan los campos que usa la regla
const mes = (m, extra = {}) => ({ p: { mes: m + '-01', pagado: 'SI', importe_alquiler: 0 }, saldoReal: 0, total: 0, servicios: [], extrasGral: [], extrasMes: [], ...extra });
const pagado = m => mes(m, { total: 100000, p: { mes: m + '-01', pagado: 'SI', importe_alquiler: 100000 } });
const debe = (m, saldoReal, pagadoEstado = 'PARCIAL') => mes(m, { saldoReal, total: 100000, p: { mes: m + '-01', pagado: pagadoEstado, importe_alquiler: 100000 } });
const cargado = m => mes(m, { total: 100000, p: { mes: m + '-01', pagado: 'NO', importe_alquiler: 100000 } });
const vacio = m => mes(m);
const claves = r => r.map(x => x.p.mes.substring(0, 7));
const { cnPartirMeses, cnMesPorDefecto } = cargar('index.html', ['cnPartirMeses', 'cnMesPorDefecto']);
const HOY = '2026-10';

test('anteriores al corriente: ocultos, salvo los que tienen deuda; el corriente siempre se ve', () => {
  const orden = [pagado('2026-06'), pagado('2026-07'), debe('2026-08', 80000), pagado('2026-09'), pagado('2026-10')];
  const r = cnPartirMeses(orden, HOY, HOY, false, false);
  assert.deepEqual(claves(r.visibles), ['2026-08', '2026-10']);
  assert.deepEqual(claves(r.ocultosAnt), ['2026-06', '2026-07', '2026-09']);
  assert.deepEqual(claves(r.ocultosSig), []);
});

test('sin deuda anterior, arranca solo con el mes corriente', () => {
  const orden = [pagado('2026-08'), pagado('2026-09'), pagado('2026-10'), vacio('2026-11'), vacio('2026-12')];
  const r = cnPartirMeses(orden, HOY, HOY, false, false);
  assert.deepEqual(claves(r.visibles), ['2026-10']);
  assert.deepEqual(claves(r.ocultosAnt), ['2026-08', '2026-09']);
  assert.deepEqual(claves(r.ocultosSig), ['2026-11', '2026-12']);
});

test('después del corriente se ven los meses con importes cargados (alquiler, servicios o extras del inquilino)', () => {
  const conExtra = mes('2026-12', { extrasMes: [['Reparación', 5000, 'debito']] });
  const conServicio = mes('2027-01', { servicios: [['TGIU', 9000]] });
  const orden = [pagado('2026-10'), cargado('2026-11'), conExtra, conServicio, vacio('2027-02'), vacio('2027-03')];
  const r = cnPartirMeses(orden, HOY, HOY, false, false);
  assert.deepEqual(claves(r.visibles), ['2026-10', '2026-11', '2026-12', '2027-01']);
  assert.deepEqual(claves(r.ocultosSig), ['2027-02', '2027-03']);
});

test('los botones "Meses anteriores" y "Meses siguientes" muestran todo lo plegado', () => {
  const orden = [pagado('2026-08'), pagado('2026-09'), pagado('2026-10'), cargado('2026-11'), vacio('2026-12')];
  assert.equal(cnPartirMeses(orden, HOY, HOY, true, false).visibles.length, 4);
  assert.equal(cnPartirMeses(orden, HOY, HOY, false, true).visibles.length, 3);   // el corriente y los dos siguientes
  assert.equal(cnPartirMeses(orden, HOY, HOY, true, true).visibles.length, 5);
});

test('una deuda vieja nunca queda escondida, venga de donde venga', () => {
  const orden = [debe('2024-01', 1500), pagado('2024-02'), pagado('2025-05'), pagado('2026-10')];
  const r = cnPartirMeses(orden, HOY, HOY, false, false);
  assert.ok(claves(r.visibles).includes('2024-01'));
  assert.ok(r.ocultosAnt.every(x => !(x.saldoReal > 0.01)), 'entre los ocultos no puede haber deuda');
});

test('no cuentan como deuda los rescindidos ni los centavos de redondeo', () => {
  const orden = [mes('2026-05', { saldoReal: 0.004 }), debe('2026-06', 5000, 'RESCINDIDO'), pagado('2026-10')];
  const r = cnPartirMeses(orden, HOY, HOY, false, false);
  assert.deepEqual(claves(r.visibles), ['2026-10']);
  assert.deepEqual(claves(r.ocultosAnt), ['2026-05', '2026-06']);
});

test('un mes rescindido no cuenta como mes con importes aunque le queden servicios sueltos', () => {
  const resc = mes('2026-11', { servicios: [['TGIU', 8000]], p: { mes: '2026-11-01', pagado: 'RESCINDIDO', importe_alquiler: 0 } });
  const r = cnPartirMeses([pagado('2026-10'), resc], HOY, HOY, false, false);
  assert.deepEqual(claves(r.visibles), ['2026-10']);
  assert.deepEqual(claves(r.ocultosSig), ['2026-11']);
});

test('contrato que todavía no empezó o que ya terminó: la referencia es el primer o el último mes', () => {
  const futuro = [cargado('2027-01'), cargado('2027-02'), vacio('2027-03')];
  const a = cnMesPorDefecto(claves(futuro), HOY);
  assert.equal(a, '2027-01');
  assert.deepEqual(claves(cnPartirMeses(futuro, a, HOY, false, false).visibles), ['2027-01', '2027-02']);
  const terminado = [pagado('2026-05'), pagado('2026-06'), pagado('2026-07')];
  const b = cnMesPorDefecto(claves(terminado), HOY);
  assert.equal(b, '2026-07');
  assert.deepEqual(claves(cnPartirMeses(terminado, b, HOY, false, false).visibles), ['2026-07']);
});

test('mes que arranca elegido: el corriente; si no existe, el último anterior; si no, el primero', () => {
  assert.equal(cnMesPorDefecto(['2026-09', '2026-10', '2026-11'], '2026-10'), '2026-10');
  assert.equal(cnMesPorDefecto(['2026-06', '2026-07', '2026-12'], '2026-10'), '2026-07');
  assert.equal(cnMesPorDefecto(['2027-01', '2027-02'], '2026-10'), '2027-01');
  assert.equal(cnMesPorDefecto([], '2026-10'), null);
});
