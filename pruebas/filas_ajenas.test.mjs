// Filas de pagos_suministros de cuentas de OTRO contrato: al guardar el servicio del mes se quitan, así el
// total no cuenta el servicio dos veces. Casos reales: Galetto-Severini abr 2026 ($74.330,16: EPE y agua) y
// Cavallero-Varengo ago 2025 ($36.967,50: agua y TGIU).

import test from 'node:test';
import assert from 'node:assert/strict';
import { cargar } from './helpers.mjs';

// Contrato 4197 (Galetto-Severini, cuentas nuevas 1055-1058) y contrato 4543 (Galetto-Tello, dueño de las cuentas 54 y 55).
const SUMINISTROS = [
  { id: 54, contrato_id: 4543, tipo: 'epe', pct_inquilino: 100, pct_propietario: 0 },
  { id: 55, contrato_id: 4543, tipo: 'agua', pct_inquilino: 100, pct_propietario: 0 },
  { id: 1055, contrato_id: 4197, tipo: 'epe', pct_inquilino: 100, pct_propietario: 0 },
  { id: 1056, contrato_id: 4197, tipo: 'agua', pct_inquilino: 100, pct_propietario: 0 },
  { id: 1057, contrato_id: 4197, tipo: 'tgiu', pct_inquilino: 100, pct_propietario: 0 },
];

// Base de datos en memoria para pagos_suministros.
function montar(filasIniciales, { falla = false } = {}) {
  const filas = filasIniciales.map(f => ({ ...f }));
  let proximo = 1000;
  const avisos = [];
  const env = {
    DB_SUMINISTROS: SUMINISTROS, window: { _pagosSuministros: {} },
    toast: m => avisos.push(m),
    sbGet: async (tabla, q) => {
      if (falla) throw new Error('sin conexión');
      const pago = Number(/pago_id=eq\.(\d+)/.exec(q)[1]);
      const sum = /suministro_id=eq\.(\d+)/.exec(q);
      return filas.filter(f => f.pago_id === pago && (!sum || f.suministro_id === Number(sum[1]))).map(f => ({ ...f }));
    },
    sbPost: async (tabla, fila) => { filas.push({ id: proximo++, pagado_proveedor: false, ...fila }); },
    sbPatch: async (tabla, id, cambios) => { Object.assign(filas.find(f => f.id === id), cambios); },
    sbDelete: async (tabla, id) => { filas.splice(filas.findIndex(f => f.id === id), 1); },
  };
  return { filas, avisos, env };
}
const cargarFns = env => cargar('index.html', ['retirarFilasServicioAjenas', '_syncPagosSuministros'], env);
const suministrosDe = filas => filas.map(f => f.suministro_id).sort((a, b) => a - b);

// Abril de Galetto-Severini: el total sumaba las 6 filas. Las ajenas (54, 55) duplicaban EPE y agua.
const abril = () => [
  { id: 757, pago_id: 54214, suministro_id: 54, importe: 43986.55, importe_propietario: 0 },
  { id: 758, pago_id: 54214, suministro_id: 55, importe: 30343.61, importe_propietario: 0 },
  { id: 10797, pago_id: 54214, suministro_id: 1055, importe: 43986.55, importe_propietario: 0 },
  { id: 10798, pago_id: 54214, suministro_id: 1056, importe: 30343.61, importe_propietario: 0 },
  { id: 10799, pago_id: 54214, suministro_id: 1057, importe: 6374.5, importe_propietario: 0 },
];

test('quita la fila de la cuenta ajena del mismo tipo cuando ya existe la propia', async () => {
  const t = montar(abril());
  const { retirarFilasServicioAjenas } = cargarFns(t.env);
  const n = await retirarFilasServicioAjenas(54214, 4197, 'epe');
  assert.equal(n, 1);
  assert.deepEqual(suministrosDe(t.filas), [55, 1055, 1056, 1057]);       // solo se fue la del EPE (cuenta 54)
  assert.equal(t.avisos.length, 1);
});

test('si no existe la fila propia del tipo, no toca nada (el importe no se pierde)', async () => {
  const t = montar(abril().filter(f => f.suministro_id !== 1056));        // falta la propia de agua
  const { retirarFilasServicioAjenas } = cargarFns(t.env);
  assert.equal(await retirarFilasServicioAjenas(54214, 4197, 'agua'), 0);
  assert.ok(suministrosDe(t.filas).includes(55));
});

test('no toca filas de otro tipo ni las propias', async () => {
  const t = montar(abril());
  const { retirarFilasServicioAjenas } = cargarFns(t.env);
  await retirarFilasServicioAjenas(54214, 4197, 'tgiu');                  // TGIU no tiene filas ajenas
  assert.equal(t.filas.length, 5);
});

test('la marca de "pagado al proveedor" de la fila ajena pasa a la propia', async () => {
  const filas = abril(); filas[0].pagado_proveedor = true; filas[2].pagado_proveedor = false;
  const t = montar(filas);
  const { retirarFilasServicioAjenas } = cargarFns(t.env);
  await retirarFilasServicioAjenas(54214, 4197, 'epe');
  assert.equal(t.filas.find(f => f.suministro_id === 1055).pagado_proveedor, true);
});

test('si no se pueden leer las filas, no falla ni borra nada', async () => {
  const t = montar(abril(), { falla: true });
  const { retirarFilasServicioAjenas } = cargarFns(t.env);
  const aviso = console.warn; console.warn = () => {};
  try { assert.equal(await retirarFilasServicioAjenas(54214, 4197, 'epe'), 0); } finally { console.warn = aviso; }
  assert.equal(t.filas.length, 5);
});

test('también limpia el caché en memoria de la cuenta ajena', async () => {
  const t = montar(abril());
  t.env.window._pagosSuministros[54214] = { 54: { inq: 43986.55, prop: 0 }, 1055: { inq: 43986.55, prop: 0 } };
  const { retirarFilasServicioAjenas } = cargarFns(t.env);
  await retirarFilasServicioAjenas(54214, 4197, 'epe');
  assert.deepEqual(Object.keys(t.env.window._pagosSuministros[54214]), ['1055']);
});

// ---------- el guardado del GP (_syncPagosSuministros): el escenario que generaba el duplicado ----------
test('guardar el mes desde el GP no deja el servicio contado dos veces', async () => {
  // Estado previo: solo las filas ajenas (54 y 55); el campo del GP mostraba esos importes por el respaldo.
  const t = montar([
    { id: 757, pago_id: 54214, suministro_id: 54, importe: 43986.55, importe_propietario: 0 },
    { id: 758, pago_id: 54214, suministro_id: 55, importe: 30343.61, importe_propietario: 0 },
  ]);
  const { _syncPagosSuministros } = cargarFns(t.env);
  await _syncPagosSuministros(54214, 4197, { epe: 43986.55, agua: 30343.61 });
  assert.deepEqual(suministrosDe(t.filas), [1055, 1056]);                 // quedan solo las propias
  const total = t.filas.reduce((s, f) => s + f.importe, 0);
  assert.equal(Math.round(total * 100) / 100, 74330.16);                  // y suman UNA vez cada servicio
});
