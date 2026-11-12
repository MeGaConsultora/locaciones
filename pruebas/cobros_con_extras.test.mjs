// Gestión de Pago cuando un mes tiene extras ya cobrados (commits b3de975 y fbefb33):
//  - lo pagado por un extra no se vuelve a descontar del alquiler ni se muestra como "Pago a cuenta";
//  - revertir un "Pago a cuenta" revierte solo su parte;
//  - revertir un cobro reabre los extras (menos intereses punitorios y los del propietario);
//  - el nombre del extra que se guarda en el historial y en Caja es el concepto real, no "Extra".

import test from 'node:test';
import assert from 'node:assert/strict';
import { cargar, c2, leerHtml } from './helpers.mjs';

const formatMoney = n => '$ ' + Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const REDONDEAR = ['redondear2'];

// ---------- obtenerItemsPendientesGP: lo que falta cobrar de alquiler y servicios ----------
function pendientes() {
  const env = { window: { _pagosSuministros: {} }, DB_SUMINISTROS: [] };
  return cargar('index.html', [...REDONDEAR, 'montoServicioInquilino', 'obtenerItemsPendientesGP'], env).obtenerItemsPendientesGP;
}
const valor = (items, id) => items.find(i => i.id === id)?.val;

// Caso real: Monje-Espíndor nov 2026. Alquiler $277.472 y un extra (EPE convenio cuota 4/6) de $67.780,25.
// Se cobró solo el extra: el saldo es todo el alquiler.
const mes = (extra = {}) => ({ id: 1, hoja: 'Monje-Espindor', mes: '2026-11-01', importe_alquiler: 277472, total: 345252.25, saldo: 277472, pagado: 'PARCIAL', pagado_importe: 67780.25, ...extra });

test('un cobro hecho solo por un extra no se descuenta del alquiler pendiente', () => {
  const obtener = pendientes();
  const conCorreccion = obtener(mes(), 1, 67780.25);
  assert.equal(valor(conCorreccion, 'alquiler'), 277472);               // el alquiler sigue completo
  const sinCorreccion = obtener(mes());                                  // comportamiento anterior (el error)
  assert.equal(valor(sinCorreccion, 'alquiler'), 209691.75);             // faltaban $67.780,25: el error que se vio
});

test('si además se pagó parte del alquiler, solo se descuenta esa parte', () => {
  const obtener = pendientes();
  // pagado 167.780,25 = 100.000 de alquiler + 67.780,25 del extra
  const items = obtener(mes({ saldo: 177472, pagado_importe: 167780.25 }), 1, 67780.25);
  assert.equal(valor(items, 'alquiler'), 177472);
});

test('un mes pagado completo sin desglose por ítem (dato viejo) también descuenta el extra cobrado', () => {
  const obtener = pendientes();
  const p = mes({ saldo: 0, pagado: 'SI', pagado_importe: 345252.25 });
  const items = obtener(p, 1, 67780.25);
  assert.deepEqual(items, []);                                           // nada pendiente
  assert.equal(c2(p.pagado_alquiler), 277472);                           // el alquiler quedó imputado entero, no más
});

test('mes marcado como pagado (saldo 0) sin desglose: lo que pagó el extra no se imputa al alquiler', () => {
  const obtener = pendientes();
  // pagado_importe 167.780,25 = 100.000 de alquiler + 67.780,25 del extra; el alquiler es de 200.000 y el saldo quedó en 0
  const p = mes({ importe_alquiler: 200000, total: 267780.25, saldo: 0, pagado: 'SI', pagado_importe: 167780.25 });
  const items = obtener(p, 1, 67780.25);
  assert.equal(c2(p.pagado_alquiler), 100000);                           // solo lo que pagó el alquiler
  assert.equal(valor(items, 'alquiler'), 100000);
  const sin = obtener(mes({ importe_alquiler: 200000, total: 267780.25, saldo: 0, pagado: 'SI', pagado_importe: 167780.25 }));
  assert.equal(valor(sin, 'alquiler'), 32219.75);                        // sin la corrección se imputaba de más
});

