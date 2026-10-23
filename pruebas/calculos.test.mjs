// Pruebas automáticas de los cálculos de dinero del sistema de gestión.
// Correr:  node --test pruebas/        (desde locaciones-repo)
// Cada test arma sus propios datos; los importes esperados están calculados a mano.

import test from 'node:test';
import assert from 'node:assert/strict';
import { cargar, c2, dinero } from './helpers.mjs';

const ARCHIVO = 'index.html';

// ───────────────────────────── Total de un mes ─────────────────────────────
{
  const { calcularTotal } = cargar(ARCHIVO, ['calcularTotal'], {
    DB: { contratos: [{ id: 1, hoja: 'H' }] },
    DB_SUMINISTROS: [{ id: 10, contrato_id: 1, tipo: 'epe', pct_inquilino: 100 }]
  });

  test('calcularTotal: alquiler + servicios del sistema viejo', () => {
    const p = { hoja: 'H', importe_alquiler: 340000, monto_agua: 19425.38, monto_tgiu: 3908.5 };
    assert.equal(calcularTotal(p, [], undefined), 363333.88);
  });
  test('calcularTotal: un extra a cargo del inquilino suma', () => {
    const p = { hoja: 'H', importe_alquiler: 340000, monto_agua: 19425.38, monto_tgiu: 3908.5 };
    const extras = [{ importe: 168261.22, tipo: 'debito', a_cargo_de: 'inquilino' }];
    assert.equal(calcularTotal(p, extras, undefined), 531595.1);
  });
  test('calcularTotal: crédito y descuento restan', () => {
    const p = { hoja: 'H', importe_alquiler: 100000 };
    assert.equal(calcularTotal(p, [{ importe: 5000, tipo: 'credito' }], undefined), 95000);
    assert.equal(calcularTotal(p, [{ importe: 2500, tipo: 'descuento' }], undefined), 97500);
  });
  test('calcularTotal: los extras a cargo del propietario no cambian lo que paga el inquilino', () => {
    const p = { hoja: 'H', importe_alquiler: 100000 };
    assert.equal(calcularTotal(p, [{ importe: 30000, tipo: 'debito', a_cargo_de: 'propietario' }], undefined), 100000);
  });
  test('calcularTotal: con importes por cuenta (pagos_suministros) cuenta solo la parte del inquilino', () => {
    const p = { hoja: 'H', importe_alquiler: 100000 };
    assert.equal(calcularTotal(p, [], { 10: { inq: 5000, prop: 1000 } }), 105000);
    assert.equal(calcularTotal(p, [], { 10: 5000 }), 105000);   // formato numérico viejo
  });
  test('calcularTotal: un servicio sin cuenta nueva sigue entrando por el campo viejo', () => {
    const p = { hoja: 'H', importe_alquiler: 100000, monto_agua: 1000 };
    assert.equal(calcularTotal(p, [], { 10: { inq: 5000, prop: 0 } }), 106000);
  });
  test('calcularTotal: sin ruido de coma flotante', () => {
    assert.equal(calcularTotal({ hoja: 'H', importe_alquiler: 0.1, monto_agua: 0.2 }, [], undefined), 0.3);
  });
}

// ──────────────────── Reparto entre propietarios (% de participación) ────────────────────
{
  const { cuotaPropietario } = cargar(ARCHIVO, ['cuotaPropietario']);
  const dos = [{ persona_id: 1, pct_alquiler: 50 }, { persona_id: 2, pct_alquiler: 50 }];

  test('cuotaPropietario: un solo propietario recibe todo', () => {
    assert.equal(cuotaPropietario(1234.56, [{ persona_id: 1, pct_alquiler: 100 }], 1), 1234.56);
    assert.equal(cuotaPropietario(1234.56, [], 1), 1234.56);
  });
  test('cuotaPropietario: 50/50', () => {
    assert.equal(cuotaPropietario(30000, dos, 1), 15000);
    assert.equal(cuotaPropietario(30000, dos, 2), 15000);
  });
  test('cuotaPropietario: las partes suman exactamente el monto (los centavos los absorbe el último)', () => {
    const a = cuotaPropietario(100.01, dos, 1), b = cuotaPropietario(100.01, dos, 2);
    assert.equal(c2(a + b), 100.01);
    const tres = [{ persona_id: 1, pct_alquiler: 34 }, { persona_id: 2, pct_alquiler: 33 }, { persona_id: 3, pct_alquiler: 33 }];
    assert.equal(c2([1, 2, 3].reduce((s, id) => s + cuotaPropietario(100, tres, id), 0)), 100);
  });
  test('cuotaPropietario: 60/40 y porcentajes que no suman 100 se normalizan', () => {
    const sesenta = [{ persona_id: 1, pct_alquiler: 60 }, { persona_id: 2, pct_alquiler: 40 }];
    assert.equal(cuotaPropietario(10000, sesenta, 1), 6000);
    assert.equal(cuotaPropietario(10000, sesenta, 2), 4000);
    const raro = [{ persona_id: 1, pct_alquiler: 30 }, { persona_id: 2, pct_alquiler: 20 }];
    assert.equal(cuotaPropietario(10000, raro, 1), 6000);
  });
  test('cuotaPropietario: sin porcentaje cargado reparte en partes iguales', () => {
    assert.equal(cuotaPropietario(900, [{ persona_id: 1 }, { persona_id: 2 }, { persona_id: 3 }], 2), 300);
  });
}

