// Un servicio (TGIU, EPE…) cargado solo en el campo viejo pagos.monto_xxx, sin fila en pagos_suministros:
// la grilla lo suma (calcularTotal) y "Ingresar Pago" / el recibo tienen que ofrecerlo igual.
// Caso real: Goitre-Pennacino nov 2026, TGIU $13.053 — figuraba en la grilla pero no salía en el recibo
// hasta volver a guardar los importes en el GP.

import test from 'node:test';
import assert from 'node:assert/strict';
import { cargar } from './helpers.mjs';

// Cuentas del contrato 1 (como Goitre-Pennacino): EPE, agua, TGIU y seguro, todas 100% del inquilino.
const SUMINISTROS = [
  { id: 1104, contrato_id: 1, tipo: 'epe', pct_inquilino: 100 },
  { id: 1105, contrato_id: 1, tipo: 'agua', pct_inquilino: 100 },
  { id: 1106, contrato_id: 1, tipo: 'tgiu', pct_inquilino: 100 },
  { id: 1110, contrato_id: 1, tipo: 'seguro', pct_inquilino: 100 },
];

function pendientes(ps) {
  const env = { window: { _pagosSuministros: { 59648: ps } }, DB_SUMINISTROS: SUMINISTROS };
  return cargar('index.html', ['redondear2', 'montoServicioInquilino', 'obtenerItemsPendientesGP'], env).obtenerItemsPendientesGP;
}
const valor = (items, id) => items.find(i => i.id === id)?.val;

// Mes sin ninguna fila de TGIU en pagos_suministros; el importe está en monto_tgiu.
const psSinTgiu = { 1104: { inq: 0, prop: 0 }, 1105: { inq: 14802.64, prop: 0 }, 1110: { inq: 15000, prop: 0 } };
const mesConTgiuViejo = { id: 59648, importe_alquiler: 470000, monto_tgiu: 13053, monto_epe: 0, total: 512855.64, saldo: 512855.64, pagado_importe: 0 };

test('TGIU en el campo viejo (sin fila en pagos_suministros) se ofrece para cobrar', () => {
  const items = pendientes(psSinTgiu)(mesConTgiuViejo, 1);
  assert.equal(valor(items, 'tgiu'), 13053);
  assert.equal(valor(items, 'agua'), 14802.64);      // lo que sí está en pagos_suministros sigue igual
  assert.equal(valor(items, 'seguro'), 15000);
});

test('si hay fila en pagos_suministros manda esa, aunque el campo viejo tenga otro valor', () => {
  const ps = { ...psSinTgiu, 1106: { inq: 13053, prop: 0 } };
  const items = pendientes(ps)({ ...mesConTgiuViejo, monto_tgiu: 99999 }, 1);
  assert.equal(valor(items, 'tgiu'), 13053);
});

test('una fila con importe 0 en pagos_suministros no se pisa con el campo viejo', () => {
  const ps = { ...psSinTgiu, 1106: { inq: 0, prop: 0 } };
  const items = pendientes(ps)(mesConTgiuViejo, 1);
  assert.equal(valor(items, 'tgiu'), undefined);     // cargado en 0 a propósito: no se cobra
});

test('contrato sin cuenta real de ese servicio (sistema viejo): usa el campo viejo, como siempre', () => {
  const env = { window: { _pagosSuministros: {} }, DB_SUMINISTROS: [] };
  const { montoServicioInquilino } = cargar('index.html', ['montoServicioInquilino'], env);
  assert.equal(montoServicioInquilino({ monto_tgiu: 5000 }, 1, 'tgiu', {}), 5000);
});
