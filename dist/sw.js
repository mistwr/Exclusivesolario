var CACHE_NAME = "exclusive-solario-2026-10-crm4";
var APP_FILES = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/manifest.webmanifest",
  "/assets/mark.svg",
  "/assets/petalas-roxo-dourado.webp",
  "/assets/instagram-interior.jpg",
  "/assets/instagram-entrada.jpg",
  "/assets/instagram-produtos.jpg",
  "/assets/instagram-detalhes.jpg",
  "/gestao/",
  "/gestao/index.html",
  "/gestao/crm.css",
  "/gestao/crm.js",
  "/supabase-config.js",
  "/gestao/supabase-auth.js",
  "/privacidade/"
];

self.addEventListener("install", function (event) {
  event.waitUntil(caches.open(CACHE_NAME).then(function (cache) {
    return cache.addAll(APP_FILES);
  }).then(function () {
    return self.skipWaiting();
  }));
});

self.addEventListener("activate", function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (key) {
      return key !== CACHE_NAME;
    }).map(function (key) {
      return caches.delete(key);
    }));
  }).then(function () {
    return self.clients.claim();
  }));
});

self.addEventListener("fetch", function (event) {
  var request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  var requestPath = new URL(request.url).pathname;
  if (requestPath.indexOf("/api/") === 0 || requestPath.indexOf("/.netlify/") === 0) return;
  event.respondWith(caches.match(request).then(function (cached) {
    if (cached) return cached;
    return fetch(request).then(function (response) {
      if (response.ok) {
        var copy = response.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(request, copy); });
      }
      return response;
    }).catch(function () {
      if (request.mode === "navigate") return caches.match("/index.html");
      throw new Error("Conteúdo indisponível sem ligação.");
    });
  }));
});
