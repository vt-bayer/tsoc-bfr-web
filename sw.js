/* Service worker mínimo — necessário para o Chrome oferecer "Instalar app" */
const CACHE = 'tsoc-bfr-shell-v50';
const SHELL = ['./', './index.html', './instalar.html', './manifest.webmanifest', './assets/bayer-logo.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
