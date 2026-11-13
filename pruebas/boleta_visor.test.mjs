// Visor de boletas (adjuntos de servicios): "Descargar" baja SOLO la página que se está viendo, nunca el PDF completo
// (que trae las boletas de muchos clientes).

import test from 'node:test';
import assert from 'node:assert/strict';
import { cargar } from './helpers.mjs';

const URL_PDF = 'https://x.supabase.co/storage/v1/object/sign/servicios/agua-oct.pdf?token=abc';

function visor(extra = {}) {
  return cargar('index.html', ['htmlVisorBoleta', 'nombreArchivoBoleta'], { DB: { pagos: [{ id: 7, hoja: 'Cillario-Benz', mes: '2026-10-01' }] }, ...extra });
}
const scriptDe = html => /<script>([\s\S]*?)<\/script>/.exec(html)[1];

// Ejecuta el script del visor con un navegador de mentira y devuelve lo que "bajó".
function ejecutar(html, { falla = false, conLienzo = true } = {}) {
  const registro = { copiadas: [], descargas: [], alertas: [] };
  const dl = { textContent: 'Descargar', onclick: null };
  const lienzo = { toBlob: cb => cb(new Blob(['png'], { type: 'image/png' })) };
  const document = {
    getElementById: id => (id === 'dl' ? dl : { innerHTML: '', textContent: '' }),
    querySelector: () => (conLienzo ? lienzo : null),
    createElement: () => { const a = { click() { registro.descargas.push({ nombre: a.download, tipo: a.__tipo }); }, remove() {} }; return a; },
    body: { appendChild() {} }
  };
  const URLfalsa = { createObjectURL: blob => { return 'blob:' + blob.type; }, revokeObjectURL() {} };
  const PDFLib = { PDFDocument: {
    load: async () => { if (falla) throw new Error('PDF no compatible'); return { origen: true }; },
    create: async () => ({ copyPages: async (o, idx) => { registro.copiadas.push(idx); return ['pagina']; }, addPage() {}, save: async () => new Uint8Array([1, 2, 3]) })
  } };
  const pdfjsLib = { GlobalWorkerOptions: {}, getDocument: () => ({ promise: new Promise(() => {}) }) };
  new Function('document', 'URL', 'fetch', 'PDFLib', 'pdfjsLib', 'Blob', 'alert', 'setTimeout', scriptDe(html))(
    document, URLfalsa, async () => ({ arrayBuffer: async () => new ArrayBuffer(8) }), PDFLib, pdfjsLib, Blob, m => registro.alertas.push(m), () => {});
  return { dl, registro };
}

test('el enlace Descargar no apunta al PDF completo: arma un archivo nuevo al hacer clic', () => {
  const { htmlVisorBoleta } = visor();
  const html = htmlVisorBoleta(URL_PDF, 2, 'Boleta Agua');
  assert.ok(!html.includes(`href="${URL_PDF}"`), 'el enlace no puede apuntar al archivo completo');
  assert.match(html, /<a id="dl">Descargar<\/a>/);
  assert.match(html, /pdf-lib/);
  assert.match(html, /copyPages\(origen, \[PAGINA - 1\]\)/);
});

test('el visor muestra la página pedida y descarga esa misma', async () => {
  const { htmlVisorBoleta } = visor();
  const html = htmlVisorBoleta(URL_PDF, 5, 'Boleta Agua - Cillario-Benz - 2026-10');
  assert.match(html, /PAGINA = 5/);
  const { dl, registro } = ejecutar(html);
  await dl.onclick.call(dl, { preventDefault() {} });
  assert.deepEqual(registro.copiadas, [[4]]);                              // la página 5 es el índice 4: una sola página
  assert.equal(registro.descargas.length, 1);
  assert.equal(registro.descargas[0].nombre, 'Boleta Agua - Cillario-Benz - 2026-10.pdf');
  assert.equal(dl.textContent, 'Descargar');                              // el texto vuelve a la normalidad
});

test('si no se puede armar el PDF de una página, baja la imagen de esa página (nunca el archivo completo)', async () => {
  const { htmlVisorBoleta } = visor();
  const { dl, registro } = ejecutar(htmlVisorBoleta(URL_PDF, 2, 'Boleta Agua'), { falla: true });
  await dl.onclick.call(dl, { preventDefault() {} });
  assert.deepEqual(registro.copiadas, []);
  assert.deepEqual(registro.descargas.map(d => d.nombre), ['Boleta Agua.png']);
});

test('si tampoco hay imagen para bajar, avisa en vez de bajar algo equivocado', async () => {
  const { htmlVisorBoleta } = visor();
  const { dl, registro } = ejecutar(htmlVisorBoleta(URL_PDF, 2, 'Boleta Agua'), { falla: true, conLienzo: false });
  await dl.onclick.call(dl, { preventDefault() {} });
  assert.deepEqual(registro.descargas, []);
  assert.match(registro.alertas[0], /No se pudo preparar la boleta/);
});

test('un nombre con comillas o con </script> no rompe la página del visor', () => {
  const { htmlVisorBoleta } = visor();
  const html = htmlVisorBoleta(URL_PDF, 1, 'Boleta "raro" </script><b>');
  assert.equal((html.match(/<\/script>/g) || []).length, 3, 'solo los 3 cierres propios: 2 externos y el del script del visor');
  assert.doesNotThrow(() => new Function('document', 'URL', 'fetch', 'PDFLib', 'pdfjsLib', 'Blob', 'alert', 'setTimeout',
    scriptDe(html).replace(/document\.getElementById\("dl"\)\.onclick[\s\S]*$/, '')));   // el texto del script sigue siendo JavaScript válido
});

test('nombre del archivo: servicio, contrato y mes; sin caracteres que el sistema de archivos rechaza', () => {
  const { nombreArchivoBoleta } = visor();
  assert.equal(nombreArchivoBoleta({ pago_id: 7, servicio: 'agua' }), 'Boleta Agua - Cillario-Benz - 2026-10');
  assert.equal(nombreArchivoBoleta({ pago_id: 7, servicio: 'tgiu' }), 'Boleta TGIU - Cillario-Benz - 2026-10');
  assert.equal(nombreArchivoBoleta({ pago_id: 999, servicio: 'epe' }), 'Boleta EPE');                       // mes que ya no existe
  const raro = cargar('index.html', ['nombreArchivoBoleta'], { DB: { pagos: [{ id: 1, hoja: 'A/B: "C"?', mes: '2026-01-01' }] } });
  assert.equal(raro.nombreArchivoBoleta({ pago_id: 1, servicio: 'agua' }), 'Boleta Agua - A B C - 2026-01');
});
