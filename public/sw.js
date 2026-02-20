const CACHE_NAME = "entech-v1"
const PRECACHE = ["/orders", "/icon-192.png", "/icon-512.png"]

// Install — cache shell
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE))
  )
  self.skipWaiting()
})

// Activate — clean old caches
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

// Fetch — network first, cache fallback
self.addEventListener("fetch", (e) => {
  // Skip non-GET and API calls
  if (e.request.method !== "GET") return
  if (e.request.url.includes("/api/")) return

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        // Cache successful responses
        if (res.ok) {
          const clone = res.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone))
        }
        return res
      })
      .catch(() => caches.match(e.request))
  )
})

// Push notifications
self.addEventListener("push", (e) => {
  let data = { title: "Entech Dashboard", body: "New notification", icon: "/icon-192.png" }
  try {
    if (e.data) data = { ...data, ...e.data.json() }
  } catch {
    if (e.data) data.body = e.data.text()
  }

  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon || "/icon-192.png",
      badge: "/icon-192.png",
      data: data.url || "/orders",
      vibrate: [200, 100, 200],
    })
  )
})

// Notification click — open the app
self.addEventListener("notificationclick", (e) => {
  e.notification.close()
  const url = e.notification.data || "/orders"
  e.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(url) && "focus" in client) return client.focus()
      }
      return self.clients.openWindow(url)
    })
  )
})
