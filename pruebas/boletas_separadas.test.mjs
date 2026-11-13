// Privacidad de las boletas de servicios: el PDF que se importa (agua, TGIU, EPE…) trae las boletas de MUCHOS clientes.
// Al inquilino nunca se le puede adjuntar ese archivo: cada boleta se guarda como su propio archivo de UNA página
// ("boletas/…"), y en la base el inquilino solo puede leer archivos de ese tipo (sql_historial_local/18_...).
//   Las pruebas con PDF reales requieren pdf-lib y las de SQL requieren PGlite (si no están, se saltean):
//   npm install --no-save pdf-lib @electric-sql/pglite

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { RAIZ, cargar } from './helpers.mjs';

const pdflib = await import('pdf-lib').catch(() => null);
const pglite = await import('@electric-sql/pglite').catch(() => null);
const skipPdf = pdflib ? false : 'pdf-lib no está instalado (npm install --no-save pdf-lib)';
const skipSql = pglite ? false : 'PGlite no está instalado (npm install --no-save @electric-sql/pglite)';
const PDFLib = pdflib && (pdflib.PDFDocument ? pdflib : pdflib.default);

// PDF de prueba: la página n mide (100 + n) de ancho, así se sabe de cuál viene cada una
async function pdfDe(paginas) {
  const doc = await PDFLib.PDFDocument.create();
  for (let n = 1; n <= paginas; n++) doc.addPage([100 + n, 200]);
  return new Uint8Array(await doc.save());
}
async function anchos(bytes) {
  const doc = await PDFLib.PDFDocument.load(bytes);
  return doc.getPages().map(p => Math.round(p.getWidth()));
}

const SB_URL = 'https://x.supabase.co';
const NOMBRES = ['esBoletaSeparada', 'rutaBoletaSeparada', 'separarPaginaPdf', 'subirBoletaSeparada',
  'guardarBoletaSeparada', 'descargarArchivoServicios', 'separarBoletasExistentes'];

// Entorno de mentira: un "Storage" en memoria y una tabla pagos_pdf
function entorno({ filas, archivos = {}, subidaFalla = false }) {
  const guardados = {};                       // lo que se sube: ruta -> bytes
  const bajadas = [];                         // archivos descargados (para ver que cada uno se baja una sola vez)
  const parches = [];
  const tabla = filas.map(f => ({ ...f }));
  const fetchFalso = async (url, op = {}) => {
    const m = String(url);
    if (m.includes('/object/sign/') && op.method === 'POST') {
      const ruta = m.split('/object/sign/servicios/')[1];
      return { ok: true, json: async () => (ruta in archivos ? { signedURL: `/object/sign/servicios/${ruta}?token=t` } : { error: 'Object not found' }) };
    }
    if (m.includes('/object/sign/')) {
      const ruta = m.split('/object/sign/servicios/')[1].split('?')[0];
      bajadas.push(ruta);
      return { ok: true, status: 200, arrayBuffer: async () => archivos[ruta].buffer.slice(archivos[ruta].byteOffset, archivos[ruta].byteOffset + archivos[ruta].byteLength) };
    }
    if (m.includes('/object/servicios/') && op.method === 'POST') {
      if (subidaFalla) return { ok: false, status: 500 };
      guardados[m.split('/object/servicios/')[1]] = op.body;
      return { ok: true, status: 200 };
    }
    throw new Error('pedido inesperado: ' + m);
  };
  const env = {
    PDFLib, SB_URL, SB_KEY: 'k', HEADERS: { Authorization: 'Bearer t' }, fetch: fetchFalso, console: { error() {}, log() {} },
    sbGetAll: async () => tabla.map(f => ({ ...f })),
    sbPatch: async (t, id, cambios) => { parches.push({ t, id, cambios }); Object.assign(tabla.find(f => f.id === id), cambios); }
  };
  return { ...cargar('index.html', NOMBRES, env, ['RUTA_BOLETAS']), guardados, bajadas, parches, tabla };
}

test('rutas: lo separado va bajo "boletas/" y el nombre queda limpio', () => {
  const { esBoletaSeparada, rutaBoletaSeparada } = entorno({ filas: [] });
  assert.equal(esBoletaSeparada('boletas/12/agua_5.pdf'), true);
  assert.equal(esBoletaSeparada('agua/2026-10/1700_agua.pdf'), false);        // el PDF completo viejo
  assert.equal(esBoletaSeparada('xboletas/1/a.pdf'), false);
  assert.equal(esBoletaSeparada(null), false);
  assert.equal(esBoletaSeparada(undefined), false);
  const r = rutaBoletaSeparada(12, 'agua', '1700_p3');
  assert.equal(r, 'boletas/12/agua_1700_p3.pdf');
  assert.ok(esBoletaSeparada(rutaBoletaSeparada('../x', 'a b/ñ', '1')));
  assert.ok(!rutaBoletaSeparada('../x', 'a b/ñ', '1').includes('..') || rutaBoletaSeparada('../x', 'a b/ñ', '1').startsWith('boletas/'));
});

