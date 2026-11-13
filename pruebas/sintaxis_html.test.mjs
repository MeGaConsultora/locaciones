// Guarda general: los <script> de index.html tienen que compilar tal como los lee el navegador.
// El navegador cierra un <script> en la PRIMERA aparición de la etiqueta de cierre, aunque esté dentro de un
// comentario o de un texto. Una sola así corta todo el código de la página y la deja sin funcionar (se probó con un
// comentario). Las pruebas que extraen funciones por nombre no lo ven; esta sí.

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { leerHtml } from './helpers.mjs';

for (const archivo of ['index.html']) {
  test(`${archivo}: cada <script> en línea compila como lo lee el navegador`, () => {
    const html = leerHtml(archivo);
    const bloques = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
    assert.ok(bloques.length > 0, 'no se encontraron scripts en línea');
    bloques.forEach((codigo, i) => {
      assert.doesNotThrow(() => new vm.Script(codigo), `el script en línea #${i + 1} tiene un error de sintaxis (¿una etiqueta de cierre de script dentro de un texto o comentario?)`);
    });
  });
}