test('sin extras cobrados el reparto es el de siempre (alquiler, EPE, agua… en orden)', () => {
  const obtener = pendientes();
  const p = { id: 2, importe_alquiler: 100000, monto_epe: 20000, total: 120000, saldo: 60000, pagado: 'PARCIAL', pagado_importe: 60000 };
  const items = obtener(p, 1);
  assert.equal(valor(items, 'alquiler'), 40000);                         // 60.000 pagados van al alquiler primero
  assert.equal(valor(items, 'epe'), 20000);
});

// ---------- generarItemsCobro: la pantalla "Ingresar pago" ----------
function pantallaCobro() {
  const env = {
    window: { _pagosSuministros: {} }, DB: { contratos: [] }, DB_SUMINISTROS: [], DB_GASTOS_CUOTAS: [],
    formatMoney, TODAY: '2026-11-04', _gpHoja: 'Monje-Espindor', _gpComision: 8
  };
  return cargar('index.html', [...REDONDEAR, 'calcularTotal', 'montoServicioInquilino', 'obtenerItemsPendientesGP', 'generarItemsCobro'], env).generarItemsCobro;
}
const extra = (id, concepto, importe, tipo = 'debito') => ({ id, concepto, importe, tipo, a_cargo_de: 'inquilino', cobrado: true });

test('un cobro hecho solo por un extra se muestra como el extra, no también como "Pago a cuenta"', () => {
  // Caso real: Bertolino-Rodríguez, indemnización por rescisión de $272.118 cobrada entera.
  const html = pantallaCobro()(
    { id: 5, importe_alquiler: 0, total: 272118, saldo: 0, pagado: 'SI', pagado_importe: 272118 },
    [], 1, '2026-10', 0, [extra(7, 'Indemnización por rescisión', 272118)]);
  assert.match(html, /✓ Indemnización por rescisión — \$\s272\.118,00/);
  assert.doesNotMatch(html, /Pago a cuenta/);
});

test('si hay un pago a cuenta además del extra cobrado, "Pago a cuenta" muestra solo la parte que no es del extra', () => {
  const html = pantallaCobro()(
    { id: 1, importe_alquiler: 277472, total: 345252.25, saldo: 245252.25, pagado: 'PARCIAL', pagado_importe: 100000 },
    [], 1, '2026-11', 0, [extra(9, 'EPE convenio cuota 4/6', 67780.25)]);
  assert.match(html, /✓ Pago a cuenta — \$\s32\.219,75/);                 // 100.000 − 67.780,25
  assert.match(html, /✓ EPE convenio cuota 4\/6 — \$\s67\.780,25/);
  // y el botón de revertir ese pago a cuenta lleva ESA parte, no los 100.000
  assert.match(html, /revertirPagoACuenta\('1','Monje-Espindor',1,'2026-11',8,32219\.75\)/);
});

test('sin extras cobrados, el pago a cuenta es todo lo abonado (como siempre)', () => {
  const html = pantallaCobro()(
    { id: 1, importe_alquiler: 277472, total: 277472, saldo: 177472, pagado: 'PARCIAL', pagado_importe: 100000 },
    [], 1, '2026-11', 0, []);
  assert.match(html, /✓ Pago a cuenta — \$\s100\.000,00/);
  assert.match(html, /revertirPagoACuenta\('1','Monje-Espindor',1,'2026-11',8,100000\)/);
});

test('en la pantalla de cobro, el alquiler pendiente no se achica por lo que pagó un extra', () => {
  const html = pantallaCobro()(
    { id: 1, importe_alquiler: 277472, total: 345252.25, saldo: 277472, pagado: 'PARCIAL', pagado_importe: 67780.25 },
    [], 1, '2026-11', 0, [extra(9, 'EPE convenio cuota 4/6', 67780.25)]);
  assert.match(html, /id="cobro-chk-alquiler" value="277472"/);
  assert.doesNotMatch(html, /209691\.75/);
});

// ---------- revertirPagoACuenta ----------
function armarRevertirACuenta(p, acepta = true) {
  const parches = [], preguntas = [];
  const env = {
    DB: { pagos: [p] }, formatMoney, toast() {}, loadAll: async () => {}, editarMesConSolapa: async () => {},
    confirm: t => { preguntas.push(t); return acepta; },
    sbPatch: async (tabla, id, cambios) => { parches.push([tabla, id, cambios]); }
  };
  const { revertirPagoACuenta } = cargar('index.html', [...REDONDEAR, 'revertirPagoACuenta'], env);
  return { revertirPagoACuenta, parches, preguntas };
}
const conPagado = { id: 1, total: 345252.25, saldo: 245252.25, pagado: 'PARCIAL', pagado_importe: 100000 };

