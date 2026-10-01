import { QueryObserver, queryOptions } from '@tanstack/react-query'
import { createEnvironmentClient } from '@workspace/client-core/transport/client'
import { afterEach, beforeEach, vi } from 'vitest'
import { initLogger } from 'evlog'
import { expect, test } from '../../../test/fixtures'
import { queryClientFor } from '@/lib/environments/state/query-clients'
import { observeClientOperation } from '@/lib/client-logging'
import { unwrapEdenResponse } from '@/lib/eden-events'

const events: Record<string, unknown>[] = []
beforeEach(() => {
  events.length = 0
  vi.stubEnv('OBSERVABILITY_ENABLED', 'true')
  vi.stubEnv('VITE_CLIENT_LOG_LEVEL', 'info')
  initLogger({
    enabled: true,
    silent: true,
    minLevel: 'info',
    drain: ({ event }) => {
      events.push(event)
    },
  })
})
afterEach(() => {
  vi.unstubAllEnvs()
  initLogger({ enabled: false })
})

test.for(['beforeunload', 'pagehide', 'prevented', 'restore', 'http503', 'network'] as const)(
  'page-owned query lifecycle: %s',
  async (mode) => {
    const pending: {
      signal: AbortSignal
      resolve: (response: Response) => void
      reject: (reason: unknown) => void
    }[] = []
    const origin = `https://query-lifecycle.invalid/${crypto.randomUUID()}`
    // Control only the network boundary; Eden, query ownership and wide events stay real.
    const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const reply = Promise.withResolvers<Response>()
      const signal = init?.signal
      expect(signal).toBeDefined()
      pending.push({ signal: signal!, resolve: reply.resolve, reject: reply.reject })
      signal!.addEventListener('abort', () => reply.reject(signal!.reason), { once: true })
      return reply.promise
    }) as typeof fetch
    const transport = createEnvironmentClient({ origin, fetcher })
    const queryClient = queryClientFor(origin)
    const retainedKey = ['page-lifecycle-retained', origin]
    queryClient.setQueryData(retainedKey, 'retained')
    const options = queryOptions({
      queryKey: ['page-lifecycle-read', origin],
      retry: false,
      queryFn: ({ signal }) =>
        observeClientOperation({ action: 'test.page_read', area: 'test', signal }, async () => {
          const response = await transport.health.get({ fetch: { signal } })
          return unwrapEdenResponse(response)
        }),
    })
    const observer = new QueryObserver(queryClient, options)
    const unsubscribe = observer.subscribe(() => undefined)
    const preventDeparture = (event: Event) => event.preventDefault()
    if (mode === 'prevented') window.addEventListener('beforeunload', preventDeparture, true)
    try {
      await vi.waitFor(() => expect(pending).toHaveLength(1))
      const first = pending[0]!
      if (mode === 'http503' || mode === 'network') {
        if (mode === 'http503')
          first.resolve(Response.json({ message: 'Fixture service unavailable.' }, { status: 503 }))
        if (mode === 'network')
          first.reject(new DOMException('Fixture network failed.', 'NetworkError'))
        await vi.waitFor(() => expect(observer.getCurrentResult().status).toBe('error'))
        expect(first.signal.aborted).toBe(false)
        expect(events.filter((event) => event.action === 'test.page_read')).toMatchObject([
          { level: 'warn', outcome: 'error', error: { status: 503 } },
        ])
        return
      }

      const departure = new Event(mode === 'pagehide' ? 'pagehide' : 'beforeunload', {
        cancelable: true,
      })
      window.dispatchEvent(departure)
      if (mode === 'prevented') {
        expect(departure.defaultPrevented).toBe(true)
        expect(first.signal.aborted).toBe(false)
        first.resolve(Response.json({ status: 'ok' }))
        await vi.waitFor(() => expect(observer.getCurrentResult().status).toBe('success'))
        expect(events.filter((event) => event.action === 'test.page_read')).toMatchObject([
          { level: 'info', outcome: 'ok' },
        ])
        return
      }

      expect(first.signal.aborted).toBe(true)
      await vi.waitFor(() => expect(observer.getCurrentResult().fetchStatus).toBe('idle'))
      expect(events.filter((event) => event.action === 'test.page_read')).toEqual([])
      expect(queryClient.getQueryData(retainedKey)).toBe('retained')
      window.dispatchEvent(new Event('pageshow'))
      if (mode !== 'restore') return
      await vi.waitFor(() => expect(pending).toHaveLength(2))
      expect(pending[1]!.signal.aborted).toBe(false)
      pending[1]!.resolve(Response.json({ status: 'ok' }))
      await vi.waitFor(() => expect(observer.getCurrentResult().status).toBe('success'))
      expect(queryClient.getQueryData(retainedKey)).toBe('retained')
      expect(events.filter((event) => event.action === 'test.page_read')).toMatchObject([
        { level: 'info', outcome: 'ok' },
      ])
    } finally {
      window.removeEventListener('beforeunload', preventDeparture, true)
      unsubscribe()
      await queryClient.cancelQueries()
      queryClient.clear()
      window.dispatchEvent(new Event('pageshow'))
    }
  },
)
