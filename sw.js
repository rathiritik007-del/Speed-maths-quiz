const CACHE_NAME = "mental-math-trainer-shell-v1.3.1";

const STATIC_SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/css/style.css",
  "/css/themes.css",
  "/js/storage.js",
  "/js/version.js",
  "/js/questions.js",
  "/js/config.js",
  "/js/supabaseClient.js",
  "/js/auth.js",
  "/js/sync.js",
  "/js/ui.js",
  "/js/app.js",
  "/assets/level-badges/beginner.svg",
  "/assets/level-badges/apprentice.svg",
  "/assets/level-badges/student.svg",
  "/assets/level-badges/practitioner.svg",
  "/assets/level-badges/skilled.svg",
  "/assets/level-badges/advanced.svg",
  "/assets/level-badges/expert.svg",
  "/assets/level-badges/master.svg",
  "/assets/level-badges/grandmaster.svg",
  "/assets/level-badges/legend.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png"
];

function isSupabaseRequest(url) {
  return url.hostname.includes("supabase.co") || url.pathname.includes("/auth/v1/");
}

function isStaticShellRequest(url) {
  return url.origin === self.location.origin && STATIC_SHELL.includes(url.pathname);
}

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(key => key === CACHE_NAME ? null : caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (isSupabaseRequest(url)) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put("/", copy));
          return response;
        })
        .catch(() => caches.match("/") || caches.match("/index.html"))
    );
    return;
  }

  if (!isStaticShellRequest(url)) return;

  event.respondWith(
    fetch(request)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request))
  );
});
