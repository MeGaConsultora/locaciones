// Paso 2 de la unificación de importes de servicios: con cuenta real del contrato, el importe va a pagos_suministros
// y el campo viejo (pagos.monto_xxx) se deja en 0 en vez de duplicarlo. Sin cuenta real (sistema viejo) todo igual.
//  - guardarServicioItem ("Cargar Servicios", un servicio)
//  - guardarNuevoMes (formulario de agregar / actualizar un mes)

import test from 'node:test';
import assert from 'node:assert/strict';
import { cargar } from './helpers.mjs';

const SUMINISTROS = [
  { id: 1105, contrato_id: 4562, tipo: 'agua', pct_inquilino: 100, pct_propietario: 0 },
  { id: 1106, contrato_id: 4562, tipo: 'tgiu', pct_inquilino: 100, pct_propietario: 0 },
];
const CONTRATOS = [{ id: 4562, hoja: 'Goitre-Pennacino' }, { id: 9, hoja: 'Viejo-Contrato' }];

// Base en memoria: pagos + pagos_suministros.
function base(pagosIniciales) {
  const pagos = pagosIniciales.map(p => ({ ...p }));
  const ps = [];
  let proximo = 100;
  return {
    pagos, ps,
    sbGet: async (tabla, q) => {
      const eq = [...q.matchAll(/(\w+)=eq\.([^&]+)/g)].map(m => [m[1], decodeURIComponent(m[2])]);
      const filas = tabla === 'pagos' ? pagos : tabla === 'pagos_suministros' ? ps : [];
      return filas.filter(f => eq.every(([k, v]) => String(f[k]) === v)).map(f => ({ ...f }));
    },
    sbPost: async (tabla, fila) => { const r = { id: proximo++, ...fila }; (tabla === 'pagos' ? pagos : ps).push(r); return [r]; },
    sbPatch: async (tabla, id, cambios) => { Object.assign((tabla === 'pagos' ? pagos : ps).find(f => f.id === id), cambios); },
    sbDelete: async (tabla, id) => { ps.splice(ps.findIndex(f => f.id === id), 1); },
  };
}

// ---------- guardarServicioItem ----------
function montarServicio({ sumIds, hoja = 'Goitre-Pennacino', srv = 'tgiu' }) {
  const b = base([{ id: 59648, hoja, mes: '2026-11-01', importe_alquiler: 470000, total: 470000, saldo: 470000, pagado_importe: 0 }]);
  const input = { value: '13053', dataset: { srv, hojas: hoja, sumIds, original: '' } };
  const env = {
    ...b, DB: { contratos: CONTRATOS }, DB_SUMINISTROS: SUMINISTROS,
    parseMonto: v => parseFloat(String(v).replace(',', '.')) || 0,
    document: { getElementById: id => id === 'srv-mes' ? { value: '2026-11' } : id === 'srv-tgiu-g-4562-s1106' ? input : null, querySelector: () => null },
    toast() {}, cargarListaServicios: async () => {}, mostrarSolapa() {},
    getTotalServiciosPago: async (pagoId, tipo, valor) => valor,
    retirarFilasServicioAjenas: async () => 0,
    window: {}, encodeURIComponent,
  };
  const { guardarServicioItem } = cargar('index.html', ['guardarServicioItem'], env);
  return { guardarServicioItem, ...b };
}

test('un servicio con cuenta real: el importe queda en pagos_suministros y el campo viejo en 0', async () => {
  const t = montarServicio({ sumIds: '1106' });
  await t.guardarServicioItem('srv-tgiu-g-4562-s1106');
  assert.equal(t.ps.find(f => f.suministro_id === 1106).importe, 13053);
  assert.equal(t.pagos[0].monto_tgiu, 0);               // antes quedaba 13053 duplicado
});