// ─────────────── Excedente de un pago aplicado al mes siguiente (cascada) ───────────────
{
  const montar = meses => {
    const parches = [], movimientos = [];
    const entorno = {
      sbGet: async (_t, q) => { const m = /mes=gt\.([\d-]+)/.exec(q)[1]; return meses.filter(x => x.mes > m).sort((a, b) => a.mes < b.mes ? -1 : 1).slice(0, 1); },
      sbPatch: async (_t, id, cuerpo) => { parches.push({ id, ...cuerpo }); },
      sbPost: async (_t, cuerpo) => { movimientos.push(cuerpo); }
    };
    const { distribuirExcedenteEnCascada } = cargar(ARCHIVO, ['distribuirExcedenteEnCascada'], entorno);
    return { correr: exc => distribuirExcedenteEnCascada('Hoja', '2026-10-01', exc, 7), parches, movimientos };
  };
  const vacio = (id, mes) => ({ id, mes, total: 0, pagado_importe: 0, importe_alquiler: 0, pagado: '0' });
  const conDeuda = (id, mes, total, pagado = 0) => ({ id, mes, total, pagado_importe: pagado, importe_alquiler: total, pagado: '0' });

  test('cascada: un mes ya creado pero sin importes recibe el excedente como saldo a favor', async () => {
    const t = montar([vacio(1, '2026-11-01'), vacio(2, '2026-12-01')]);
    const r = await t.correr(3602.96);
    assert.equal(r.restante, 0);
    assert.deepEqual(r.mesesAfectados.map(m => [m.mes.slice(0, 7), m.aplicado, !!m.aFavor]), [['2026-11', 3602.96, true]]);
    assert.deepEqual(t.parches, [{ id: 1, pagado_importe: 3602.96 }]);
    assert.equal(t.movimientos.length, 1);
  });
  test('cascada: cubre primero el mes con deuda y el resto va al siguiente mes vacío', async () => {
    const t = montar([conDeuda(1, '2026-11-01', 2000), vacio(2, '2026-12-01')]);
    const r = await t.correr(3602.96);
    assert.equal(r.restante, 0);
    assert.deepEqual(r.mesesAfectados.map(m => [m.mes.slice(0, 7), m.aplicado]), [['2026-11', 2000], ['2026-12', 1602.96]]);
    assert.equal(t.parches[0].pagado, 'SI');
    assert.equal(t.parches[0].saldo, 0);
    assert.equal(t.parches[0].pagado_alquiler, 2000);   // se imputa al ítem Alquiler
  });
  test('cascada: un mes ya pagado se saltea', async () => {
    const t = montar([conDeuda(1, '2026-11-01', 5000, 5000), vacio(2, '2026-12-01')]);
    const r = await t.correr(100);
    assert.deepEqual(r.mesesAfectados.map(m => m.mes.slice(0, 7)), ['2026-12']);
  });
  test('cascada: pago parcial del mes siguiente, solo se aplica lo que falta', async () => {
    const t = montar([conDeuda(1, '2026-11-01', 5000, 3000)]);
    const r = await t.correr(2500);
    assert.equal(r.mesesAfectados[0].aplicado, 2000);
    assert.equal(r.restante, 500);        // sobra, y no hay más meses
    assert.equal(t.parches[0].saldo, 0);
  });
  test('cascada: sin meses siguientes el excedente queda sin acreditar y se informa', async () => {
    const t = montar([]);
    const r = await t.correr(100);
    assert.equal(r.restante, 100);
    assert.equal(r.sinMasMeses, true);
    assert.deepEqual(t.parches, []);
  });
  test('cascada: un mes rescindido nunca recibe plata', async () => {
    const t = montar([{ ...vacio(1, '2026-11-01'), pagado: 'RESCINDIDO' }]);
    const r = await t.correr(100);
    assert.equal(r.restante, 100);
    assert.deepEqual(t.parches, []);
  });
}