test('separarPaginaPdf: devuelve un PDF de UNA sola página, la pedida', { skip: skipPdf }, async () => {
  const { separarPaginaPdf } = entorno({ filas: [] });
  const grande = await pdfDe(6);
  for (const n of [1, 4, 6]) assert.deepEqual(await anchos(await separarPaginaPdf(grande, n)), [100 + n]);
  await assert.rejects(() => separarPaginaPdf(grande, 7));                   // una página que no existe no se inventa
});

test('al importar: se sube un archivo de una página y se devuelve su ruta; nunca el PDF completo', { skip: skipPdf }, async () => {
  const e = entorno({ filas: [] });
  const grande = await pdfDe(5);
  const ruta = await e.guardarBoletaSeparada(77, 'agua', 3, grande);
  assert.match(ruta, /^boletas\/77\/agua_\d+_p3\.pdf$/);
  assert.deepEqual(Object.keys(e.guardados), [ruta]);
  assert.deepEqual(await anchos(e.guardados[ruta]), [103]);                  // una sola página, la 3
});

test('al importar: si no se puede subir o el PDF está dañado, devuelve null (no un archivo completo)', { skip: skipPdf }, async () => {
  const falla = entorno({ filas: [], subidaFalla: true });
  assert.equal(await falla.guardarBoletaSeparada(1, 'agua', 1, await pdfDe(2)), null);
  const roto = entorno({ filas: [] });
  assert.equal(await roto.guardarBoletaSeparada(1, 'agua', 1, new Uint8Array([1, 2, 3])), null);
  assert.deepEqual(Object.keys(roto.guardados), []);
  const fueraDeRango = entorno({ filas: [] });
  assert.equal(await fueraDeRango.guardarBoletaSeparada(1, 'agua', 9, await pdfDe(2)), null);
});

async function escenario() {
  const grande = await pdfDe(4);       // 4 boletas de clientes distintos
  const sola = await pdfDe(1);
  return entorno({
    archivos: { 'agua/oct/grande.pdf': grande, 'tgiu/oct/sola.pdf': sola, 'agua/oct/otro.pdf': await pdfDe(2) },
    filas: [
      { id: 1, pago_id: 10, servicio: 'agua', pdf_path: 'agua/oct/grande.pdf', pdf_pagina: 1 },
      { id: 2, pago_id: 11, servicio: 'agua', pdf_path: 'agua/oct/grande.pdf', pdf_pagina: 3 },
      { id: 3, pago_id: 12, servicio: 'agua', pdf_path: 'agua/oct/grande.pdf', pdf_pagina: 4 },
      { id: 4, pago_id: 13, servicio: 'tgiu', pdf_path: 'tgiu/oct/sola.pdf', pdf_pagina: 1 },
      { id: 5, pago_id: 14, servicio: 'agua', pdf_path: 'boletas/14/agua_5.pdf', pdf_pagina: 1 },      // ya separada
      { id: 6, pago_id: 15, servicio: 'agua', pdf_path: 'agua/oct/otro.pdf', pdf_pagina: 9 },         // página inexistente
      { id: 7, pago_id: 16, servicio: 'agua', pdf_path: 'agua/oct/perdido.pdf', pdf_pagina: 1 },      // el archivo ya no está
      { id: 8, pago_id: 17, servicio: 'agua', pdf_path: null, pdf_pagina: null }
    ]
  });
}

test('migración: solo contar no modifica nada', { skip: skipPdf }, async () => {
  const e = await escenario();
  const r = await e.separarBoletasExistentes({ soloContar: true });
  assert.equal(r.total, 8); assert.equal(r.pendientes, 6); assert.equal(r.yaSeparadas, 1); assert.equal(r.sinArchivo, 1); assert.equal(r.archivos, 4);
  assert.deepEqual(e.parches, []); assert.deepEqual(e.guardados, {}); assert.deepEqual(e.bajadas, []);
});

