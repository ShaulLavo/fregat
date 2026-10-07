import { afterEach, onTestFinished, vi } from 'vitest'
import { DEFAULT_SETTING_VALUES } from '@workspace/contracts'
import type { DrainContext } from 'evlog'
import { expect, test } from '../../../test/fixtures'
import { directInProcessFetcher } from '../../../test/client'
import { createClientLogDelivery } from '@/lib/client-logging/delivery'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  localStorage.clear()
})

test('failed HTTP delivery survives a reload and replays into the real ingest route', async ({
  server,
}) => {
  let offline = true
  const directFetch = directInProcessFetcher(server)
  const accepted: { instance: string | null; body: DrainContext[]; status: number }[] = []
  const fetcher = async (...[input, init]: Parameters<typeof fetch>) => {
    if (offline) throw new TypeError('simulated disconnect')
    const request = new Request(input, init)
    request.headers.set('origin', server.origin)
    const body = await request.clone().json()
    const response = await directFetch(request)
    accepted.push({
      instance: new URL(request.url).searchParams.get('instance'),
      body,
      status: response.status,
    })
    return response
  }
  vi.stubGlobal('fetch', fetcher)
  const options = {
    endpoint: `${server.origin}/_log/ingest?instance=first-tab`,
    storage: localStorage,
    retention: () => DEFAULT_SETTING_VALUES['logs.clientFailureRetention'],
  }
  const first = createClientLogDelivery({ ...options, instanceId: 'first-tab' })
  first(failure())
  await first.flush()
  first.dispose()
  expect(localStorage.length).toBe(2)
  expect(accepted).toEqual([])
  offline = false
  const reloaded = createClientLogDelivery({ ...options, instanceId: 'reloaded-tab' })
  onTestFinished(() => reloaded.dispose())
  await reloaded.flush()
  expect(accepted.map((request) => request.status)).toEqual([204])
  const recoveredEvents = accepted.flatMap((request) =>
    request.body.map((item) => ({ instance: request.instance, event: item.event })),
  )
  expect(recoveredEvents).toContainEqual(
    expect.objectContaining({
      instance: 'first-tab',
      event: expect.objectContaining({ eventId: 'recovered-failure', token: '[redacted]' }),
    }),
  )
  expect(
    accepted.some((request) =>
      request.body.some((item) => item.event.action === 'client.logs.delivery'),
    ),
  ).toBe(true)
  expect(localStorage.length).toBe(0)
})

test('a hidden page retains its failure until HTTP acknowledgement and never trusts a beacon', async () => {
  const acknowledgement = Promise.withResolvers<Response>()
  const beacon = vi.fn(() => true)
  vi.stubGlobal('navigator', { sendBeacon: beacon })
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  vi.stubGlobal('fetch', () => acknowledgement.promise)
  const drain = createClientLogDelivery({
    endpoint: 'http://localhost:3001/_log/ingest',
    instanceId: 'hidden-tab',
    storage: localStorage,
    retention: () => DEFAULT_SETTING_VALUES['logs.clientFailureRetention'],
  })
  onTestFinished(() => drain.dispose())
  drain(failure())
  document.dispatchEvent(new Event('visibilitychange'))
  expect(localStorage.length).toBe(1)
  expect(beacon).not.toHaveBeenCalled()
  acknowledgement.resolve(new Response(null, { status: 204 }))
  await drain.flush()
  expect(localStorage.length).toBe(0)
})

test('online recovery replays a retained failure without a reload', async () => {
  let offline = true
  const fetcher = vi.fn(async () => {
    if (offline) throw new TypeError('simulated disconnect')
    return new Response(null, { status: 204 })
  })
  vi.stubGlobal('fetch', fetcher)
  const drain = createClientLogDelivery({
    endpoint: 'http://localhost:3001/_log/ingest',
    instanceId: 'online-tab',
    storage: localStorage,
    retention: () => DEFAULT_SETTING_VALUES['logs.clientFailureRetention'],
  })
  onTestFinished(() => drain.dispose())
  drain(failure())
  await drain.flush()
  offline = false
  window.dispatchEvent(new Event('online'))
  await drain.flush()
  expect(localStorage.length).toBe(0)
  expect(fetcher).toHaveBeenCalledTimes(3)
})

test('a successful ordinary upload recovers failures after the server returns', async () => {
  let unavailable = true
  vi.stubGlobal('fetch', async () => new Response(null, { status: unavailable ? 503 : 204 }))
  const drain = createClientLogDelivery({
    endpoint: 'http://localhost:3001/_log/ingest',
    instanceId: 'recovering-tab',
    storage: localStorage,
    retention: () => DEFAULT_SETTING_VALUES['logs.clientFailureRetention'],
  })
  onTestFinished(() => drain.dispose())
  drain(failure())
  await drain.flush()
  expect(Object.values(localStorage).join('')).toContain('"status":503')
  unavailable = false
  drain({ event: { ...failure().event, level: 'info', eventId: 'successful-read' } })
  await drain.flush()
  await vi.waitFor(() => expect(localStorage.length).toBe(0), { timeout: 5_000 })
})

function failure(): DrainContext {
  return {
    event: {
      timestamp: new Date().toISOString(),
      level: 'error',
      service: 'platform-web',
      environment: 'test',
      eventId: 'recovered-failure',
      action: 'chat.project.retry',
      area: 'chat',
      token: 'private-token',
      error: { code: 'ORCHESTRATION_RPC_CLOSED' },
    },
  }
}
