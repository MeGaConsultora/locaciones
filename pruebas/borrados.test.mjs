// Borrados que tocan Caja: revertir un cobro no se lleva los pagos al propietario, y eliminar un mes / un
// contrato / rescindir avisan (o protegen) cuando ya hay una rendición al propietario.

import test from 'node:test';
import assert from 'node:assert/strict';
import { cargar, extraerFuncion, leerHtml } from './helpers.mjs';

const formatMoney = n => '$ ' + Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PROP = 'Pago a propietario';

// Entorno con "base" en memoria: sbGet devuelve filas por tabla, los borrados quedan registrados
function entorno(tablas, extra = {}) {
  const borrados = [];
  return {
    borrados,
    env: {
      formatMoney, toast() {}, closeModal() {}, loadAll: async () => {}, renderContratos() {}, renderGrilla() {},
      sbGet: async (tabla, q) => {
        let filas = tablas[tabla] || [];
        const eq = /pago_id=eq\.(\d+)/.exec(q);
        if (eq) filas = filas.filter(f => String(f.pago_id) === eq[1]);
        const enLista = /pago_id=in\.\(([\d,]+)\)/.exec(q);
        if (enLista) { const ids = new Set(enLista[1].split(',')); filas = filas.filter(f => ids.has(String(f.pago_id))); }
        const cat = /categoria=eq\.([^&]+)/.exec(q);
        if (cat) filas = filas.filter(f => f.categoria === decodeURIComponent(cat[1]));
        return filas;
      },
      sbDeleteWhere: async (tabla, q) => { borrados.push([tabla, q]); },
      sbDelete: async (tabla, id) => { borrados.push([tabla, 'id=' + id]); },
      sbPatch: async () => {},
      ...extra
    }
  };
}

test('revertir un cobro borra los movimientos de Caja del mes, pero nunca los pagos al propietario', async () => {
  const { env, borrados } = entorno({ caja_movimientos: [
    { id: 1, pago_id: 9, categoria: 'Cobro alquiler' },
    { id: 2, pago_id: 9, categoria: PROP },
    { id: 3, pago_id: 9, categoria: 'Honorarios' },
    { id: 4, pago_id: 9, categoria: null },
    { id: 5, pago_id: 8, categoria: 'Cobro alquiler' },     // de otro mes
  ] });
  const { borrarMovimientosCajaDelCobro } = cargar('index.html', ['borrarMovimientosCajaDelCobro'], env);
  await borrarMovimientosCajaDelCobro(9);
  assert.deepEqual(borrados, [['caja_movimientos', 'id=in.(1,3,4)']]);
});

test('si el mes solo tiene el pago al propietario, revertir el cobro no borra nada', async () => {
  const { env, borrados } = entorno({ caja_movimientos: [{ id: 2, pago_id: 9, categoria: PROP }] });
  const { borrarMovimientosCajaDelCobro } = cargar('index.html', ['borrarMovimientosCajaDelCobro'], env);
  await borrarMovimientosCajaDelCobro(9);
  assert.deepEqual(borrados, []);
});

test('guarda: ningún borrado de Caja por pago_id sin filtrar, salvo el de "Eliminar mes" (que avisa antes)', () => {
  const src = leerHtml('index.html');
  const lineas = src.split('\n').filter(l => l.includes("sbDeleteWhere('caja_movimientos'"));
  const sinFiltro = lineas.filter(l => !l.includes('categoria=eq.Honorarios') && !l.includes('id=in.('));
  assert.equal(sinFiltro.length, 1, 'solo "Eliminar mes" puede borrar por pago_id sin filtrar:\n' + sinFiltro.join('\n'));
  assert.ok(extraerFuncion(src, 'eliminarMes').includes(sinFiltro[0].trim()), 'ese borrado tiene que estar dentro de eliminarMes');
});

