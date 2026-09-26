import { initLogger } from 'evlog'
import { afterEach, beforeEach, onTestFinished, vi } from 'vitest'

import { expect, test } from '../../../test/fixtures'
import { createCuttableEventsClient } from '../../../test/client'
import { installTestClient } from '../../../test/factories/client-binding'
import type { TestServer } from '../../../test/server'
import { startMachineEvents } from '@/state/machine-events'

const emitted: Record<string, unknown>[] = []

beforeEach(() => {
  emitted.length = 0
  vi.stubEnv('OBSERVABILITY_ENABLED', 'true')
  initLogger({ enabled: true, silent: true, drain: ({ event }) => void emitted.push(event) })
})
afterEach(() => {
  vi.unstubAllEnvs()
  initLogger({ enabled: false })
})

/** Answers the first `failures` machine-event requests with `status`; a restart's gateway sends 502. */
function streamThroughRestart(server: TestServer, failures: number, status = 502) {
  let answered = 0
  const { client } = createCuttableEventsClient(server, (request) => {
    if (new URL(request.url).pathname !== '/machines/events') return undefined
    answered += 1
    if (answered > failures) return undefined
    return new Response('refused', { status })
  })
  onTestFinished(installTestClient(client))
  const received = vi.fn()
  onTestFinished(startMachineEvents(received))
  return received
}

function machineEventLines() {
  return emitted.filter((event) => String(event.action).startsWith('machine.events'))
}

test('a restart the stream reconnects through warns once and logs the count', async ({
  server,
}) => {
  const received = streamThroughRestart(server, 2)
  await vi.waitFor(() => expect(received).toHaveBeenCalled(), { timeout: 5_000 })

  const lines = machineEventLines()
  expect(lines.filter((line) => line.level === 'error')).toEqual([])
  expect(lines.filter((line) => line.level === 'warn')).toHaveLength(1)
  expect(lines).toContainEqual(
    expect.objectContaining({ action: 'machine.events.reconnected', failures: 2, level: 'info' }),
  )
})

test('a series that outlasts the reconnect ladder is an error, logged once', async ({ server }) => {
  vi.useFakeTimers()
  onTestFinished(() => void vi.useRealTimers())
  const received = streamThroughRestart(server, Number.POSITIVE_INFINITY)
  await vi.advanceTimersByTimeAsync(120_000)

  expect(received).not.toHaveBeenCalled()
  const lines = machineEventLines()
  expect(lines.filter((line) => line.level === 'warn')).toHaveLength(1)
  expect(lines.filter((line) => line.level === 'error')).toEqual([
    expect.objectContaining({ action: 'machine.events', failures: 7 }),
  ])
})

test('a failure no retry fixes is an error on the first attempt', async ({ server }) => {
  streamThroughRestart(server, 1, 403)
  await vi.waitFor(() =>
    expect(machineEventLines()).toContainEqual(
      expect.objectContaining({ action: 'machine.events', failures: 1, level: 'error' }),
    ),
  )
})
