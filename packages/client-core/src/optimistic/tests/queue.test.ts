import { expect, test } from 'vitest'

import { createIntentQueue, pendingIntents } from '../queue'
import { projectIntents } from '../projection'

type Patch = { readonly key: string; readonly value: number }

function apply(confirmed: Record<string, number>, patch: Patch) {
  return { ...confirmed, [patch.key]: patch.value }
}

test('a projection replays pending intents in submission order and keeps identity when idle', () => {
  const queue = createIntentQueue<Patch>()
  const confirmed = { a: 0 }
  expect(projectIntents(confirmed, queue.getState().active, apply)).toBe(confirmed)

  queue.submit({ key: 'a', value: 1 }, { resources: ['a'] })
  queue.submit({ key: 'a', value: 2 }, { resources: ['a'] })
  expect(projectIntents(confirmed, queue.getState().active, apply)).toEqual({ a: 2 })
})

test('acknowledgement before the transport settles keeps the intent until the response lands', async () => {
  const queue = createIntentQueue<Patch>()
  const { intent } = queue.submit({ key: 'a', value: 1 })

  queue.acknowledge(intent.intentId)
  expect(queue.getState().active).toHaveLength(1)
  expect(pendingIntents(queue.getState().active)).toHaveLength(0)
  await expect(intent.settled).resolves.toBe('acknowledged')

  queue.settleTransport(intent.intentId)
  expect(queue.getState().active).toHaveLength(0)
})

test('transport settling first leaves the intent pending until acknowledged', () => {
  const queue = createIntentQueue<Patch>()
  const { intent } = queue.submit({ key: 'a', value: 1 })

  queue.settleTransport(intent.intentId)
  expect(pendingIntents(queue.getState().active)).toHaveLength(1)

  queue.acknowledge(intent.intentId)
  expect(queue.getState().active).toHaveLength(0)
})

test('a failure is retained, superseded by a newer intent on the same resource, and cannot be retried once superseded', async () => {
  const queue = createIntentQueue<Patch>()
  const first = queue.submit({ key: 'a', value: 1 }, { resources: ['a'] }).intent
  const second = queue.submit({ key: 'a', value: 2 }, { resources: ['a'] }).intent

  const failed = queue.fail(first.intentId, new Error('refused'))
  expect(failed?.superseded).toBe(true)
  await expect(first.settled).resolves.toBe('failed')
  expect(queue.retry(first.intentId)).toBeNull()

  queue.acknowledge(second.intentId)
  queue.settleTransport(second.intentId)
  expect(queue.getState().active).toHaveLength(0)
  expect(queue.getState().failed).toHaveLength(1)
  expect(queue.discardFailed(first.intentId)).toBe(true)
  expect(queue.getState().failed).toHaveLength(0)
})

test('a retry re-enqueues with a fresh sequence and a later submit supersedes an older failure', () => {
  const queue = createIntentQueue<Patch>()
  const first = queue.submit({ key: 'a', value: 1 }, { resources: ['a'] }).intent
  queue.fail(first.intentId, new Error('offline'))

  const retried = queue.retry(first.intentId)
  expect(retried?.intentId).toBe(first.intentId)
  expect(retried?.sequence).toBeGreaterThan(first.sequence)
  expect(queue.getState().failed).toHaveLength(0)

  queue.fail(first.intentId, new Error('offline again'))
  const { supersededIntentIds } = queue.submit({ key: 'a', value: 3 }, { resources: ['a'] })
  expect(supersededIntentIds).toEqual([first.intentId])
  expect(queue.getState().failed[0]?.superseded).toBe(true)
})

test('failing an acknowledged intent is a no-op', () => {
  const queue = createIntentQueue<Patch>()
  const { intent } = queue.submit({ key: 'a', value: 1 })
  queue.acknowledge(intent.intentId)
  expect(queue.fail(intent.intentId, new Error('late'))).toBeNull()
  expect(queue.getState().failed).toHaveLength(0)
})

test('a custom resource intersection decides supersession', () => {
  const queue = createIntentQueue<Patch>({
    resourcesIntersect: (left, right) => left.startsWith(right) || right.startsWith(left),
  })
  const first = queue.submit({ key: 'a.b', value: 1 }, { resources: ['a.b'] }).intent
  queue.submit({ key: 'a', value: 2 }, { resources: ['a'] })
  expect(queue.fail(first.intentId, new Error('refused'))?.superseded).toBe(true)
})

test('reset discards every active intent', async () => {
  const queue = createIntentQueue<Patch>()
  const { intent } = queue.submit({ key: 'a', value: 1 })
  queue.reset()
  await expect(intent.settled).resolves.toBe('discarded')
  expect(queue.getState()).toMatchObject({ active: [], failed: [] })
})