test('aviso de rendición: sin pagos ni recibos no avisa; con ellos explica qué se pierde', () => {
  const { textoAvisoRendicion } = cargar('index.html', ['textoAvisoRendicion'], { formatMoney });
  assert.equal(textoAvisoRendicion([], false, 'mes'), '');
  assert.equal(textoAvisoRendicion(null, false, 'contrato'), '');
  const mes = textoAvisoRendicion([{ monto: 331705.08 }], false, 'mes');
  assert.match(mes, /Este mes ya tiene rendiciones/);
  assert.match(mes, /1 pago al propietario registrado en Caja por \$\s331\.705,08/);
  assert.match(mes, /se BORRA de Caja/);
  const contrato = textoAvisoRendicion([{ monto: 100 }, { monto: 50 }], true, 'contrato');
  assert.match(contrato, /Este contrato ya tiene rendiciones/);
  assert.match(contrato, /2 pagos al propietario registrados/);
  assert.match(contrato, /recibos de propietario emitidos/);
  assert.match(contrato, /QUEDAN en Caja sin contrato asociado/);
});

function armarEliminarMes(tablas, acepta) {
  const { env, borrados } = entorno(tablas, {
    pagosActuales: [{ id: 9, total: 100000, pagado: 'SI', saldo: 0, recibo_prop_emitido: false }],
    DB: { contratos: [] }
  });
  const preguntas = [];
  env.confirm = txt => { preguntas.push(txt); return acepta; };
  const { eliminarMes } = cargar('index.html', ['eliminarMes', 'textoAvisoRendicion'], env);
  return { eliminarMes, preguntas, borrados };
}

test('eliminar un mes con pago al propietario: avisa, y si se cancela no borra nada', async () => {
  const t = armarEliminarMes({ caja_movimientos: [{ id: 2, pago_id: 9, categoria: PROP, monto: 400061.84 }] }, false);
  await t.eliminarMes(9, 'H');
  assert.equal(t.preguntas.length, 1);
  assert.match(t.preguntas[0], /ya tiene rendiciones al propietario/);
  assert.match(t.preguntas[0], /1 pago al propietario registrado/);
  assert.deepEqual(t.borrados, []);
});

test('eliminar un mes con pago al propietario y continuar: borra Caja, las rendiciones emitidas y el mes', async () => {
  const t = armarEliminarMes({ caja_movimientos: [{ id: 2, pago_id: 9, categoria: PROP, monto: 1000 }], recibos_propietario_emitidos: [{ pago_id: 9, fecha: '2026-10-12' }] }, true);
  await t.eliminarMes(9, 'H');
  const tablas = t.borrados.map(b => b[0]);
  assert.ok(tablas.includes('caja_movimientos'));
  assert.ok(tablas.includes('recibos_propietario_emitidos'), 'las rendiciones emitidas no pueden quedar sueltas');
  assert.deepEqual(t.borrados.at(-1), ['pagos', 'id=9']);
});

test('eliminar un mes sin rendiciones: la pregunta de siempre, sin el aviso', async () => {
  const t = armarEliminarMes({}, true);
  await t.eliminarMes(9, 'H');
  assert.equal(t.preguntas.length, 1);
  assert.doesNotMatch(t.preguntas[0], /rendiciones/);
  assert.deepEqual(t.borrados.at(-1), ['pagos', 'id=9']);
});

function armarEliminarContrato(tablas, acepta) {
  const { env, borrados } = entorno(tablas, {
    DB: { contratos: [{ id: 5, hoja: 'Gramaglia-Baral', titulo: 'Gramaglia-Baral' }], pagos: [{ id: 9, hoja: 'Gramaglia-Baral' }, { id: 10, hoja: 'Gramaglia-Baral' }, { id: 77, hoja: 'Otro' }] }
  });
  const preguntas = [];
  env.confirm = txt => { preguntas.push(txt); return acepta; };
  const { eliminarContrato } = cargar('index.html', ['eliminarContrato', 'textoAvisoRendicion'], env);
  return { eliminarContrato, preguntas, borrados };
}

