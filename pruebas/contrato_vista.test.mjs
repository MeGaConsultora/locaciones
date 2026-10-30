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
