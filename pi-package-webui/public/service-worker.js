const CACHE_NAME = "pi-webui-pwa-v48";
const APP_SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/issue-wizard-state.mjs",
  "/issue-bot-client.mjs",
  "/aur-review-payload.mjs",
  "/guided-git-command-state.mjs",
  "/guided-git-review-state.mjs",
  "/fast-output-live.mjs",
  "/subagent-launch-slot-state.mjs",
  "/subagent-gate-visibility.mjs",
  "/workflow-status-stack.mjs",
  "/voice-conversation.mjs",
  "/favicon.svg",
  "/apple-touch-icon.png",
  "/icon-192.png",
  "/icon-512.png",
  "/catppuccin-mocha-background.png",
  "/matrix-background.webp",
  "/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || `${self.location.origin}/`;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const webuiClient = clients.find((client) => client.url.startsWith(self.location.origin));
      if (webuiClient) return webuiClient.focus();
      return self.clients.openWindow?.(targetUrl);
    }),
  );
});

// Network-first keeps the app shell fresh after deploys regardless of
// CACHE_NAME or ?v= cache-buster drift; the cache only serves offline clients.
function fetchThenCache(request) {
  return fetch(request).then((response) => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
    }
    return response;
  });
}

// ignoreSearch lets precached bare paths satisfy ?v= cache-busted requests offline.
function cachedAppShell(request, fallbackPath) {
  return caches.match(request, { ignoreSearch: true }).then((cached) => {
    if (cached || !fallbackPath) return cached;
    return caches.match(fallbackPath, { ignoreSearch: true });
  });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(fetchThenCache(request).catch(() => cachedAppShell(request, "/index.html")));
    return;
  }

  if (!APP_SHELL.includes(url.pathname)) return;
  event.respondWith(fetchThenCache(request).catch(() => cachedAppShell(request)));
});
