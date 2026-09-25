// Only the isolated scenario server loads this boundary; production validates real push hosts.
const originalFetch = globalThis.fetch
const scenarioFetch: typeof fetch = Object.assign(
  (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input)
    const match = /^\/platform-agent\/(\d+)(\/push\/.*)$/.exec(url.pathname)
    if (url.hostname !== 'fcm.googleapis.com' || !match) return originalFetch(input, init)
    return originalFetch(`http://127.0.0.1:${match[1]}${match[2]}`, init)
  },
  { preconnect: originalFetch.preconnect },
)
globalThis.fetch = scenarioFetch
