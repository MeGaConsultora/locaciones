// Prueba del importador de Excel de TGIU/Agua (confirmarImportarExcel): lo que se tilda en la tabla es lo que se carga,
// aunque haya filas "sin contrato" mezcladas, y una falla se informa en vez de decir "importados".

import test from 'node:test';
import assert from 'node:assert/strict';
import { cargar, c2 } from './helpers.mjs';

const MES = '2026-11-01';

function armar({ fallarPatchPagosDe = null } = {}) {
  const contratos = [1, 2, 3, 4, 5].map(id => ({ id, hoja: 'C' + id, titulo: 'C' + id, vigencia_hasta: '2027-06-30' }));
  const suministros = [
    { id: 11, contrato_id: 1, tipo: 'tgiu', nro_cuenta: 'A', pct_inquilino: 100, pct_propietario: 0 },
    { id: 12, contrato_id: 2, tipo: 'tgiu', nro_cuenta: 'B', pct_inquilino: 50, pct_propietario: 50 },     // como Giovenale-Rubiolo
    { id: 13, contrato_id: 3, tipo: 'tgiu', nro_cuenta: 'C', pct_inquilino: 100, pct_propietario: 0 },
    { id: 14, contrato_id: 4, tipo: 'tgiu', nro_cuenta: 'D', pct_inquilino: 25, pct_propietario: 0 },     // comparte con el 5
    { id: 15, contrato_id: 5, tipo: 'tgiu', nro_cuenta: 'D', pct_inquilino: 75, pct_propietario: 0 },
  ];
  const pagos = contratos.map(c => ({ id: 100 + c.id, hoja: c.hoja, mes: MES, importe_alquiler: 100000, total: 100000, saldo: 100000, pagado_importe: 0 }));
  const ps = [];
  let psId = 1;
  const filtrar = (tabla, q) => {
    const filas = tabla === 'pagos' ? pagos : ps;
    const eq = [...q.matchAll(/(\w+)=eq\.([^&]+)/g)].map(m => [m[1], decodeURIComponent(m[2])]);
    return filas.filter(f => eq.every(([k, v]) => String(f[k]) === v)).map(f => ({ ...f }));
  };
  const env = {
    DB: { contratos, pagos },
    DB_SUMINISTROS: suministros,
    window: {}, tildadas: [],
    document: { querySelectorAll: () => env.tildadas.map(i => ({ dataset: { idx: String(i) } })) },
    toasts: [],
    toast: (m, t) => env.toasts.push([m, t]),
    closeModal() {}, loadAll: async () => {}, recargarSuministros: async () => {},
    getEstado: () => 'vigente',
    sbGet: async (tabla, q) => filtrar(tabla, q),
    sbPost: async (tabla, fila) => { ps.push({ id: psId++, ...fila }); },
    sbPatch: async (tabla, id, cambios) => {
      if (tabla === 'pagos') {
        if (fallarPatchPagosDe === id) throw new Error('falla simulada');
        Object.assign(pagos.find(p => p.id === id), cambios);
      } else Object.assign(ps.find(p => p.id === id), cambios);
    },
    encodeURIComponent,
  };
  const { confirmarImportarExcel } = cargar('index.html', ['confirmarImportarExcel', 'getTotalServiciosPago'], env);
  return { env, confirmarImportarExcel, ps, pagos };
}

// Lista COMPLETA como la arma procesarExcelTGIU: filas "sin contrato" mezcladas, que no tienen casilla.
function listaCompleta(env) {
  const fila = (nro, importe, ids) => ({ nro, importe, sinContrato: false,
    contratos: ids.map(id => ({ c: env.DB.contratos.find(c => c.id === id), s: env.DB_SUMINISTROS.find(s => s.contrato_id === id && s.nro_cuenta === nro) })) });
  const sin = (nro, importe) => ({ nro, importe, contrato: null, sinContrato: true });
  return [fila('A', 10000, [1]), sin('X', 5), sin('Y', 6), fila('B', 25483.13, [2]), fila('C', 8000, [3]), sin('Z', 7), fila('D', 40000, [4, 5])];
}
function ejecutar({ env, confirmarImportarExcel }, lista, tildadas) {
  env.window._excelImportData = { resultados: lista, mesKey: '2026-11', srv: 'tgiu' };
  env.tildadas = tildadas;
  return confirmarImportarExcel();
}
const cargado = (t, ctId) => t.ps.filter(r => r.pago_id === 100 + ctId).map(r => c2(r.importe));

test('importar con "seleccionar todos": se carga cada fila con contrato, también las que están debajo de las "sin contrato"', async () => {
  const t = armar();
  const lista = listaCompleta(t.env);
  const tildadas = lista.map((r, i) => (r.sinContrato ? null : i)).filter(i => i !== null);
  await ejecutar(t, lista, tildadas);
  assert.deepEqual(cargado(t, 1), [10000]);
  assert.deepEqual(cargado(t, 2), [12741.57]);          // el 50% (como Giovenale-Rubiolo)
  assert.deepEqual(cargado(t, 3), [8000]);
  assert.deepEqual(cargado(t, 4), [10000]);             // 25% de 40000
  assert.deepEqual(cargado(t, 5), [30000]);             // 75% de 40000
  assert.equal(t.pagos.find(p => p.hoja === 'C2').total, 100000 + 12741.57);
  assert.match(t.env.toasts.at(-1)[0], /^✓ 4 registros importados/);
});

test('importar tildando una sola fila: se carga esa y ninguna otra', async () => {
  const t = armar();
  const lista = listaCompleta(t.env);
  await ejecutar(t, lista, [3]);                         // la fila "B" (contrato 2), debajo de dos "sin contrato"
  assert.deepEqual(cargado(t, 2), [12741.57]);
  for (const id of [1, 3, 4, 5]) assert.deepEqual(cargado(t, id), []);
});

test('una fila "sin contrato" nunca se importa, aunque llegue tildada', async () => {
  const t = armar();
  const lista = listaCompleta(t.env);
  await ejecutar(t, lista, [1, 2]);
  assert.equal(t.ps.length, 0);
  assert.match(t.env.toasts.at(-1)[0], /Seleccioná al menos/);
});

test('si una fila falla al guardar, el aviso lo dice y las demás se cargan igual', async () => {
  const t = armar({ fallarPatchPagosDe: 103 });          // el pago del contrato 3
  const lista = listaCompleta(t.env);
  await ejecutar(t, lista, [0, 3, 4]);
  assert.deepEqual(cargado(t, 1), [10000]);
  assert.deepEqual(cargado(t, 2), [12741.57]);
  const [msg, tipo] = t.env.toasts.at(-1);
  assert.equal(tipo, 'error');
  assert.match(msg, /2 importados · 1 con error \(C\)/);
});
