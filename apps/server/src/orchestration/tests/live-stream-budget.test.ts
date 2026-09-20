import { expect, test } from 'vitest'
import { LiveStreamBudget } from '../live-stream-budget'

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
