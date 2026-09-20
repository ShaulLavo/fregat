import { vi } from 'vitest'
import { expect, test } from '../../../test/fixtures'
import { initializeClientLogging, log } from '@/lib/client-logging'
import { createWideEventScope } from '@/lib/wide-event-scope'

test('real evlog drains redacted, identified scope failures on visibility flush', async () => {
  vi.stubEnv('OBSERVABILITY_ENABLED', 'true')
  vi.stubEnv('VITE_CLIENT_LOG_LEVEL', 'info')
  const bodies: Blob[] = []
  const sendBeacon = vi.fn((_url: string, body: Blob) => {
    bodies.push(body)
    return true
  })
  vi.stubGlobal('navigator', { sendBeacon })
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  try {
    initializeClientLogging()
    log.debug(() => ({ action: 'filtered', area: 'test' }))
    const scope = createWideEventScope({ action: 'stream', area: 'test' })
    scope.increment('messages', 3)
    scope.warn('connection stalled', { token: 'private-value' })
    scope.end()
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() => expect(bodies.length).toBeGreaterThan(0))
    const batches = await Promise.all(bodies.map(async (body) => JSON.parse(await body.text())))
    const records = batches.flat().map((item) => item.event)
    expect(records).toHaveLength(2)
    expect(records[0]).toMatchObject({
      action: 'stream',
      messages: 3,
      level: 'warn',
      token: '[redacted]',
      checkpoint: 'failure',
      eventId: expect.any(String),
      scopeId: expect.any(String),
    })
    expect(records[1]).toMatchObject({ scopeId: records[0].scopeId, eventId: expect.any(String) })
    expect(records[0].eventId).not.toBe(records[1].eventId)
    expect(JSON.stringify(records)).not.toContain('private-value')
  } finally {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  }
})
