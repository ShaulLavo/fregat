/**
 * The developer's slow-link dial. Settings pushes the value in; the HTTP
 * fetcher and the orchestration socket read it before every request. It lives
 * here rather than in the settings feature because `lib/` cannot read a
 * setting and both transports live below `features/`.
 */
let latencyMs = 0

export function setSimulatedLatencyMs(ms: number) {
  latencyMs = Math.max(0, ms)
}

/** `undefined` when the dial is off, so a caller can stay synchronous. */
export function simulateLatency(signal?: AbortSignal | null): Promise<void> | undefined {
  if (latencyMs === 0) return undefined
  if (signal?.aborted) return Promise.reject(signal.reason)

  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, latencyMs)
    function onAbort() {
      globalThis.clearTimeout(timer)
      reject(signal?.reason)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** `fetch` with the dial applied. Only the request start is delayed, so a stream still flows. */
export const latencyFetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
  await simulateLatency(init?.signal)
  return fetch(input, init)
  // Bun's `typeof fetch` also declares `preconnect`, which the browser does not have.
}) as typeof fetch
