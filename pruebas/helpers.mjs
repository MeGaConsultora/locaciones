// Utilidades para probar las funciones de cálculo que viven dentro de index.html
// (la app es un único archivo, así que se extraen las funciones por nombre y se
// ejecutan en un entorno aislado, con los datos de prueba que cada test arma).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function leerHtml(archivo = 'index.html') {
  return fs.readFileSync(path.join(RAIZ, archivo), 'utf8').replace(/\r\n/g, '\n');
}

// --- Búsqueda del cierre de un bloque { } saltando strings, comentarios y plantillas ---
function saltarComillas(src, i) {
  const q = src[i];
  let j = i + 1;
  while (j < src.length && src[j] !== q) { if (src[j] === '\\') j++; j++; }
  return j;
}
function saltarPlantilla(src, i) {
  let j = i + 1;
  while (j < src.length && src[j] !== '`') {
    if (src[j] === '\\') j += 2;
    else if (src[j] === '$' && src[j + 1] === '{') j = finDeBloque(src, j + 1) + 1;
    else j++;
  }
  return j;
}
function finDeBloque(src, i) {
  let depth = 0;
  for (; i < src.length; i++) {
    const ch = src[i], nx = src[i + 1];
    if (ch === '/' && nx === '/') { i = src.indexOf('\n', i); if (i < 0) return -1; continue; }
    if (ch === '/' && nx === '*') { i = src.indexOf('*/', i + 2) + 1; continue; }
    if (ch === "'" || ch === '"') { i = saltarComillas(src, i); continue; }
    if (ch === '`') { i = saltarPlantilla(src, i); continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

// Devuelve el código fuente de "function nombre(...) {...}" (o "async function ...")
export function extraerFuncion(src, nombre) {
  const re = new RegExp(`^(async\\s+)?function\\s+${nombre}\\s*\\(`, 'm');
  const m = re.exec(src);
  if (!m) throw new Error(`No se encontró la función ${nombre} en el archivo`);
  const llave = src.indexOf('{', src.indexOf(')', m.index));
  const fin = finDeBloque(src, llave);
  if (fin < 0) throw new Error(`No se pudo delimitar la función ${nombre}`);
  return src.slice(m.index, fin + 1);
}

// Extrae una constante simple de una línea: const NOMBRE = ...;
export function extraerConstante(src, nombre) {
  const m = new RegExp(`^const\\s+${nombre}\\s*=.*;\\s*$`, 'm').exec(src);
  if (!m) throw new Error(`No se encontró la constante ${nombre}`);
  return m[0];
}

// Arma las funciones pedidas, con acceso a las variables globales indicadas en "entorno"
// (por ejemplo DB, TODAY, window...). Devuelve un objeto { nombre: función }.
export function cargar(archivo, nombres, entorno = {}, constantes = []) {
  const src = leerHtml(archivo);
  const codigo = [
    ...constantes.map(c => extraerConstante(src, c)),
    ...nombres.map(n => extraerFuncion(src, n)),
    `return { ${nombres.join(', ')} };`
  ].join('\n');
  const claves = Object.keys(entorno);
  return new Function(...claves, codigo)(...claves.map(k => entorno[k]));
}

export const dinero = n => '$ ' + Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Redondea a centavos para comparar importes sin ruido de coma flotante
export const c2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