// ───────── "Ingresar Pago": qué se ofrece cobrar de los extras pendientes ─────────
{
  const { generarItemsCobro } = cargar(ARCHIVO, ['generarItemsCobro', 'obtenerItemsPendientesGP', 'calcularTotal', 'redondear2'], {
    window: { _pagosSuministros: {}, _gpMesKey: '2026-09' },
    DB_SUMINISTROS: [], DB_GASTOS_CUOTAS: [], DB: { contratos: [] },
    formatMoney: dinero, _gpHoja: 'X', _gpComision: 8
  });
  const septiembre = (pagadoImporte, saldo, total = 531595.1) => ({
    id: 1, hoja: 'X', importe_alquiler: 340000, monto_agua: 19425.38, monto_tgiu: 3908.5,
    pagado_alquiler: 340000, pagado_agua: 19425.38, pagado_tgiu: 3908.5, pagado_importe: pagadoImporte, total, saldo
  });
  const extraEPE = { id: 7, concepto: 'EPE', importe: 168261.22, tipo: 'debito', a_cargo_de: 'inquilino', cobrado: false };
  const valorExtra = (html, id) => { const m = new RegExp(`cobro-chk-extra-${id}" value="([^"]+)"`).exec(html); return m ? Number(m[1]) : null; };

  test('Ingresar Pago: lo pagado de más se descuenta del extra pendiente (caso Sep 2026)', () => {
    // Pagó 480.000: alquiler+agua+TGIU suman 363.333,88; los 116.666,12 restantes ya cubren parte del extra
    const html = generarItemsCobro(septiembre(480000, 51595.1), [extraEPE], 1, '2026-09', 0, []);
    assert.equal(valorExtra(html, 7), 51595.1);
    assert.match(html, /ya se imputaron/);
  });
  test('Ingresar Pago: sin sobrante, el extra se ofrece completo', () => {
    const html = generarItemsCobro(septiembre(363333.88, 168261.22), [extraEPE], 1, '2026-09', 0, []);
    assert.equal(valorExtra(html, 7), 168261.22);
    assert.doesNotMatch(html, /ya se imputaron/);
  });
  test('Ingresar Pago: si el sobrante supera al extra, queda en cero', () => {
    const html = generarItemsCobro(septiembre(600000, 0.01), [extraEPE], 1, '2026-09', 0, []);
    assert.equal(valorExtra(html, 7), 0);
  });
  test('Ingresar Pago: un extra ya cobrado no genera sobrante falso', () => {
    const cobrado = { id: 5, concepto: 'Otro', importe: 1000, tipo: 'debito', a_cargo_de: 'inquilino', cobrado: true };
    const html = generarItemsCobro(septiembre(364333.88, 168261.22, 532595.1), [extraEPE], 1, '2026-09', 0, [cobrado]);
    assert.equal(valorExtra(html, 7), 168261.22);
  });
  test('Ingresar Pago: un descuento pendiente no se toca con el sobrante', () => {
    const descuento = { id: 9, concepto: 'Descuento', importe: 5000, tipo: 'credito', a_cargo_de: 'inquilino', cobrado: false };
    const html = generarItemsCobro(septiembre(480000, 51595.1), [descuento, extraEPE], 1, '2026-09', 0, []);
    assert.equal(valorExtra(html, 9), 5000);
    assert.equal(valorExtra(html, 7), 51595.1);
  });
}

