const CACHE_NAME = 'dualchat-v77';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './js/config.js',
  './js/analytics.js',
  './js/crypto.js',
  './js/grocery.js',
  './js/ui.js',
  './js/notifications.js',
  './js/reactions.js',
  './js/calls.js',
  './js/database.js',
  './js/chat.js',
  './js/app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method === 'GET' && e.request.url.startsWith(self.location.origin)) {
    // Network-first strategy for app code so updates load immediately
    e.respondWith(
      fetch(e.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
          return response;
        })
        .catch(() => caches.match(e.request))
    );
  }
});

// Push notification event listener (iOS & Android)
// Always displays disguised, generic text - never exposes private message or sender
self.addEventListener('push', (e) => {
  let title = 'Quick Note';
  let body = 'Quick list has an update for you';

  if (e.data) {
    try {
      const data = e.data.json();
      if (data && data.title) title = data.title;
      if (data && data.body) body = data.body;
    } catch (err) {
      const text = e.data.text();
      if (text) body = text;
    }
  }

  const options = {
    body: body,
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    tag: 'quick-note-update',
    renotify: true,
    vibrate: [150, 80, 150],
    data: {
      url: './index.html'
    }
  };

  e.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Click on notification opens/focuses the app
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const rawUrl = (e.notification.data && e.notification.data.url) || self.location.origin;
  const targetUrl = (rawUrl.includes('localhost') || rawUrl.includes('127.0.0.1'))
    ? 'https://quicknote.futurelab.co.in/'
    : (new URL(rawUrl, self.location.origin).href);

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ((client.url === targetUrl || client.url.startsWith(self.location.origin)) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