test('revertir un pago a cuenta sin indicar monto revierte todo lo abonado (como siempre)', async () => {
  const t = armarRevertirACuenta({ ...conPagado });
  await t.revertirPagoACuenta('1', 'H', 1, '2026-11', 8);
  assert.deepEqual(t.parches, [['pagos', 1, { pagado_importe: 0, pagado: 'NO', saldo: 345252.25 }]]);
  assert.match(t.preguntas[0], /pago a cuenta de \$\s100\.000,00/);
});

test('revertir solo la parte "a cuenta" deja lo que corresponde al extra cobrado', async () => {
  const t = armarRevertirACuenta({ ...conPagado });
  await t.revertirPagoACuenta('1', 'H', 1, '2026-11', 8, 32219.75);
  // quedan 67.780,25 abonados (el extra) y el saldo es el total menos eso
  assert.deepEqual(t.parches, [['pagos', 1, { pagado_importe: 67780.25, pagado: 'PARCIAL', saldo: 277472 }]]);
  assert.match(t.preguntas[0], /pago a cuenta de \$\s32\.219,75/);
});

test('si la parte a revertir es más que lo abonado, se revierte solo lo abonado', async () => {
  const t = armarRevertirACuenta({ ...conPagado });
  await t.revertirPagoACuenta('1', 'H', 1, '2026-11', 8, 500000);
  assert.deepEqual(t.parches, [['pagos', 1, { pagado_importe: 0, pagado: 'NO', saldo: 345252.25 }]]);
});

test('si se cancela la pregunta, no se toca nada', async () => {
  const t = armarRevertirACuenta({ ...conPagado }, false);
  await t.revertirPagoACuenta('1', 'H', 1, '2026-11', 8, 32219.75);
  assert.deepEqual(t.parches, []);
});

// ---------- revertirCobro: reabre los extras ----------
function armarRevertirCobro({ extrasCobrados, fallaConsultaExtras = false }) {
  const parches = [], borrados = [];
  const p = { id: 58834, hoja: 'Monje-Espindor', mes: '2026-11-01', total: 345252.25, saldo: 0, pagado: 'SI', pagado_importe: 345252.25 };
  const env = {
    DB: { contratos: [] }, DB_GASTOS_CUOTAS: [], formatDate: d => d, toast() {}, confirm: () => true,
    sbGet: async (tabla) => {
      if (tabla === 'pagos') return [p];
      if (tabla === 'pagos_extras') { if (fallaConsultaExtras) throw new Error('sin conexión'); return extrasCobrados; }
      return [];
    },
    sbPatch: async (tabla, id, cambios) => { parches.push([tabla, id, cambios]); },
    sbDeleteWhere: async (tabla, q) => { borrados.push([tabla, q]); },
    revertirRendidoDirectoPropietario: async () => {},
    borrarMovimientosCajaDelCobro: async id => { borrados.push(['caja_movimientos', id]); },
    encodeURIComponent
  };
  const { revertirCobro } = cargar('index.html', ['revertirCobro'], env);
  return { revertirCobro, parches, borrados };
}
const cobrado = (id, concepto, a_cargo_de = 'inquilino') => ({ id, concepto, a_cargo_de });

test('revertir el cobro vuelve a dejar pendientes los extras que se habían cobrado', async () => {
  const t = armarRevertirCobro({ extrasCobrados: [cobrado(1, 'EPE convenio cuota 4/6'), cobrado(4, 'Descuento por demora')] });
  await t.revertirCobro('Monje-Espindor', 4532, '2026-11', 8);
  const reabiertos = t.parches.filter(x => x[0] === 'pagos_extras');
  assert.deepEqual(reabiertos, [['pagos_extras', 1, { cobrado: false }], ['pagos_extras', 4, { cobrado: false }]]);
  // y el mes vuelve a su total, sin nada abonado
  const mesPatch = t.parches.find(x => x[0] === 'pagos');
  assert.equal(mesPatch[2].pagado_importe, 0);
  assert.equal(mesPatch[2].saldo, 345252.25);
});