test('migración: cada boleta queda en su propio archivo de una página, con SU página', { skip: skipPdf }, async () => {
  const e = await escenario();
  const r = await e.separarBoletasExistentes({ soloContar: false });
  assert.equal(r.separadas, 4);
  const porId = id => e.tabla.find(f => f.id === id);
  for (const id of [1, 2, 3, 4]) {
    assert.match(porId(id).pdf_path, /^boletas\//);
    assert.equal(porId(id).pdf_pagina, 1);
  }
  // el archivo de cada fila tiene exactamente una página y es la que correspondía (ancho = 100 + página original)
  assert.deepEqual(await anchos(e.guardados[porId(1).pdf_path]), [101]);
  assert.deepEqual(await anchos(e.guardados[porId(2).pdf_path]), [103]);
  assert.deepEqual(await anchos(e.guardados[porId(3).pdf_path]), [104]);
  assert.deepEqual(await anchos(e.guardados[porId(4).pdf_path]), [101]);
  // ninguno de los archivos nuevos tiene más de una página
  for (const bytes of Object.values(e.guardados)) assert.equal((await anchos(bytes)).length, 1);
  // cada archivo origen se descarga una sola vez aunque tenga varias boletas
  assert.equal(e.bajadas.filter(x => x === 'agua/oct/grande.pdf').length, 1);
  // lo que no se pudo queda como estaba y se informa
  assert.deepEqual(r.fallidas.map(f => f.id).sort(), [6, 7]);
  assert.equal(porId(6).pdf_path, 'agua/oct/otro.pdf');
  assert.equal(porId(7).pdf_path, 'agua/oct/perdido.pdf');
  assert.equal(porId(5).pdf_path, 'boletas/14/agua_5.pdf');                 // la ya separada no se toca
  assert.ok(!e.parches.some(p => p.id === 5 || p.id === 8));
  // respaldo para poder volver atrás
  assert.equal(r.mapeo.length, 4);
  assert.deepEqual(r.mapeo.find(m => m.id === 2).antes, { pdf_path: 'agua/oct/grande.pdf', pdf_pagina: 3 });
});

test('migración: se puede repetir sin duplicar ni rehacer lo ya separado', { skip: skipPdf }, async () => {
  const e = await escenario();
  await e.separarBoletasExistentes({ soloContar: false });
  const subidos = Object.keys(e.guardados).length, parchesAntes = e.parches.length;
  const otra = await e.separarBoletasExistentes({ soloContar: false });
  assert.equal(otra.separadas, 0);
  assert.equal(Object.keys(e.guardados).length, subidos);
  assert.equal(e.parches.length, parchesAntes);
  assert.deepEqual(otra.fallidas.map(f => f.id).sort(), [6, 7]);            // solo reintenta las que fallaron
});

test('migración: si no se puede subir el archivo nuevo, la fila NO cambia (sigue apuntando a lo de antes)', { skip: skipPdf }, async () => {
  const e = entorno({ archivos: { 'a/g.pdf': await pdfDe(3) }, subidaFalla: true,
    filas: [{ id: 1, pago_id: 1, servicio: 'agua', pdf_path: 'a/g.pdf', pdf_pagina: 2 }] });
  const r = await e.separarBoletasExistentes({ soloContar: false });
  assert.equal(r.separadas, 0); assert.equal(r.fallidas.length, 1);
  assert.deepEqual(e.parches, []);
  assert.equal(e.tabla[0].pdf_path, 'a/g.pdf');
});

// ---------- Importación (confirmarImportarPDF): qué se adjunta ----------
function importador({ ruta, bytes = new Uint8Array([1]) }) {
  const posts = [], borrados = [], parches = [], avisos = [];
  const win = { _pdfResultados: [{ contrato: { id: 1, hoja: 'A-B', titulo: 'A-B' }, importe: 1000, pagina: 7, cuenta: '55' }],
    _pdfMes: '2026-10', _pdfSrv: 'agua', _pdfFileName: 'agua/2026-10/COMPLETO.pdf', _pdfBytes: bytes };
  const env = {
    window: win, document: { querySelector: () => ({ checked: true, disabled: false }) }, toast() {}, alert: m => avisos.push(m),
    recargarSuministros: async () => {}, resetImportarPDF() {}, loadAll() {}, console: { error() {}, log() {} },
    DB_SUMINISTROS: [{ id: 5, contrato_id: 1, tipo: 'agua', nro_cuenta: '55', pct_inquilino: 100, pct_propietario: 0 }],
    getEstado: () => 'vigente', retirarFilasServicioAjenas: async () => {}, getTotalServiciosPago: async (p, s, t) => t,
    sbGet: async (t) => (t === 'pagos' ? [{ id: 99, importe_alquiler: 5000, total: 5000, saldo: 5000 }] : t === 'pagos_suministros' ? [{ suministro_id: 5, importe: 1000 }] : []),
    sbPatch: async (t, id, c) => parches.push({ t, id, c }), sbPost: async (t, c) => posts.push({ t, c }),
    sbDeleteWhere: async (t, f) => borrados.push({ t, f }),
    guardarBoletaSeparada: async () => ruta
  };
  return { ...cargar('index.html', ['confirmarImportarPDF'], env), posts, borrados, parches, avisos, win };
}
const adjuntos = e => e.posts.filter(p => p.t === 'pagos_pdf');

test('importar: se adjunta el archivo de UNA página, nunca el PDF completo', async () => {
  const e = importador({ ruta: 'boletas/99/agua_1_p7.pdf' });
  await e.confirmarImportarPDF();
  assert.equal(adjuntos(e).length, 1);
  assert.equal(adjuntos(e)[0].c.pdf_path, 'boletas/99/agua_1_p7.pdf');
  assert.equal(adjuntos(e)[0].c.pdf_pagina, 1);
  assert.equal(adjuntos(e)[0].c.pago_id, 99);
  assert.notEqual(adjuntos(e)[0].c.pdf_path, e.win._pdfFileName);
});

test('importar: si no se pudo separar, se cargan los importes pero SIN adjunto, y se avisa', async () => {
  const e = importador({ ruta: null });
  await e.confirmarImportarPDF();
  assert.equal(adjuntos(e).length, 0);                                       // no se enlaza el archivo completo
  assert.ok(!e.borrados.some(b => b.t === 'pagos_pdf'));                     // y no se borra un adjunto que ya hubiera
  assert.ok(e.parches.some(p => p.t === 'pagos'), 'los importes se cargan igual');
  assert.match(e.avisos[0], /SIN adjunto/);
});

test('importar: sin los datos del PDF no se adjunta nada', async () => {
  const e = importador({ ruta: 'boletas/x.pdf', bytes: null });
  await e.confirmarImportarPDF();
  assert.equal(adjuntos(e).length, 0);
});

// ---------- Portal del inquilino ----------
test('portal inquilino: solo se enlaza el archivo si es una boleta propia (boletas/…)', () => {
  const { boletaEsArchivoPropio } = cargar('../inquilinos-repo/index.html', ['boletaEsArchivoPropio'], {});
  assert.equal(boletaEsArchivoPropio('boletas/10/agua_1.pdf'), true);
  assert.equal(boletaEsArchivoPropio('agua/2026-10/1700_agua.pdf'), false);
  assert.equal(boletaEsArchivoPropio(''), false);
  assert.equal(boletaEsArchivoPropio(null), false);
});

test('portal inquilino: el botón Descargar solo trae enlace directo cuando el archivo es propio', () => {
  const src = fs.readFileSync(path.join(RAIZ, '..', 'inquilinos-repo', 'index.html'), 'utf8');
  assert.match(src, /\$\{propio \? `href="\$\{signedUrl\}" ` : ''\}download/);       // sin href si no es propio
  assert.match(src, /const propio = boletaEsArchivoPropio\(pdfRec\.pdf_path\);/);      // "propio" sale del nombre del archivo, no es fijo
  assert.match(src, /if \(dlLink && !propio\)/);                                     // el enlace a la imagen solo para los viejos
  assert.ok(!/<a href="\$\{signedUrl\}" download/.test(src), 'el enlace directo no puede estar siempre presente');
});

// ---------- Base de datos: el inquilino solo lee archivos "boletas/…" de sus propios pagos ----------
async function baseConStorage() {
  const db = new pglite.PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema storage;
    create table storage.objects (id serial primary key, bucket_id text, name text);
    alter table storage.objects enable row level security;
    create table public.pagos_pdf (id serial primary key, pago_id bigint, servicio text, pdf_path text);
    create function public.es_admin_activo() returns boolean language sql as $$ select coalesce(current_setting('test.admin', true), '') = '1' $$;
    create function public.es_mi_pago(p bigint) returns boolean language sql as $$ select p::text = any(string_to_array(coalesce(current_setting('test.pagos', true), ''), ',')) $$;
    grant usage on schema public, storage to authenticated;
    grant select on storage.objects, public.pagos_pdf to authenticated;
    grant execute on all functions in schema public to authenticated;
    -- la política que existía antes (04_storage_buckets.sql)
    create policy "admin acceso total servicios" on storage.objects for all using (bucket_id = 'servicios' and public.es_admin_activo());
    create policy "inquilino lee sus boletas de servicios" on storage.objects for select using (
      bucket_id = 'servicios' and exists (select 1 from public.pagos_pdf pp where pp.pdf_path = storage.objects.name and public.es_mi_pago(pp.pago_id)));
  `);
  return db;
}
async function comoUsuario(db, { pagos = '', admin = false }, consulta) {
  await db.exec(`select set_config('test.pagos', '${pagos}', false), set_config('test.admin', '${admin ? 1 : 0}', false); set role authenticated;`);
  try { return (await db.query(consulta)).rows.map(r => r.name).sort(); }
  finally { await db.exec('reset role'); }
}
const SQL18 = fs.readFileSync(path.join(RAIZ, 'sql_historial_local', '18_boletas_solo_separadas.sql'), 'utf8');

test('SQL 18: antes, el inquilino podía leer el PDF completo; después solo su archivo de una página', { skip: skipSql }, async () => {
  const db = await baseConStorage();
  await db.exec(`
    insert into storage.objects (bucket_id, name) values
      ('servicios','agua/oct/COMPLETO.pdf'), ('servicios','boletas/10/agua_1.pdf'), ('servicios','boletas/11/agua_2.pdf'), ('servicios','boletas/12/tgiu_3.pdf'), ('otro','boletas/10/x.pdf');
    -- pagos 10 y 11 son de este inquilino; el 10 todavía apunta al PDF completo (caso previo a la migración)
    insert into public.pagos_pdf (pago_id, servicio, pdf_path) values (10,'agua','agua/oct/COMPLETO.pdf'), (11,'agua','boletas/11/agua_2.pdf'), (12,'tgiu','boletas/12/tgiu_3.pdf');
  `);
  const ver = 'select name from storage.objects';
  assert.deepEqual(await comoUsuario(db, { pagos: '10,11' }, ver), ['agua/oct/COMPLETO.pdf', 'boletas/11/agua_2.pdf']);   // el problema de antes

  // sin terminar la migración, el script se detiene y no cambia nada
  await assert.rejects(() => db.exec(SQL18), /Todavía hay 1 boleta/);
  await db.exec('rollback');
  assert.deepEqual(await comoUsuario(db, { pagos: '10,11' }, ver), ['agua/oct/COMPLETO.pdf', 'boletas/11/agua_2.pdf']);

  // migración hecha: el pago 10 pasa a su archivo de una página
  await db.exec(`update public.pagos_pdf set pdf_path = 'boletas/10/agua_1.pdf' where pago_id = 10`);
  await db.exec(SQL18);
  assert.deepEqual(await comoUsuario(db, { pagos: '10,11' }, ver), ['boletas/10/agua_1.pdf', 'boletas/11/agua_2.pdf']);
  assert.deepEqual(await comoUsuario(db, { pagos: '12' }, ver), ['boletas/12/tgiu_3.pdf']);                 // solo la suya
  assert.deepEqual(await comoUsuario(db, { pagos: '' }, ver), []);                                          // sin pagos propios, nada
});

test('SQL 18: aunque el PDF completo figure en los pagos del inquilino, ya no lo puede abrir', { skip: skipSql }, async () => {
  const db = await baseConStorage();
  await db.exec(`
    insert into storage.objects (bucket_id, name) values ('servicios','agua/oct/COMPLETO.pdf'), ('servicios','boletas/10/agua_1.pdf');
    insert into public.pagos_pdf (pago_id, servicio, pdf_path) values (10,'agua','boletas/10/agua_1.pdf');
  `);
  await db.exec(SQL18);
  await db.exec(`insert into public.pagos_pdf (pago_id, servicio, pdf_path) values (10,'agua','agua/oct/COMPLETO.pdf')`);   // un registro viejo que reaparece
  assert.deepEqual(await comoUsuario(db, { pagos: '10' }, 'select name from storage.objects'), ['boletas/10/agua_1.pdf']);
});

test('SQL 18: el administrador sigue pudiendo leer todo (incluido el PDF completo)', { skip: skipSql }, async () => {
  const db = await baseConStorage();
  await db.exec(`insert into storage.objects (bucket_id, name) values ('servicios','agua/oct/COMPLETO.pdf'), ('servicios','boletas/10/agua_1.pdf');`);
  await db.exec(SQL18);
  assert.deepEqual(await comoUsuario(db, { admin: true }, 'select name from storage.objects'), ['agua/oct/COMPLETO.pdf', 'boletas/10/agua_1.pdf']);
});

test('SQL 18: correrlo dos veces es seguro', { skip: skipSql }, async () => {
  const db = await baseConStorage();
  await db.exec(SQL18);
  await db.exec(SQL18);
  const { rows } = await db.query(`select count(*)::int n from pg_policies where tablename = 'objects' and policyname = 'inquilino lee sus boletas de servicios'`);
  assert.equal(rows[0].n, 1);
});