// ───────────── Recibo al propietario: cuánto se le rinde (generarHtmlReciboProp) ─────────────
{
  const montar = ({ propietarios, sumins = [], cuotas = [], psMes = {} }) => {
    const { generarHtmlReciboProp } = cargar(ARCHIVO,
      ['generarHtmlReciboProp', 'cuotaPropietario', '_rendidoMonto', 'formatNombrePersona', 'formatDireccion', 'formatMoney'], {
        DB_CONTRATO_PERSONAS: propietarios.map(p => ({ contrato_id: 1, rol: 'propietario', ...p })),
        DB_PERSONAS: propietarios.map(p => ({ id: p.persona_id, apellido: 'Apellido' + p.persona_id, nombre: 'N' })),
        DB_SUMINISTROS: sumins.map(s => ({ contrato_id: 1, ...s })),
        DB_GASTOS_CUOTAS: cuotas.map(q => ({ contrato_id: 1, ...q })),
        DB_INMUEBLES: [],
        window: { _pagosSuministros: { 1: psMes } },
        _construirYaRendidoHtml: () => ''
      });
    // El sistema muestra el total siempre redondeado a centavos; acá se compara igual
    // (la suma interna puede arrastrar residuos de coma flotante como 122721.70000000001).
    return (...args) => { const r = generarHtmlReciboProp(...args); return { ...r, totalRendir: c2(r.totalRendir) }; };
  };
  const contrato = { id: 1, titulo: 'X', locatario: 'Y', servicios_rendir_propietario: '', vigencia_desde: '2026-01-01', vigencia_hasta: '2027-01-31' };
  const uno = [{ persona_id: 1, pct_alquiler: 100 }];
  const dos = [{ persona_id: 1, pct_alquiler: 50 }, { persona_id: 2, pct_alquiler: 50 }];
  const pago = alquiler => ({ id: 1, importe_alquiler: alquiler });
  const extra = (id, importe, tipo, propietario = null) => ({ id, concepto: 'Extra ' + id, importe, tipo, a_cargo_de: 'propietario', propietario_persona_id: propietario });

  test('recibo propietario: alquiler menos comisión del 8%', () => {
    const f = montar({ propietarios: uno });
    const r = f(pago(340000), [], 8, contrato, 'octubre 2026', 1, {});
    assert.equal(r.totalRendir, 312800);
    assert.equal(r.itemsRendidos.alquiler, 340000);
  });
  test('recibo propietario: un débito (ej. cuota de termotanque) resta', () => {
    const r = montar({ propietarios: uno })(pago(340000), [extra(1, 30000, 'debito')], 8, contrato, 'x', 1, {});
    assert.equal(r.totalRendir, 282800);
  });
  test('recibo propietario: un crédito suma', () => {
    const r = montar({ propietarios: uno })(pago(340000), [extra(1, 10000, 'credito')], 8, contrato, 'x', 1, {});
    assert.equal(r.totalRendir, 322800);
  });
  test('recibo propietario: con dos propietarios 50/50 cada uno recibe su mitad menos comisión', () => {
    const f = montar({ propietarios: dos });
    assert.equal(f(pago(299395), [], 8, contrato, 'x', 1, {}).totalRendir, 137721.7);
    assert.equal(f(pago(299395), [], 8, contrato, 'x', 2, {}).totalRendir, 137721.7);
  });
  test('recibo propietario: un extra "Todos" se reparte según el porcentaje', () => {
    const f = montar({ propietarios: dos });
    assert.equal(f(pago(299395), [extra(1, 30000, 'debito')], 8, contrato, 'x', 1, {}).totalRendir, 122721.7);
  });
  test('recibo propietario: un extra de OTRO propietario no afecta', () => {
    const f = montar({ propietarios: dos });
    assert.equal(f(pago(299395), [extra(1, 30000, 'debito', 2)], 8, contrato, 'x', 1, {}).totalRendir, 137721.7);
  });
  test('recibo propietario: un servicio que se rinde al propietario suma', () => {
    const f = montar({ propietarios: uno, sumins: [{ id: 5, tipo: 'epe', pct_propietario: 0, pct_inquilino: 100, propietario_persona_id: 1 }], psMes: { 5: { inq: 38000, prop: 0 } } });
    assert.equal(f(pago(340000), [], 8, contrato, 'x', 1, {}).totalRendir, 350800);
  });
  test('recibo propietario: un servicio a cargo del propietario resta', () => {
    const f = montar({ propietarios: uno, sumins: [{ id: 6, tipo: 'agua', pct_propietario: 100, pct_inquilino: 0, descuenta_persona_id: 1 }], psMes: { 6: { inq: 0, prop: 10000 } } });
    assert.equal(f(pago(340000), [], 8, contrato, 'x', 1, {}).totalRendir, 302800);
  });
  test('recibo propietario: un servicio "rinde a todos" se reparte 60/40', () => {
    const f = montar({ propietarios: [{ persona_id: 1, pct_alquiler: 60 }, { persona_id: 2, pct_alquiler: 40 }], sumins: [{ id: 7, tipo: 'agua', pct_propietario: 0, pct_inquilino: 100, rinde_todos: true }], psMes: { 7: { inq: 10000, prop: 0 } } });
    const sinAlquiler = f(pago(0), [], 8, contrato, 'x', 1, {});
    assert.equal(sinAlquiler.totalRendir, 6000);
    assert.equal(f(pago(0), [], 8, contrato, 'x', 2, {}).totalRendir, 4000);
  });
  test('recibo propietario: lo ya rendido no se vuelve a rendir', () => {
    const r = montar({ propietarios: uno })(pago(340000), [], 8, contrato, 'x', 1, { alquiler: { monto: 340000 } });
    assert.equal(r.totalRendir, 0);
    assert.equal(r.html, null);
  });
  test('recibo propietario: una rendición parcial rinde solo el resto (y la comisión sobre ese resto)', () => {
    const r = montar({ propietarios: uno })(pago(340000), [], 8, contrato, 'x', 1, { alquiler: { monto: 100000 } });
    assert.equal(r.totalRendir, 220800);   // (340000 − 100000) − 8%
  });
  test('recibo propietario: los honorarios pendientes del propietario se descuentan', () => {
    const f = montar({ propietarios: uno, cuotas: [{ monto_propietario: 68000, pagado_propietario: 0 }] });
    assert.equal(f(pago(340000), [], 8, contrato, 'x', 1, {}).totalRendir, 244800);
  });
}

