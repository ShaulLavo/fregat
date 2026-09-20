import { expect, test, vi } from 'vitest'
import { createSubscriptions } from '../subscriptions'

test('keeps stores isolated and stops notifications after unsubscribe or reset', () => {
  const first = createSubscriptions()
  const second = createSubscriptions()
  const listener = vi.fn()
  const unsubscribe = first.subscribe(listener)
  second.notify()
  expect(listener).not.toHaveBeenCalled()
  first.notify()
  expect(listener).toHaveBeenCalledTimes(1)
  unsubscribe()
  first.notify()
  expect(listener).toHaveBeenCalledTimes(1)
  first.subscribe(listener)
  first.clear()
  first.notify()
  expect(listener).toHaveBeenCalledTimes(1)
})
