// Revertir un cobro con honorarios (caso real: Goitre-Pennacino nov 2026, cuota de $138.097,36 que quedó
// cobrada sin historial ni Caja y no se podía revertir):
//  - las cuotas de honorarios se descuentan ANTES de borrar el historial y la Caja, así que si fallan
//    no queda un cobro "huérfano";
//  - si la cuota no está en memoria se lee de la base en vez de saltearla en silencio;
//  - sin movimiento de honorarios en este cobro, no se pone en 0 una cuota que se pudo haber cobrado en otro;
//  - revertirHonorarios: sin ningún movimiento revierte la cuota del mes en vez de abortar.

import test from 'node:test';
import assert from 'node:assert/strict';
import { cargar } from './helpers.mjs';

function armar({ movsHonorarios = [], cuotasMemoria = [], cuotasBase = [], fallaPatchCuota = false }) {
  const orden = [];
  const p = { id: 59648, hoja: 'Goitre-Pennacino', mes: '2026-11-01', total: 747855.64, saldo: 0, pagado: 'SI', pagado_importe: 747855.64 };
  const env = {
    DB: { contratos: [] }, DB_GASTOS_CUOTAS: cuotasMemoria, formatDate: d => d, toast() {}, confirm: () => true,
    sbGet: async (tabla, q) => {
      if (tabla === 'pagos') return [p];
      if (tabla === 'movimientos_pagos') return movsHonorarios;
      if (tabla === 'gastos_inicio_cuotas') return cuotasBase.filter(c => q.includes(`id=eq.${c.id}`));
      return [];
    },
    sbPatch: async (tabla, id, cambios) => {
      if (tabla === 'gastos_inicio_cuotas' && fallaPatchCuota) throw new Error('falló');
      orden.push([tabla, id, cambios]);
    },
    sbDeleteWhere: async (tabla) => { orden.push(['borrar:' + tabla]); },
    revertirRendidoDirectoPropietario: async () => {},
    borrarMovimientosCajaDelCobro: async () => { orden.push(['borrar:caja_movimientos']); },
    encodeURIComponent
  };
  const { revertirCobro } = cargar('index.html', ['revertirCobro'], env);
  return { revertirCobro, orden, p };
}
const movHon = cuotas => ({ id: 1, concepto: 'Honorarios', monto: 138097.36, items: JSON.stringify([{ label: 'Honorarios', monto: 138097.36, cuotas }]) });
const posicion = (orden, pred) => orden.findIndex(pred);

test('las cuotas de honorarios se descuentan antes de borrar el historial y la Caja', async () => {
  const cuota = { id: 1333, contrato_id: 4562, mes: '2026-11-01', monto_inquilino: 141000, pagado_inquilino: 138097.36 };
  const t = armar({ movsHonorarios: [movHon([{ cuota_id: 1333, mes: '2026-11-01', monto: 138097.36 }])], cuotasMemoria: [cuota] });
  await t.revertirCobro('Goitre-Pennacino', 4562, '2026-11', 8);
  const iCuota = posicion(t.orden, x => x[0] === 'gastos_inicio_cuotas');
  assert.ok(iCuota >= 0, 'se descontó la cuota');
  assert.equal(t.orden[iCuota][2].pagado_inquilino, 0);
  assert.ok(iCuota < posicion(t.orden, x => x[0] === 'borrar:movimientos_pagos'));
  assert.ok(iCuota < posicion(t.orden, x => x[0] === 'borrar:caja_movimientos'));
});

test('si falla el descuento de la cuota, no se borra nada más (no queda un cobro sin registro)', async () => {
  const cuota = { id: 1333, contrato_id: 4562, mes: '2026-11-01', monto_inquilino: 141000, pagado_inquilino: 138097.36 };
  const t = armar({ movsHonorarios: [movHon([{ cuota_id: 1333, mes: '2026-11-01', monto: 138097.36 }])], cuotasMemoria: [cuota], fallaPatchCuota: true });
  await t.revertirCobro('Goitre-Pennacino', 4562, '2026-11', 8);
  assert.deepEqual(t.orden, []);                                     // ni el mes, ni el historial, ni la Caja
});

test('una cuota que no está en memoria se lee de la base y se descuenta igual', async () => {
  const cuota = { id: 1333, contrato_id: 4562, mes: '2026-11-01', monto_inquilino: 141000, pagado_inquilino: 138097.36 };
  const t = armar({ movsHonorarios: [movHon([{ cuota_id: 1333, mes: '2026-11-01', monto: 138097.36 }])], cuotasMemoria: [], cuotasBase: [cuota] });
  await t.revertirCobro('Goitre-Pennacino', 4562, '2026-11', 8);
  const patch = t.orden.find(x => x[0] === 'gastos_inicio_cuotas');
  assert.deepEqual(patch, ['gastos_inicio_cuotas', 1333, { pagado_inquilino: 0 }]);
});

test('sin movimiento de honorarios en este cobro, no se pone en 0 la cuota del mes', async () => {
  const cuota = { id: 1333, contrato_id: 4562, mes: '2026-11-01', monto_inquilino: 141000, pagado_inquilino: 50000 };
  const t = armar({ movsHonorarios: [], cuotasMemoria: [cuota] });
  await t.revertirCobro('Goitre-Pennacino', 4562, '2026-11', 8);
  assert.equal(t.orden.some(x => x[0] === 'gastos_inicio_cuotas'), false);
  assert.equal(cuota.pagado_inquilino, 50000);
});

test('un movimiento de honorarios viejo (sin detalle por cuota) revierte la cuota del mes como mejor estimación', async () => {
  const cuota = { id: 1333, contrato_id: 4562, mes: '2026-11-01', monto_inquilino: 141000, pagado_inquilino: 100000 };
  const viejo = { id: 2, concepto: 'Honorarios', monto: 100000, items: JSON.stringify([{ label: 'Honorarios', monto: 100000 }]) };
  const t = armar({ movsHonorarios: [viejo], cuotasMemoria: [cuota] });
  await t.revertirCobro('Goitre-Pennacino', 4562, '2026-11', 8);
  assert.deepEqual(t.orden.find(x => x[0] === 'gastos_inicio_cuotas'), ['gastos_inicio_cuotas', 1333, { pagado_inquilino: 0 }]);
});

// ---------- revertirHonorarios: cobro sin ningún registro ----------
test('revertirHonorarios: si no hay movimientos, revierte la cuota del mes en vez de abortar', async () => {
  const cuota = { id: 1333, contrato_id: 4562, mes: '2026-11-01', monto_inquilino: 141000, pagado_inquilino: 138097.36 };
  const parches = [], avisos = [];
  const env = {
    DB_GASTOS_CUOTAS: [cuota], formatMoney: n => String(n), formatDate: d => d, confirm: () => true,
    toast: (m, tipo) => avisos.push([m, tipo]),
    sbGet: async tabla => tabla === 'pagos' ? [{ id: 59648 }] : [],
    sbPatch: async (tabla, id, cambios) => { parches.push([tabla, id, cambios]); },
    sbDeleteWhere: async () => {}, editarMesConSolapa: async () => {}, encodeURIComponent
  };
  const { revertirHonorarios } = cargar('index.html', ['revertirHonorarios'], env);
  await revertirHonorarios(4562, 'Goitre-Pennacino', '2026-11', 8);
  assert.deepEqual(parches, [['gastos_inicio_cuotas', 1333, { pagado_inquilino: 0 }]]);
  assert.equal(avisos.some(a => a[1] === 'error'), false);
});
