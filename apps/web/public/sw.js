// Push delivery only: no fetch handler and no caches, so a deploy never serves stale files through it.
// Registered from Settings at the app base (`import.meta.env.BASE_URL`), never in the demo.

const FALLBACK_TITLE = 'fregat'

// Nothing is cached, so a new version may replace the old one at once.
self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('push', (event) => {
  event.waitUntil(showNotice(readNotice(event.data)))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(openNotice(event.notification.data?.path ?? ''))
})

function readNotice(data) {
  const notice = { title: FALLBACK_TITLE, body: '', tag: undefined, path: '' }
  if (!data) return notice

  try {
    return { ...notice, ...data.json() }
  } catch {
    return { ...notice, body: data.text() }
  }
}

function showNotice(notice) {
  return self.registration.showNotification(notice.title, {
    body: notice.body,
    tag: notice.tag,
    icon: new URL('icons/icon-192.png', self.registration.scope).href,
    data: { path: notice.path },
  })
}

// A session notice focuses the window already showing that session, or opens it. A notice
// without a session (the test) focuses any app window.
async function openNotice(path) {
  const scope = self.registration.scope
  const target = new URL(path, scope)
  const session = sessionRoute(target.pathname)
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const app = windows.filter((client) => client.url.startsWith(scope))
  const showing = session
    ? app.find((client) => sessionRoute(new URL(client.url).pathname) === session)
    : app[0]
  if (showing) return showing.focus()

  return self.clients.openWindow(target.href)
}

// `chat/t/<id>` names the session whatever workspace token precedes it.
function sessionRoute(pathname) {
  return /\/chat\/t\/[^/]+$/.exec(pathname)?.[0] ?? null
}
