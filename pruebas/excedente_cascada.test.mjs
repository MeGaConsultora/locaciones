// Excedente que pasa al mes siguiente (distribuirExcedenteEnCascada): se imputa a los ítems del mes siguiente
// con el importe real de cada servicio (pagos_suministros), no solo con el campo viejo monto_xxx.
// Caso real: Aguinaga-Uviedo mar 2026 — $11.751,37 de excedente quedaron sumados al abonado pero sin ítem, y la
// lista de pendientes de "Ingresar Pago" no los descontaba (Total a cobrar $11.751,37 por encima del saldo).

import test from 'node:test';
import assert from 'node:assert/strict';
import { cargar } from './helpers.mjs';

const SUMINISTROS = [
  { id: 808, contrato_id: 4334, tipo: 'epe', pct_inquilino: 100 },
  { id: 809, contrato_id: 4334, tipo: 'agua', pct_inquilino: 100 },
  { id: 810, contrato_id: 4334, tipo: 'tgiu', pct_inquilino: 100 },
  { id: 1037, contrato_id: 4334, tipo: 'seguro', pct_inquilino: 100 },
];

function armar({ mesSiguiente, filasServicios = [], suministros = SUMINISTROS }) {
  const parches = [], altas = [];
  const env = {
    DB_SUMINISTROS: suministros,
    sbGet: async (tabla) => {
      if (tabla === 'pagos') return [mesSiguiente];
      if (tabla === 'pagos_suministros') return filasServicios;
      return [];
    },
    sbPatch: async (tabla, id, cambios) => { parches.push([tabla, id, cambios]); },
    sbPost: async (tabla, fila) => { altas.push([tabla, fila]); },
    decodeURIComponent, formatMoney: n => String(n)
  };
  const { distribuirExcedenteEnCascada } = cargar('index.html', ['montoServicioInquilino', 'distribuirExcedenteEnCascada'], env);
  return { distribuir: distribuirExcedenteEnCascada, parches, altas };
}

// Marzo 2026 de Aguinaga-Uviedo: sin alquiler cargado, servicios en las cuentas nuevas, $50.000 ya pagados de EPE.
const marzo = () => ({ id: 55975, hoja: 'Aguinaga-Uviedo', mes: '2026-03-01', total: 294537.53, pagado_importe: 50000, pagado_epe: 50000, pagado: 'PARCIAL', importe_alquiler: 0 });
const filasMarzo = [
  { suministro_id: 810, importe: 19604, importe_propietario: 0 },
  { suministro_id: 809, importe: 66632.53, importe_propietario: 0 },
  { suministro_id: 808, importe: 175801, importe_propietario: 0 },
  { suministro_id: 1037, importe: 32500, importe_propietario: 0 },
];

test('el excedente se imputa a los servicios del mes siguiente aunque el campo viejo esté en 0', async () => {
  const t = armar({ mesSiguiente: marzo(), filasServicios: filasMarzo });
  const r = await t.distribuir('Aguinaga-Uviedo', '2026-02-01', 11751.37, 4334);
  assert.equal(r.restante, 0);
  const patch = t.parches.find(x => x[0] === 'pagos' && x[1] === 55975)[2];
  assert.equal(patch.pagado_epe, 61751.37);                 // 50.000 + 11.751,37: el EPE es el primer ítem con deuda
  assert.equal(patch.pagado_importe, 61751.37);
  assert.equal(patch.saldo, 232786.16);
  const mov = t.altas.find(a => a[0] === 'movimientos_pagos')[1];
  assert.deepEqual(JSON.parse(mov.items), [{ label: 'EPE', monto: 11751.37 }]);   // antes: []
});

test('un excedente mayor que lo que falta de un ítem sigue con el siguiente ítem', async () => {
  const sig = { ...marzo(), pagado_importe: 170000, pagado_epe: 170000 };              // al EPE le faltan $5.801
  const t = armar({ mesSiguiente: sig, filasServicios: filasMarzo });
  await t.distribuir('Aguinaga-Uviedo', '2026-02-01', 20000, 4334);
  const patch = t.parches.find(x => x[0] === 'pagos' && x[1] === 55975)[2];
  assert.equal(patch.pagado_epe, 175801);                    // completa el EPE
  assert.equal(patch.pagado_agua, 14199);                    // y el resto va al agua
});

test('contrato sin cuentas reales (sistema viejo): sigue usando el campo viejo monto_xxx', async () => {
  const sig = { id: 9, hoja: 'Viejo-Contrato', mes: '2026-03-01', total: 120000, pagado_importe: 0, pagado: '0', importe_alquiler: 100000, monto_epe: 20000 };
  const t = armar({ mesSiguiente: sig, suministros: [] });
  await t.distribuir('Viejo-Contrato', '2026-02-01', 110000, 777);
  const patch = t.parches.find(x => x[0] === 'pagos' && x[1] === 9)[2];
  assert.equal(patch.pagado_alquiler, 100000);
  assert.equal(patch.pagado_epe, 10000);
});

test('si no se pueden leer los servicios del mes siguiente, el excedente igual se acredita (no se pierde)', async () => {
  const t = armar({ mesSiguiente: marzo(), filasServicios: filasMarzo });
  const aviso = console.warn; console.warn = () => {};
  const sbGetOriginal = t;                                   // el mock de abajo falla solo para pagos_suministros
  try {
    const env = {
      DB_SUMINISTROS: SUMINISTROS,
      sbGet: async tabla => { if (tabla === 'pagos') return [marzo()]; throw new Error('sin conexión'); },
      sbPatch: async (tabla, id, cambios) => { sbGetOriginal.parches.push([tabla, id, cambios]); },
      sbPost: async () => {}, decodeURIComponent, formatMoney: String
    };
    const { distribuirExcedenteEnCascada } = cargar('index.html', ['montoServicioInquilino', 'distribuirExcedenteEnCascada'], env);
    await distribuirExcedenteEnCascada('Aguinaga-Uviedo', '2026-02-01', 11751.37, 4334);
  } finally { console.warn = aviso; }
  const patch = t.parches.find(x => x[0] === 'pagos')[2];
  assert.equal(patch.pagado_importe, 61751.37);              // el abonado sube igual
});
