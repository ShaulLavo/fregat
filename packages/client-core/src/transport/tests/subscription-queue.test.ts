import { expect, test } from 'vitest'
import { AsyncSubscriptionQueue } from '../subscription-queue'

test('bounds queued plus delivered items and releases everything on overflow', async () => {
  const queue = new AsyncSubscriptionQueue<string>({ maxItems: 2 })
  queue.push('first')
  expect((await queue.next()).value).toBe('first')
  queue.push('second')
  queue.push('third')
  expect(queue.usage).toEqual({ items: 0, bytes: 0 })
  await expect(queue.next()).rejects.toMatchObject({ code: 'orchestration.LIVE_STREAM_OVERFLOW' })
})

test('counts UTF-8 and clears references on close', async () => {
  const queue = new AsyncSubscriptionQueue<string>({ maxBytes: 5 })
  queue.push('😀')
  await expect(queue.next()).rejects.toMatchObject({ code: 'orchestration.LIVE_STREAM_OVERFLOW' })
  const closed = new AsyncSubscriptionQueue<string>()
  closed.push('queued')
  closed.close()
  expect(closed.usage).toEqual({ items: 0, bytes: 0 })
  expect(await closed.next()).toEqual({ done: true, value: undefined })
})

test('initial snapshots have a separate one-frame allowance', async () => {
  const queue = new AsyncSubscriptionQueue<{ kind: string; text: string }>({
    maxBytes: 1,
    isSnapshot: (item) => item.kind === 'snapshot',
  })
  queue.push({ kind: 'snapshot', text: 'large' })
  expect((await queue.next()).value).toEqual({ kind: 'snapshot', text: 'large' })
  queue.push({ kind: 'snapshot', text: 'second' })
  await expect(queue.next()).rejects.toMatchObject({ code: 'orchestration.LIVE_STREAM_OVERFLOW' })
})
