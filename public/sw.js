// ══════════════════════════════════════════════════════════════
// Noor Prayer Times – Service Worker
// Database-driven notification scheduling + smart caching
// ══════════════════════════════════════════════════════════════

// IMPORTANT: bump CACHE_NAME on every meaningful release.
// On `activate` we delete EVERY cache that does not match this name,
// which is how we force returning users off stale HTML / JS / API data
// after a Vercel deploy.
const CACHE_NAME = 'noor-prayer-v6';
const STATIC_ASSETS = [
  '/home',
  '/static/styles.css',
  '/static/app.js',
  '/favicon.svg',
  '/manifest.json',
  '/audio/notification.wav',
  '/audio/adhan.mp3'
];

const notificationTimers = new Map();
const firedNotifications = new Set();
const NOTIFICATION_GRACE_MS = 2 * 60 * 1000;

function clearNotificationTimers() {
  notificationTimers.forEach((timer) => clearTimeout(timer));
  notificationTimers.clear();
}

function scheduleNotificationEvents(events) {
  // Clear ALL existing timers before rescheduling so a CSV upload that
  // changes times can never produce duplicate alerts.
  clearNotificationTimers();
  const now = Date.now();

  events.forEach((event) => {
    if (!event || !event.id || firedNotifications.has(event.id)) return;
    if (event.when < now - NOTIFICATION_GRACE_MS) return;

    const delay = Math.max(0, event.when - now);
    const timer = setTimeout(() => {
      if (firedNotifications.has(event.id)) return;
      firedNotifications.add(event.id);
      self.registration.showNotification(event.title || 'Noor Prayer Times', {
        body: event.body || '',
        icon: '/icons/icon-192.png',
        badge: '/favicon.svg',
        tag: event.tag || event.id,
        renotify: false,
        timestamp: Date.now(),
        data: { url: '/home', tag: event.tag || event.id }
      }).catch(() => {});
      notificationTimers.delete(event.id);
    }, delay);

    notificationTimers.set(event.id, timer);
  });
}

// Install – cache core assets, bump cache version.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch(() => {
        // Fail silently for individual assets so the SW still installs.
      });
    })
  );
  self.skipWaiting();
});

// Activate – clean ALL old caches to prevent stale data.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Message handler for notification scheduling and cache invalidation.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'NOOR_SCHEDULE_NOTIFICATIONS') {
    // Reschedule ALL notifications from fresh DB data.
    scheduleNotificationEvents(Array.isArray(event.data.events) ? event.data.events : []);
  }

  if (event.data && event.data.type === 'NOOR_CLEAR_NOTIFICATIONS') {
    // Admin deleted data – clear all pending notifications.
    clearNotificationTimers();
    firedNotifications.clear();
  }

  if (event.data && event.data.type === 'NOOR_CACHE_BUST') {
    // Force-refresh cached API responses.
    caches.open(CACHE_NAME).then((cache) => {
      cache.keys().then((keys) => {
        keys.forEach((request) => {
          if (new URL(request.url).pathname.startsWith('/api/')) {
            cache.delete(request);
          }
        });
      });
    });
  }
});

// Fetch strategy:
// - API calls: ALWAYS network-first with cache: 'no-store' so a CSV upload
//   is reflected for every client on the very next poll.
// - HTML navigations: network-first, fall back to cache only when offline,
//   so any UI change deployed on Vercel is picked up immediately and never
//   served from a stale SW cache.
// - Other static assets: stale-while-revalidate.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' }).catch(() => {
        return new Response(JSON.stringify({ success: false, error: { message: 'Offline' } }), {
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  const acceptsHtml = (event.request.headers.get('accept') || '').includes('text/html');
  if (event.request.mode === 'navigate' || acceptsHtml) {
    event.respondWith(
      fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match(event.request))
    );
    return;
  }

  // Static assets: stale-while-revalidate.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);

      return cached || fetchPromise;
    })
  );
});

// Notification click handler.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existingClient = clients.find((client) => 'focus' in client);
      if (existingClient) {
        return existingClient.focus();
      }
      return self.clients.openWindow((event.notification.data && event.notification.data.url) || '/home');
    })
  );
});

// Push notification handler (for future push support).
self.addEventListener('push', (event) => {
  if (!event.data) return;
  try {
    const data = event.data.json();
    event.waitUntil(
      self.registration.showNotification(data.title || 'Noor Prayer Times', {
        body: data.body || '',
        icon: '/icons/icon-192.png',
        badge: '/favicon.svg',
        tag: data.tag || 'noor-push',
        data: data
      })
    );
  } catch {
    // Ignore invalid push data
  }
});
