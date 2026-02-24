// Service Worker for Push Notifications
self.addEventListener('push', function(event) {
  const data = event.data ? event.data.json() : {}
  const title = data.title || 'Entech Dashboard'
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'entech-notification',
    data: { url: data.url || '/' },
    vibrate: [200, 100, 200],
  }

  event.waitUntil(
    self.registration.showNotification(title, options).then(function() {
      // Update badge count on iOS/Android
      if (self.navigator && self.navigator.setAppBadge) {
        // Increment badge (we don't track count server-side, just set 1)
        self.navigator.setAppBadge(1)
      }
    })
  )
})

self.addEventListener('notificationclick', function(event) {
  event.notification.close()

  // Clear badge when user taps notification
  if (self.navigator && self.navigator.setAppBadge) {
    self.navigator.clearAppBadge()
  }

  const url = event.notification.data?.url || '/'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url)
          return client.focus()
        }
      }
      return clients.openWindow(url)
    })
  )
})