// ───────────────────────── Contratos rescindidos ─────────────────────────
{
  const { _limiteMesesContrato } = cargar(ARCHIVO, ['_limiteMesesContrato']);
  test('límite de meses: un contrato rescindido no pasa del mes de la rescisión', () => {
    assert.equal(_limiteMesesContrato({ fecha_rescision: '2026-09-30' }, '2026-10-31'), '2026-09');
  });
  test('límite de meses: sin rescisión (o rescisión posterior) rige el fin de la vigencia', () => {
    assert.equal(_limiteMesesContrato({ fecha_rescision: null }, '2026-10-31'), '2026-10');
    assert.equal(_limiteMesesContrato({ fecha_rescision: '2026-12-01' }, '2026-10-31'), '2026-10');
    assert.equal(_limiteMesesContrato(undefined, '2026-10-31'), '2026-10');
  });
}

// ───────────────────────── Tablero de cobranza ─────────────────────────
{
  const montar = () => {
    const DB = {
      contratos: [
        { id: 1, hoja: 'A-Uno', titulo: 'A-Uno', vigencia_hasta: '2027-12-31', dia_vencimiento: 10 },
        { id: 2, hoja: 'B-Dos', titulo: 'B-Dos', vigencia_hasta: '2027-12-31', dia_vencimiento: 20 },
        { id: 3, hoja: 'C-Tres', titulo: 'C-Tres', vigencia_hasta: '2027-12-31', fecha_rescision: '2026-06-30', dia_vencimiento: 10 },
        { id: 4, hoja: 'D-Cuatro', titulo: 'D-Cuatro', vigencia_hasta: '2027-12-31', dia_vencimiento: 10 },
        { id: 5, hoja: 'G-Cinco', titulo: 'G-Cinco', vigencia_hasta: '2027-12-31', dia_vencimiento: 10, modalidad_pago: 'VENCIDO' }
      ],
      pagos: []
    };
    const P = (hoja, mes, total, saldo, extra = {}) => ({ hoja, mes: mes + '-01', total, saldo, pagado: '0', ...extra });
    DB.pagos = [
      P('A-Uno', '2026-08', 100000, 100000), P('A-Uno', '2026-09', 100000, 50000), P('A-Uno', '2026-10', 300000, 200000),
      P('B-Dos', '2026-10', 100000, 100000), P('C-Tres', '2026-06', 94000, 94000), P('D-Cuatro', '2026-09', 80000, 0.5),
      P('A-Uno', '2026-07', 100000, 100000, { pagado: 'RESCINDIDO' }), P('B-Dos', '2026-11', 100000, 100000), P('G-Cinco', '2026-10', 100000, 100000)
    ];
    const entorno = { DB, TODAY: '2026-10-15', DB_CONTRATO_PERSONAS: [], DB_PERSONAS: [] };
    return cargar(ARCHIVO, ['calcularCobranza', 'getEstado', 'calcularFechaVencimiento', '_waNumero'], entorno).calcularCobranza('2026-10-15');
  };

  test('cobranza: solo cuentan las cuotas vencidas con saldo (no las de redondeo, rescindidas ni futuras)', () => {
    const d = montar();
    assert.deepEqual(d.mora.map(m => m.c.hoja).sort(), ['A-Uno', 'C-Tres']);
    const a = d.mora.find(m => m.c.hoja === 'A-Uno');
    assert.equal(a.saldo, 350000);
    assert.deepEqual(a.cuotas.map(q => [q.mes, q.dias]), [['2026-08', 66], ['2026-09', 35], ['2026-10', 5]]);
    assert.equal(a.diasMax, 66);
  });
  test('cobranza: antigüedad por tramos', () => {
    const b = montar().buckets;
    assert.deepEqual([b.b30, b.b60, b.b90, b.bMas].map(x => [x.n, x.monto]), [[1, 200000], [1, 50000], [1, 100000], [1, 94000]]);
  });
  test('cobranza: lo que vence en los próximos 7 días', () => {
    const v = montar().porVencer;
    assert.deepEqual(v.map(x => [x.c.hoja, x.venc, x.en, x.saldo]), [['B-Dos', '2026-10-20', 5, 100000]]);
  });
  test('cobranza: porcentaje del mes (cobrado sobre facturado)', () => {
    const d = montar();
    assert.equal(d.facturadoMes, 500000);
    assert.equal(d.cobradoMes, 100000);
  });
}

