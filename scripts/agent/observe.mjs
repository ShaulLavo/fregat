// One definition of "what the page reported": page errors, console, network, sockets.
// Shared by the deploy live check (node) and the agent browser CLI (bun).
export function attachObserver(page, base) {
  const observed = {
    errors: [],
    consoleErrors: [],
    consoleWarnings: [],
    consoleDetails: [],
    failedResponses: [],
    failedRequests: [],
    loopbackRequests: [],
    assets: new Set(),
    apiResponses: [],
    serviceWorkerResponses: [],
    sockets: [],
  }
  page.on('pageerror', (error) => observed.errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') observed.consoleErrors.push(message.text())
    if (message.type() === 'warning') observed.consoleWarnings.push(message.text())
    if (message.type() === 'error' || message.type() === 'warning')
      observed.consoleDetails.push({
        level: message.type(),
        text: message.text(),
        ...message.location(),
      })
  })
  page.on('requestfailed', (request) =>
    observed.failedRequests.push({ url: request.url(), error: request.failure()?.errorText }),
  )
  page.on('request', (request) => {
    if (/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(request.url()))
      observed.loopbackRequests.push(request.url())
  })
  page.on('response', (response) => {
    const type = response.request().resourceType()
    if (response.fromServiceWorker())
      observed.serviceWorkerResponses.push({ url: response.url(), status: response.status(), type })
    if (response.status() >= 400)
      observed.failedResponses.push({ url: response.url(), status: response.status(), type })
    if (response.ok() && ['script', 'stylesheet'].includes(type))
      observed.assets.add(response.url())
    if (response.url().startsWith(base) && ['fetch', 'xhr'].includes(type))
      observed.apiResponses.push({ url: response.url(), status: response.status() })
  })
  page.on('websocket', (socket) => {
    const item = { url: socket.url(), receivedFrames: 0, errors: [] }
    observed.sockets.push(item)
    socket.on('framereceived', () => item.receivedFrames++)
    socket.on('socketerror', (error) => item.errors.push(error))
  })
  return observed
}

export function serializable(observed) {
  return { ...observed, assets: [...observed.assets], loadedAssets: observed.assets.size }
}

// A request the page itself cancelled (a beacon cut off by navigation) is not a failure.
export function observedProblems(observed, { loopback = true } = {}) {
  const found = []
  const list = (label, items) => {
    const unique = [...new Set(items.map((item) => JSON.stringify(item)))].map((item) =>
      JSON.parse(item),
    )
    if (unique.length > 0) found.push(`${label}: ${JSON.stringify(unique.slice(0, 12))}`)
  }
  list('page errors', observed.errors)
  list('console errors', observed.consoleErrors)
  list('console warnings', observed.consoleWarnings)
  if (loopback) list('loopback requests', observed.loopbackRequests)
  list('failed responses', observed.failedResponses)
  list(
    'failed requests',
    observed.failedRequests.filter((item) => item.error !== 'net::ERR_ABORTED'),
  )
  return found
}
