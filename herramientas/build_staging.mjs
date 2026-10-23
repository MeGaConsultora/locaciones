// Arma la copia de PRUEBA del sistema de gestión (locaciones) a partir de la
// versión que tenés en esta carpeta (aunque todavía no esté subida a producción).
//
//   node herramientas/build_staging.mjs                 (usa herramientas/staging.config.json)
//   node herramientas/build_staging.mjs --config otro.json --out ../locaciones-staging-repo
//
// Qué cambia en la copia de prueba (la de producción NO se toca):
//  * Apunta a OTRO proyecto de Supabase (el de prueba), nunca al real.
//  * Todo lo que guarda en el navegador (sesión, avisos, etc.) usa un prefijo
//    propio ("stg:"), porque prueba y producción comparten dirección
//    (megaconsultora.github.io) y, sin esto, se pisarían las sesiones.
//  * Muestra una franja roja "AMBIENTE DE PRUEBA" con la versión que se está probando.
//  * No instala la app (sin service worker ni manifiesto) y apaga el selector
//    "Ver como…" (llevaría a los portales reales).
//
// Seguridad: se rechaza cualquier clave que no sea la "anon" (pública) y
// cualquier URL que sea la del proyecto real.

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROYECTO_REAL = 'hpufcseedvdmcoamundr';

const arg = (nombre, porDefecto) => { const i = process.argv.indexOf(nombre); return i >= 0 ? process.argv[i + 1] : porDefecto; };
const rutaConfig = path.resolve(RAIZ, arg('--config', 'herramientas/staging.config.json'));
if (!fs.existsSync(rutaConfig)) {
  console.error(`No existe ${rutaConfig}\nCopiá herramientas/staging.config.example.json a staging.config.json y completalo.`);
  process.exit(1);
}
const cfg = JSON.parse(fs.readFileSync(rutaConfig, 'utf8'));
const salida = path.resolve(RAIZ, arg('--out', cfg.outDir || '../locaciones-staging-repo'));

// ---- Validaciones de seguridad ----
const falla = m => { console.error('✖ ' + m); process.exit(1); };
if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(cfg.supabaseUrl || '')) falla('supabaseUrl debe ser algo como https://xxxxxxxx.supabase.co (sin barra final).');
if (cfg.supabaseUrl.includes(PROYECTO_REAL)) falla('Esa es la URL del proyecto REAL. La copia de prueba tiene que usar otro proyecto.');
if (!cfg.anonKey) falla('Falta anonKey.');
if (cfg.anonKey.includes(PROYECTO_REAL)) falla('Esa clave pertenece al proyecto real.');
if (cfg.anonKey.startsWith('eyJ')) {
  let rol = '';
  try { rol = JSON.parse(Buffer.from(cfg.anonKey.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()).role; } catch (e) {}
  if (rol !== 'anon') falla(`La clave tiene rol "${rol || 'desconocido'}": solo se admite la clave "anon" (pública). La service_role NUNCA va en el código.`);
} else if (!cfg.anonKey.startsWith('sb_publishable_')) {
  falla('La clave no parece una anon/publishable de Supabase.');
}
if (/service_role|sb_secret_/.test(cfg.anonKey)) falla('Eso es una clave secreta. No se puede usar.');

// ---- Versión que se está probando ----
let version = 'sin git';
try {
  const hash = execSync('git rev-parse --short HEAD', { cwd: RAIZ }).toString().trim();
  const sucio = execSync('git status --porcelain -- index.html', { cwd: RAIZ }).toString().trim() !== '';
  version = hash + (sucio ? ' + cambios sin subir' : '');
} catch (e) {}
const ahora = new Date().toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

// ---- Copia de archivos estáticos (sin tooling, SQL ni documentación) ----
fs.mkdirSync(salida, { recursive: true });
const EXCLUIR = new Set(['.git', 'node_modules', 'herramientas', 'sql_historial_local', 'CONTEXTO_PROYECTO.md', 'sw.js', 'manifest.json', 'index.html']);
for (const f of fs.readdirSync(RAIZ)) {
  if (EXCLUIR.has(f)) continue;
  const origen = path.join(RAIZ, f);
  if (fs.statSync(origen).isFile()) fs.copyFileSync(origen, path.join(salida, f));
}

// ---- Transformación de index.html ----
let html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
const crlf = html.includes('\r\n');
if (crlf) html = html.replace(/\r\n/g, '\n');
const cambios = [];
const reemplazar = (que, regex, nuevo) => {
  if (!regex.test(html)) falla(`No se encontró ${que} en index.html: el script de prueba necesita actualizarse.`);
  html = html.replace(regex, () => nuevo);
  cambios.push(que);
};

reemplazar('SB_URL', /const SB_URL = '[^']*';/, `const SB_URL = '${cfg.supabaseUrl}';`);
reemplazar('SB_KEY', /const SB_KEY = '[^']*';/, `const SB_KEY = '${cfg.anonKey}';`);
reemplazar('título', /<title>/, '<title>[PRUEBA] ');
reemplazar('manifiesto PWA', /<link rel="manifest" href="manifest.json">\n?/, '');
reemplazar('registro del service worker', /<script>\n\s*if \('serviceWorker' in navigator\) \{[\s\S]*?\n<\/script>\n?/, '');
reemplazar('selector "Ver como…"', /async function cargarSelectorPortal\(\) \{/, 'async function cargarSelectorPortal() { return; // apagado en la copia de prueba\n ');

// Almacenamiento del navegador con prefijo propio (va como primer script del <head>)
const shim = `<script>
/* AMBIENTE DE PRUEBA: todo lo que se guarda en el navegador lleva el prefijo "stg:" para no pisar las sesiones de producción */
(function () {
  const real = window.localStorage, P = 'stg:';
  const claves = () => { const k = []; for (let i = 0; i < real.length; i++) { const n = real.key(i); if (n.startsWith(P)) k.push(n.slice(P.length)); } return k; };
  const sustituto = {
    getItem: k => real.getItem(P + k), setItem: (k, v) => real.setItem(P + k, v), removeItem: k => real.removeItem(P + k),
    clear: () => claves().forEach(k => real.removeItem(P + k)), key: i => claves()[i] ?? null,
    get length() { return claves().length; }
  };
  Object.defineProperty(window, 'localStorage', { configurable: true, get: () => sustituto });
})();
</script>`;
reemplazar('almacenamiento con prefijo', /<head>\n/, '<head>\n' + shim + '\n');

// Franja de aviso
const franja = `<div id="franja-prueba" style="position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#c0392b;color:#fff;text-align:center;font:600 12px/22px sans-serif;letter-spacing:.03em;pointer-events:none">⚠ AMBIENTE DE PRUEBA — los datos no son reales · versión ${version} · armado ${ahora}</div>
<style>body{padding-top:22px !important}</style>`;
reemplazar('franja de aviso', /<body>\n?/, '<body>\n' + franja + '\n');

if (crlf) html = html.replace(/\n/g, '\r\n');
fs.writeFileSync(path.join(salida, 'index.html'), html);

// Que no quede rastro del proyecto real ni de claves secretas
const restos = [PROYECTO_REAL, 'service_role', 'sb_secret_'].filter(t => html.includes(t));
if (restos.length) { console.warn('⚠ Atención: la copia todavía contiene: ' + restos.join(', ') + ' — revisalo antes de subirla.'); }

console.log(`✔ Copia de prueba lista en ${salida}`);
console.log(`  Proyecto de prueba: ${cfg.supabaseUrl}`);
console.log(`  Versión: ${version}`);
console.log(`  Cambios aplicados: ${cambios.join(', ')}`);