test('eliminar un contrato con pagos al propietario: avisa que quedan en Caja y, si se cancela, no borra nada', async () => {
  const t = armarEliminarContrato({ caja_movimientos: [
    { pago_id: 9, categoria: PROP, monto: 400061.84 }, { pago_id: 9, categoria: 'Cobro alquiler', monto: 897519.8 }, { pago_id: 77, categoria: PROP, monto: 5 }
  ] }, false);
  await t.eliminarContrato(5);
  assert.match(t.preguntas[0], /Este contrato ya tiene rendiciones/);
  assert.match(t.preguntas[0], /1 pago al propietario registrado/);          // el del otro contrato (pago 77) no cuenta
  assert.match(t.preguntas[0], /1 movimiento de cobros u honorarios/);
  assert.deepEqual(t.borrados, []);
});

test('eliminar un contrato y continuar: borra sus rendiciones emitidas y NO toca Caja', async () => {
  const t = armarEliminarContrato({ caja_movimientos: [{ pago_id: 9, categoria: PROP, monto: 1 }], recibos_propietario_emitidos: [{ pago_id: 10 }] }, true);
  await t.eliminarContrato(5);
  const tablas = t.borrados.map(b => b[0]);
  assert.ok(tablas.includes('recibos_propietario_emitidos'));
  assert.ok(!tablas.includes('caja_movimientos'), 'los movimientos de Caja de un contrato eliminado se conservan');
  assert.ok(tablas.includes('contratos'));
});

test('eliminar un contrato con solo cobros en Caja: avisa que quedan en Caja', async () => {
  const t = armarEliminarContrato({ caja_movimientos: [{ pago_id: 9, categoria: 'Cobro alquiler', monto: 5 }, { pago_id: 10, categoria: 'Honorarios', monto: 5 }] }, false);
  await t.eliminarContrato(5);
  assert.match(t.preguntas[0], /2 movimientos de Caja \(cobros u honorarios\)/);
});

test('rescindir: los meses posteriores se borran, salvo los que tienen cobros, movimientos de Caja o recibos emitidos', async () => {
  const pagos = [
    { id: 1, mes: '2026-09-01', pagado_importe: 0, recibo_prop_emitido: false },     // mes de la rescisión: no se toca
    { id: 2, mes: '2026-10-01', pagado_importe: 500, recibo_prop_emitido: false },   // con cobro
    { id: 3, mes: '2026-11-01', pagado_importe: 0, recibo_prop_emitido: false },     // con pago al propietario en Caja
    { id: 4, mes: '2026-12-01', pagado_importe: 0, recibo_prop_emitido: false },     // con recibo emitido
    { id: 5, mes: '2027-01-01', pagado_importe: 0, recibo_prop_emitido: true },      // marcado como recibo emitido
    { id: 6, mes: '2027-02-01', pagado_importe: 0, recibo_prop_emitido: false },     // limpio
  ];
  const { env, borrados } = entorno({
    pagos, caja_movimientos: [{ pago_id: 3, categoria: PROP }], recibos_propietario_emitidos: [{ pago_id: 4 }]
  }, {
    document: { getElementById: () => ({ value: '2026-09-30' }) },
    DB: { contratos: [] }, DB_CONTRATO_PERSONAS: [], TODAY: '2026-10-30',
    formatDate: d => d.substring(0, 7), openContrato() {}
  });
  const avisos = [];
  env.alert = t => avisos.push(t);
  const { confirmarRescision } = cargar('index.html', ['confirmarRescision'], env);
  await confirmarRescision(4464, 'Gramaglia-Kowslsky');
  const pagosBorrados = borrados.filter(b => b[0] === 'pagos').map(b => b[1]);
  assert.deepEqual(pagosBorrados, ['id=6']);                                         // solo el mes limpio
  assert.equal(avisos.length, 1);
  assert.match(avisos[0], /2026-10: tiene cobros registrados/);
  assert.match(avisos[0], /2026-11: tiene movimientos de Caja/);
  assert.match(avisos[0], /2026-12: tiene un recibo de propietario emitido/);
  assert.match(avisos[0], /2027-01: tiene un recibo de propietario emitido/);
});
