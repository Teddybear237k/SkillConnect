const CACHE = 'skillconnect-v3';
const STATIC = [
  '/manifest.json',
  '/icon-192.svg',
  '/icon-512.svg',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  // Supprime tous les anciens caches (v1, etc.)
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

// ─── Push Notifications ───────────────────────────────────────────────────────
self.addEventListener('push', e => {
  if (!e.data) return;
  let payload = { title: 'SkillConnect', body: '', icon: '/icon-192.svg', url: '/' };
  try { Object.assign(payload, e.data.json()); } catch(_) { payload.body = e.data.text(); }
  e.waitUntil(self.registration.showNotification(payload.title, {
    body:  payload.body,
    icon:  payload.icon || '/icon-192.svg',
    badge: '/icon-192.svg',
    data:  { url: payload.url || '/' },
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(clients.matchAll({ type: 'window' }).then(wins => {
    for (const w of wins) { if (w.url.startsWith(self.location.origin) && 'focus' in w) return w.focus(); }
    return clients.openWindow(url);
  }));
});

self.addEventListener('fetch', e => {
  // Ne pas intercepter les appels API ni socket
  if (e.request.url.includes('/api/') || e.request.url.includes('/socket.io/')) return;

  const url = new URL(e.request.url);
  const isHTML = url.pathname === '/' || url.pathname.endsWith('.html');

  if (isHTML) {
    // Network First pour le HTML : toujours chercher la version fraîche du serveur
    e.respondWith(
      fetch(e.request).catch(() => caches.match('/'))
    );
    return;
  }

  // Cache First pour les assets statiques (images, fonts, icônes)
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (!res || res.status !== 200 || res.type !== 'basic') return res;
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      }).catch(() => caches.match('/'));
    })
  );
});