// ───────────────────────── Utilidades de datos ─────────────────────────
{
  const { _waNumero, cmpTexto } = cargar(ARCHIVO, ['_waNumero', 'cmpTexto']);

  test('WhatsApp: normaliza celulares argentinos', () => {
    assert.equal(_waNumero('3493 41-5336'), '5493493415336');
    assert.equal(_waNumero('0349315123456'), '5493493123456');      // 0 + área + 15 + número
    assert.equal(_waNumero('+54 3493 415336'), '5493493415336');
    assert.equal(_waNumero('+54 9 3493 41-5336'), '5493493415336');
    assert.equal(_waNumero('00543493415336'), '5493493415336');
    assert.equal(_waNumero('(0342) 15-4123456'), '5493424123456');
  });
  test('WhatsApp: un teléfono que no es celular válido da vacío', () => {
    assert.equal(_waNumero('4231234'), '');
    assert.equal(_waNumero(''), '');
    assert.equal(_waNumero(null), '');
  });
  test('orden de texto: sin tildes ni mayúsculas, números naturales, vacíos al final', () => {
    const filas = [{ n: 'Zárate' }, { n: 'ávila' }, { n: 'Baral' }, { n: '' }, { n: 'Plan 10' }, { n: 'Plan 2' }];
    assert.deepEqual(filas.sort(cmpTexto('n')).map(f => f.n), ['ávila', 'Baral', 'Plan 2', 'Plan 10', 'Zárate', '']);
  });
}

// ───────────────── Carga por páginas (el servidor corta en 1000 filas) ─────────────────
{
  const servir = (total, tope = 1000) => {
    const todas = Array.from({ length: total }, (_, i) => ({ id: i + 1 }));
    const pedidos = [];
    const sbFetch = async url => {
      pedidos.push(url);
      const gt = +/id=gt\.(\d+)/.exec(url)[1], lim = Math.min(+/limit=(\d+)/.exec(url)[1], tope);
      return { json: async () => todas.filter(f => f.id > gt).slice(0, lim) };
    };
    return { sbGetAll: cargar(ARCHIVO, ['sbGetAll'], { SB_URL: 'https://x', sbFetch }).sbGetAll, pedidos };
  };
  for (const [n, pedidosEsperados] of [[300, 1], [1000, 2], [1001, 2], [2350, 3]]) {
    test(`sbGetAll: ${n} filas llegan completas`, async () => {
      const { sbGetAll, pedidos } = servir(n);
      const filas = await sbGetAll('tabla', 'select=*');
      assert.equal(filas.length, n);
      assert.equal(new Set(filas.map(f => f.id)).size, n);      // sin repetidas
      assert.equal(pedidos.length, pedidosEsperados);
    });
  }
}
