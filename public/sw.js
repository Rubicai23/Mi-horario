/* Service worker de "Mi horario".
 *  - Navegación (HTML): red primero con caché de respaldo → los despliegues nuevos llegan solos y funciona sin conexión.
 *  - Recursos con hash (JS, CSS, imágenes): caché primero → arranque instantáneo.
 * __BUILD_ID__ lo sustituye el build (scripts/stamp-sw.js): cada despliegue usa una caché nueva
 * y las anteriores se borran, así que no hay que subir ningún número de versión a mano. */
const BUILD = '__BUILD_ID__';
const CACHE = `mi-horario-${BUILD}`;
const PRECACHE = ['./', './manifest.json', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];
const NAVIGATION_TIMEOUT_MS = 4000;

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => Promise.all(PRECACHE.map(url => cache.add(url).catch(() => { /* uno que falle no bloquea la instalación */ }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('mi-horario-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return; // Firebase y demás APIs van siempre a la red
  event.respondWith(request.mode === 'navigate' ? networkFirst(request) : cacheFirst(request));
});

async function networkFirst(request) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NAVIGATION_TIMEOUT_MS);
  try {
    const response = await fetch(request, { signal: controller.signal });
    if (response && response.ok) {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(request, copy));
    }
    return response;
  } catch (error) {
    const cached = (await caches.match(request, { ignoreSearch: true })) || (await caches.match('./'));
    if (cached) return cached;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok && response.type === 'basic') {
    const copy = response.clone();
    caches.open(CACHE).then(cache => cache.put(request, copy));
  }
  return response;
}

/* Al tocar una notificación se abre o enfoca la app. */
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const open = clients.find(client => 'focus' in client);
      return open ? open.focus() : self.clients.openWindow('./');
    })
  );
});
