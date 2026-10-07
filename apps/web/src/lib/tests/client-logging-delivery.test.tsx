import * as v from 'valibot'
import { onTestFinished, vi } from 'vitest'
import { expect, test } from '../../../test/fixtures'
import { initializeClientLogging, log } from '@/lib/client-logging'
import { createWideEventScope } from '@/lib/wide-event-scope'

/** A hidden page whose HTTP drain acknowledges failures; `hide` returns the sent events. */
function hiddenPageRequests() {
  vi.stubEnv('OBSERVABILITY_ENABLED', 'true')
  vi.stubEnv('VITE_CLIENT_LOG_LEVEL', 'info')
  const bodies: { event: Record<string, unknown> }[][] = []
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    bodies.push(
      v.parse(
        v.array(v.object({ event: v.record(v.string(), v.unknown()) })),
        JSON.parse(String(init.body)),
      ),
    )
    return new Response(null, { status: 204 })
  })
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  onTestFinished(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    localStorage.clear()
  })
  initializeClientLogging()

  return async function hide(): Promise<Record<string, unknown>[]> {
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() => expect(bodies.length).toBeGreaterThan(0))
    return bodies
      .splice(0)
      .flat()
      .map((item) => item.event)
  }
}

test('real evlog drains a redacted, identified scope failure as one line on visibility flush', async () => {
  const hide = hiddenPageRequests()
  log.debug(() => ({ action: 'filtered', area: 'test' }))
  const scope = createWideEventScope({ action: 'stream', area: 'test' })
  scope.increment('messages', 3)
  scope.warn('connection stalled', { token: 'private-value' })
  scope.end()

  const records = await hide()
  expect(records).toHaveLength(1)
  expect(records[0]).not.toHaveProperty('checkpoint')
  expect(records[0]).toMatchObject({
    action: 'stream',
    messages: 3,
    level: 'warn',
    token: '[redacted]',
    eventId: expect.any(String),
    scopeId: expect.any(String),
  })
  expect(JSON.stringify(records)).not.toContain('private-value')
})

test('a failed scope still open when the page hides is checkpointed once', async () => {
  const hide = hiddenPageRequests()
  const scope = createWideEventScope({ action: 'connection', area: 'test' })
  scope.error(new TypeError('socket lost'))

  const checkpoints = await hide()
  expect(checkpoints).toHaveLength(1)
  expect(checkpoints[0]).toMatchObject({
    action: 'connection',
    checkpoint: 'failure',
    level: 'error',
    scopeId: expect.any(String),
  })

  scope.end()
  const finals = await hide()
  expect(finals).toHaveLength(1)
  expect(finals[0]).not.toHaveProperty('checkpoint')
  expect(finals[0]).toMatchObject({ level: 'error', scopeId: checkpoints[0]?.scopeId })
  expect(finals[0]?.eventId).not.toBe(checkpoints[0]?.eventId)
})
