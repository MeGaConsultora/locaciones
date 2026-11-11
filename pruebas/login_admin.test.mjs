// Ingreso al sistema de gestión: formulario real (el navegador puede guardar y completar usuario y clave),
// el último email se recuerda, y solo una cuenta que entró (aprobada) deja credencial y email guardados.

import test from 'node:test';
import assert from 'node:assert/strict';
import { cargar, extraerFuncion, leerHtml } from './helpers.mjs';

const html = leerHtml('index.html');
const etiqueta = (id) => new RegExp(`<[a-z]+\\b[^>]*\\bid="${id}"[^>]*>`).exec(html)?.[0] || '';

// ---------- estructura de las pantallas ----------
test('ingreso, "olvidé mi contraseña" y registro son formularios reales', () => {
  for (const id of ['login-panel', 'forgot-panel-admin', 'registro-panel']) {
    assert.match(etiqueta(id), /^<form /, `${id} tiene que ser un <form> para que el navegador lo reconozca`);
  }
});

test('el email del ingreso ya no tiene el autocompletado apagado y la clave se declara como clave actual', () => {
  const email = etiqueta('login-email'), clave = etiqueta('login-pass');
  assert.match(email, /autocomplete="username"/);
  assert.doesNotMatch(email, /autocomplete="off"/);
  assert.match(clave, /autocomplete="current-password"/);
  assert.match(email, /name="email"/);
  assert.match(clave, /name="password"/);
});

test('el registro declara el email como usuario y la clave como nueva', () => {
  assert.match(etiqueta('reg-email'), /autocomplete="username"/);
  assert.match(etiqueta('reg-pass'), /autocomplete="new-password"/);
});

test('"Entrar" envía el formulario, y los links "olvidaste / volver" no lo envían', () => {
  const panel = /<form id="login-panel"[\s\S]*?<\/form>/.exec(html)[0];
  assert.match(panel, /<button type="submit" class="login-btn">Entrar<\/button>/);
  assert.match(panel, /<button type="button" onclick="showForgotAdmin\(\)"/);
  const olvido = /<form id="forgot-panel-admin"[\s\S]*?<\/form>/.exec(html)[0];
  assert.match(olvido, /<button type="button" onclick="showLoginAdmin\(\)"/);
});

test('el Enter lo resuelve cada formulario: no queda un atajo global que ingresaría dos veces', () => {
  assert.ok(!/document\.addEventListener\('keydown'[\s\S]{0,200}doLogin\(\)/.test(html), 'no debe haber un listener global de Enter que llame a doLogin');
});

// ---------- recordar el último email ----------
function almacen(inicial = {}) {
  const datos = { ...inicial };
  return { datos, getItem: k => (k in datos ? datos[k] : null), setItem: (k, v) => { datos[k] = String(v); } };
}
function campoEmail(valor = '') { return { value: valor }; }

test('la pantalla de ingreso vuelve a mostrar el último email, sin pisar lo que ya esté escrito', () => {
  const ls = almacen({ adm_ultimo_email: 'hugo@correo.com' });
  const vacio = campoEmail();
  cargar('index.html', ['prellenarEmailLogin'], { localStorage: ls, document: { getElementById: () => vacio } }).prellenarEmailLogin();
  assert.equal(vacio.value, 'hugo@correo.com');
  const escrito = campoEmail('otra@correo.com');
  cargar('index.html', ['prellenarEmailLogin'], { localStorage: ls, document: { getElementById: () => escrito } }).prellenarEmailLogin();
  assert.equal(escrito.value, 'otra@correo.com');
});

test('si no hay email guardado, o el navegador no deja leer, no se rompe nada', () => {
  const campo = campoEmail();
  cargar('index.html', ['prellenarEmailLogin'], { localStorage: almacen(), document: { getElementById: () => campo } }).prellenarEmailLogin();
  assert.equal(campo.value, '');
  const bloqueado = { getItem() { throw new Error('bloqueado'); } };
  assert.doesNotThrow(() => cargar('index.html', ['prellenarEmailLogin'], { localStorage: bloqueado, document: { getElementById: () => campoEmail() } }).prellenarEmailLogin());
});

test('showLoginScreen muestra la pantalla y prellena el email', () => {
  const src = extraerFuncion(html, 'showLoginScreen');
  assert.match(src, /prellenarEmailLogin\(\)/);
});

// ---------- doLogin: qué se guarda y cuándo ----------
function armarDoLogin({ aprobada, authFalla = false, conApi = true }) {
  const mensajes = [], credenciales = [];
  const ls = almacen();
  class PasswordCredential { constructor(d) { Object.assign(this, d); } }
  const navegador = { credentials: { store: async c => { credenciales.push({ id: c.id, password: c.password, name: c.name }); } } };
  const ventana = conApi ? { PasswordCredential } : {};
  const codigo = `
    let currentUser = null; let currentUsuario = null;
    const verificarAprobacion = async () => { if (APROBADA) currentUsuario = { nombre: 'Hugo' }; };
    ${['recordarEmailLogin', 'ofrecerGuardarContrasena', 'doLogin'].map(n => extraerFuncion(html, n)).join('\n')}
    return { doLogin };`;
  const { doLogin } = new Function('APROBADA', 'document', 'localStorage', 'authPost', 'showLoginMsg', 'window', 'navigator', 'PasswordCredential', codigo)(
    aprobada,
    { getElementById: id => ({ value: id === 'login-email' ? '  hugo@correo.com ' : 'MiClave123' }) },
    ls,
    async () => { if (authFalla) throw new Error('credenciales inválidas'); return { access_token: 'tok', refresh_token: 'ref', user: { id: 'u1', email: 'hugo@correo.com' } }; },
    (panel, texto, tipo) => mensajes.push([panel, texto, tipo]),
    ventana, navegador, PasswordCredential);
  return { doLogin, ls, mensajes, credenciales };
}

test('una cuenta aprobada que ingresa: se recuerda el email y se le entrega la credencial al navegador', async () => {
  const t = armarDoLogin({ aprobada: true });
  await t.doLogin();
  assert.equal(t.ls.datos.adm_ultimo_email, 'hugo@correo.com');            // sin los espacios de los costados
  assert.deepEqual(t.credenciales, [{ id: 'hugo@correo.com', password: 'MiClave123', name: 'Hugo' }]);
  assert.equal(t.ls.datos.sb_token, 'tok');
  assert.deepEqual(t.mensajes, []);
});

test('una cuenta que NO quedó adentro (no aprobada) no deja email ni credencial guardados', async () => {
  const t = armarDoLogin({ aprobada: false });
  await t.doLogin();
  assert.equal(t.ls.datos.adm_ultimo_email, undefined);
  assert.deepEqual(t.credenciales, []);
});

test('con clave incorrecta: avisa, y no guarda nada', async () => {
  const t = armarDoLogin({ aprobada: true, authFalla: true });
  await t.doLogin();
  assert.deepEqual(t.mensajes, [['login', 'Email o contraseña incorrectos', 'error']]);
  assert.equal(t.ls.datos.adm_ultimo_email, undefined);
  assert.deepEqual(t.credenciales, []);
});

test('en un navegador sin la API de credenciales, el ingreso funciona igual', async () => {
  const t = armarDoLogin({ aprobada: true, conApi: false });
  await t.doLogin();
  assert.equal(t.ls.datos.adm_ultimo_email, 'hugo@correo.com');
  assert.deepEqual(t.credenciales, []);
  assert.deepEqual(t.mensajes, []);
});