test('un servicio sin cuenta real (sistema viejo): el importe sigue yendo al campo viejo', async () => {
  const t = montarServicio({ sumIds: '', hoja: 'Viejo-Contrato', srv: 'tgiu' });
  t.pagos[0].hoja = 'Viejo-Contrato';
  const input = { value: '13053', dataset: { srv: 'tgiu', hojas: 'Viejo-Contrato', sumIds: '', original: '' } };
  // reutiliza el mismo entorno pero con el input del contrato viejo
  const env = {
    ...t, DB: { contratos: CONTRATOS }, DB_SUMINISTROS: [],
    parseMonto: v => parseFloat(v) || 0,
    document: { getElementById: id => id === 'srv-mes' ? { value: '2026-11' } : id === 'srv-tgiu-x' ? input : null, querySelector: () => null },
    toast() {}, cargarListaServicios: async () => {}, mostrarSolapa() {},
    getTotalServiciosPago: async (_p, _t, valor) => valor, retirarFilasServicioAjenas: async () => 0, window: {}, encodeURIComponent,
  };
  const { guardarServicioItem } = cargar('index.html', ['guardarServicioItem'], env);
  await guardarServicioItem('srv-tgiu-x');
  assert.equal(t.pagos[0].monto_tgiu, 13053);
  assert.equal(t.ps.length, 0);
});

// ---------- guardarNuevoMes ----------
function montarNuevoMes({ existente = null, form = {}, suministros = SUMINISTROS, hoja = 'Goitre-Pennacino', contratoId = 4562 }) {
  const b = base(existente ? [existente] : []);
  const valores = { 'nm-mes-sel': '2026-12', 'nm-alquiler': '470000', 'nm-epe': '', 'nm-agua': '', 'nm-tgiu': '26106', 'nm-seguro': '', 'nm-vence': '2026-12-10', ...form };
  const env = {
    ...b, DB: { contratos: CONTRATOS }, DB_SUMINISTROS: suministros,
    document: { getElementById: id => id === 'nm-extras' ? null : (id in valores ? { value: valores[id] } : null) },
    toast() {}, recargarGrilla: async () => {}, editarMesConSolapa: async () => {}, closeModal() {}, loadAll: async () => {},
    cargarPantallaGestionPago: async () => {}, formatDate: d => d, window: {}, encodeURIComponent,
    retirarFilasServicioAjenas: async () => 0, pagosActuales: [], extrasActuales: {},
  };
  const { guardarNuevoMes, _syncPagosSuministros } = cargar('index.html', ['guardarNuevoMes', '_syncPagosSuministros'], env);
  return { guardarNuevoMes: () => guardarNuevoMes(hoja, contratoId), ...b };
}

test('mes nuevo con cuenta real: el TGIU va a pagos_suministros y el campo viejo queda en 0', async () => {
  const t = montarNuevoMes({});
  await t.guardarNuevoMes().catch(() => {});
  const pago = t.pagos.find(p => p.mes === '2026-12-01');
  assert.ok(pago, 'se creó el mes');
  assert.equal(pago.monto_tgiu, 0);
  assert.equal(t.ps.find(f => f.suministro_id === 1106)?.importe, 26106);   // antes: ninguna fila, solo el campo viejo
});

test('mes nuevo en un contrato sin cuenta real: el importe sigue en el campo viejo', async () => {
  const t = montarNuevoMes({ suministros: [], hoja: 'Viejo-Contrato', contratoId: 9 });
  await t.guardarNuevoMes().catch(() => {});
  const pago = t.pagos.find(p => p.mes === '2026-12-01');
  assert.equal(pago.monto_tgiu, 26106);
  assert.equal(t.ps.length, 0);
});

test('actualizar un mes: un campo en blanco no toca lo ya cargado en pagos_suministros', async () => {
  const t = montarNuevoMes({ existente: { id: 7, hoja: 'Goitre-Pennacino', mes: '2026-12-01', total: 0, saldo: 0 }, form: { 'nm-tgiu': '' } });
  t.ps.push({ id: 50, pago_id: 7, suministro_id: 1106, importe: 26106, importe_propietario: 0 });
  await t.guardarNuevoMes().catch(() => {});
  assert.equal(t.ps.find(f => f.suministro_id === 1106).importe, 26106);
});
