import { expect, test, vi } from 'vitest'

import { createIntentQueue } from '../queue'
import { runIntent, waitUntil, type AcknowledgementSource, type IntentRunEvent } from '../run'

type Patch = { readonly value: number }

function source(
  initial = false,
): AcknowledgementSource & { readonly notify: (satisfied: boolean) => void } {
  let satisfied = initial
  const listeners = new Set<() => void>()
  return {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    satisfied: () => satisfied,
    timeoutMs: 50,
    notify: (next) => {
      satisfied = next
      for (const listener of listeners) listener()
    },
  }
}

test('a run acknowledges once the transport settles and the source is satisfied', async () => {
  const queue = createIntentQueue<Patch>()
  const events: IntentRunEvent[] = []
  const acknowledgement = source()

  const run = runIntent(
    queue,
    { value: 1 },
    {
      resources: ['row'],
      perform: async () => 'done',
      until: acknowledgement,
      record: (event) => events.push(event),
    },
  )
  await Promise.resolve()
  expect(queue.getState().active).toHaveLength(1)

  acknowledgement.notify(true)
  const outcome = await run
  expect(outcome).toMatchObject({ ok: true, result: 'done' })
  expect(queue.getState().active).toHaveLength(0)
  expect(events).toEqual([
    expect.objectContaining({ outcome: 'acknowledged', attempts: 1, resources: ['row'] }),
  ])
})

test('a transport failure moves the intent to failed and never rejects', async () => {
  const queue = createIntentQueue<Patch>()
  const outcome = await runIntent(
    queue,
    { value: 1 },
    {
      perform: async () => {
        throw new Error('refused')
      },
    },
  )
  expect(outcome).toMatchObject({ ok: false, reason: 'transport' })
  expect(queue.getState().active).toHaveLength(0)
  expect(queue.getState().failed).toHaveLength(1)
})

test('an acknowledgement that never arrives withdraws the intent with a structured timeout', async () => {
  const queue = createIntentQueue<Patch>()
  const outcome = await runIntent(
    queue,
    { value: 1 },
    {
      perform: async () => undefined,
      until: source(false),
    },
  )
  expect(outcome).toMatchObject({ ok: false, reason: 'timed-out' })
  const failed = queue.getState().failed[0]
  expect(failed?.error).toMatchObject({ code: 'client.OPTIMISTIC_ACK_TIMEOUT' })
})

test('a source already satisfied acknowledges without waiting', async () => {
  const queue = createIntentQueue<Patch>()
  const outcome = await runIntent(
    queue,
    { value: 1 },
    {
      perform: async () => undefined,
      until: source(true),
    },
  )
  expect(outcome.ok).toBe(true)
})

test('the retry policy reruns the transport and reports the attempt count', async () => {
  const queue = createIntentQueue<Patch>()
  const perform = vi
    .fn<() => Promise<string>>()
    .mockRejectedValueOnce(new Error('flaky'))
    .mockResolvedValueOnce('ok')
  const events: IntentRunEvent[] = []

  const outcome = await runIntent(
    queue,
    { value: 1 },
    {
      perform,
      retry: { shouldRetry: (count) => count < 1, delayMs: () => 0 },
      record: (event) => events.push(event),
    },
  )
  expect(outcome).toMatchObject({ ok: true, result: 'ok' })
  expect(perform).toHaveBeenCalledTimes(2)
  expect(events[0]?.attempts).toBe(2)
})

test('aborting discards the intent instead of failing it', async () => {
  const queue = createIntentQueue<Patch>()
  const controller = new AbortController()
  const outcome = runIntent(
    queue,
    { value: 1 },
    {
      perform: (_intent, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        }),
      signal: controller.signal,
    },
  )
  controller.abort(new Error('gone'))
  expect(await outcome).toMatchObject({ ok: false, reason: 'aborted' })
  expect(queue.getState()).toMatchObject({ active: [], failed: [] })
})

test('a stream acknowledgement that beats a failing response still closes the intent', async () => {
  const queue = createIntentQueue<Patch>()
  let intentId = ''
  const outcome = await runIntent(
    queue,
    { value: 1 },
    {
      perform: async (intent) => {
        intentId = intent.intentId
        queue.acknowledge(intent.intentId)
        throw new Error('response lost')
      },
    },
  )
  expect(outcome).toMatchObject({ ok: false, reason: 'transport', intentId })
  expect(queue.getState()).toMatchObject({ active: [], failed: [] })
})

test('waitUntil resolves on the notification that satisfies it', async () => {
  const acknowledgement = source()
  const waiting = waitUntil(acknowledgement)
  acknowledgement.notify(false)
  acknowledgement.notify(true)
  expect(await waiting).toBe('satisfied')
})
