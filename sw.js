// Service Worker de MeGa Admin — MeGa Consultora
// Estrategia: "network-first" para TODO. Como esta app cambia seguido,
// siempre se intenta traer la versión más nueva de la red primero; la
// caché solo se usa como respaldo si no hay conexión. Así nunca queda
// pisada una versión vieja por culpa del caché del service worker.
const CACHE_NAME = 'mega-admin-v1';
const ARCHIVOS_BASICOS = ['./', './index.html', './manifest.json'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ARCHIVOS_BASICOS).catch(() => {}))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((nombres) =>
      Promise.all(nombres.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  // Mismo motivo que en el portal inquilino: las llamadas a Supabase
  // nunca deben pasar por este cacheo, para que un fallo puntual de red
  // en una sola consulta no termine mostrando una mezcla de datos
  // viejos (de esa consulta) con datos frescos (del resto) en la misma
  // pantalla. Solo el archivo de la app en sí usa cacheo con respaldo.
  if (event.request.url.includes('supabase.co')) return;
  event.respondWith(
    fetch(event.request)
      .then((respuesta) => {
        const copia = respuesta.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copia)).catch(() => {});
        return respuesta;
      })
      .catch(() => caches.match(event.request))
  );
});
