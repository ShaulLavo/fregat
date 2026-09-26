import { expect, test } from 'vitest'
import { isLiveStreamAckTimeout, LiveStreamBudget } from '../live-stream-budget'

test('replacement transfers accounting atomically and release is idempotent', () => {
  const budget = new LiveStreamBudget({ maxItems: 2, maxBytes: 100 })
  const first = budget.retain({ text: 'one' })
  const second = budget.retain({ text: 'two' })
  const combined = budget.replace([first, second], [{ text: 'onetwo' }])
  expect(budget.usage).toEqual({
    items: 1,
    bytes: Buffer.byteLength(JSON.stringify(combined[0]!.value)),
  })
  budget.release([first, second])
  expect(budget.usage.items).toBe(1)
  budget.release(combined)
  budget.release(combined)
  expect(budget.usage).toEqual({ items: 0, bytes: 0 })
})

test('UTF-8 bytes count against the budget and overflow releases retention', () => {
  const value = { text: '😀' }
  const budget = new LiveStreamBudget({ maxItems: 2, maxBytes: JSON.stringify(value).length })
  expect(() => budget.retain(value)).toThrow('subscription buffer')
  expect(budget.signal.aborted).toBe(true)
  expect(budget.signal.reason).toMatchObject({ code: 'orchestration.LIVE_STREAM_OVERFLOW' })
  expect(budget.usage).toEqual({ items: 0, bytes: 0 })
})

test('an ACK timeout aborts with its own code and records usage below the caps', () => {
  const budget = new LiveStreamBudget({ maxItems: 2, maxBytes: 100 })
  budget.retain({ text: 'one' })
  const error = budget.ackTimeout({ deliveryId: 4, timeoutMs: 30_000 })
  expect(budget.signal.reason).toBe(error)
  expect(error).toMatchObject({ code: 'orchestration.LIVE_STREAM_ACK_TIMEOUT', status: 408 })
  expect(error.internal).toEqual({ items: 1, bytes: 14, deliveryId: 4, timeoutMs: 30_000 })
  expect(isLiveStreamAckTimeout(error)).toBe(true)
  expect(budget.usage).toEqual({ items: 0, bytes: 0 })

  const overflowing = new LiveStreamBudget({ maxItems: 0, maxBytes: 100 })
  expect(() => overflowing.retain({ text: 'one' })).toThrow('subscription buffer')
  expect(isLiveStreamAckTimeout(overflowing.signal.reason)).toBe(false)
})