test('al revertir el cobro, los intereses punitorios y los extras del propietario NO se reabren', async () => {
  const t = armarRevertirCobro({ extrasCobrados: [
    cobrado(1, 'EPE convenio cuota 4/6'), cobrado(2, 'Interés punitorio'), cobrado(3, 'Reparación portón', 'propietario')
  ] });
  await t.revertirCobro('Monje-Espindor', 4532, '2026-11', 8);
  const ids = t.parches.filter(x => x[0] === 'pagos_extras').map(x => x[1]);
  assert.deepEqual(ids, [1]);
});

test('si falla la consulta de extras, el cobro igual se revierte (no queda a medias)', async () => {
  const t = armarRevertirCobro({ extrasCobrados: [], fallaConsultaExtras: true });
  const aviso = console.warn; console.warn = () => {};
  try { await t.revertirCobro('Monje-Espindor', 4532, '2026-11', 8); } finally { console.warn = aviso; }
  assert.ok(t.parches.some(x => x[0] === 'pagos' && x[2].pagado_importe === 0));
  assert.ok(t.borrados.some(b => b[0] === 'movimientos_pagos'));
  assert.ok(t.borrados.some(b => b[0] === 'caja_movimientos'));
});

// ---------- nombre del extra al cobrar ----------
const nodoTexto = t => ({ nodeType: 3, textContent: t });
const nodoElemento = t => ({ nodeType: 1, textContent: t });

test('el nombre del extra es el texto del label, sin el input ni el "(débito)"', () => {
  const { nombreExtraDeLabel } = cargar('index.html', ['nombreExtraDeLabel']);
  const label = { childNodes: [nodoTexto('\n        '), nodoElemento(''), nodoTexto('\n        EPE convenio cuota 4/6 '), nodoElemento('(débito)'), nodoTexto('\n      ')] };
  assert.equal(nombreExtraDeLabel(label), 'EPE convenio cuota 4/6');
});

test('sin texto en el label (o sin label), el nombre es "Extra"', () => {
  const { nombreExtraDeLabel } = cargar('index.html', ['nombreExtraDeLabel']);
  assert.equal(nombreExtraDeLabel({ childNodes: [nodoElemento(''), nodoTexto('   \n  ')] }), 'Extra');
  assert.equal(nombreExtraDeLabel(null), 'Extra');
  assert.equal(nombreExtraDeLabel(undefined), 'Extra');
});

test('lo que dibuja la pantalla de cobro y lo que lee el cobro coinciden: sale el concepto real del extra', () => {
  // Se toma el <label> que arma generarItemsCobro y se lo parte en nodos como lo hace el navegador:
  // los textos que están directamente dentro del label son nodos de texto; lo de adentro de <span> no.
  const generar = pantallaCobro();
  const html = generar({ id: 1, importe_alquiler: 277472, total: 345252.25, saldo: 345252.25, pagado: 'NO', pagado_importe: 0 },
    [{ id: 11, concepto: 'EPE convenio cuota 4/6', importe: 67780.25, tipo: 'debito', a_cargo_de: 'inquilino' }], 1, '2026-11', 0, []);
  const label = /<label[^>]*>\s*<input[^>]*id="cobro-chk-extra-11"[\s\S]*?<\/label>/.exec(html)[0];
  const nodos = []; let profundidad = 0;
  for (const trozo of label.split(/(<[^>]+>)/).filter(x => x !== '')) {
    if (trozo.startsWith('</')) profundidad--;
    else if (trozo.startsWith('<')) { if (!/^<(input|br)\b/.test(trozo) && !trozo.endsWith('/>')) profundidad++; nodos.push({ nodeType: 1, textContent: '' }); }
    else if (profundidad === 1) nodos.push({ nodeType: 3, textContent: trozo });
  }
  // profundidad 1 = hijos directos del <label> (el propio <label> abre en 0→1)
  const { nombreExtraDeLabel } = cargar('index.html', ['nombreExtraDeLabel']);
  assert.equal(nombreExtraDeLabel({ childNodes: nodos }), 'EPE convenio cuota 4/6');
});

test('guarda: el nombre del extra no se vuelve a leer por posición (childNodes[1] era el input)', () => {
  const src = leerHtml('index.html');
  assert.ok(!src.includes('childNodes?.[1]?.textContent'), 'no leer el nombre por posición del nodo');
});
