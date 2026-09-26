import { act, render } from '@testing-library/react'
import { Toaster } from '@workspace/ui/components/sonner'
import { toast } from 'sonner'
import { afterAll, expect, test, vi } from 'vitest'

// Removal timers sonner scheduled that have not fired yet.
const pendingRemovals = new Set<ReturnType<typeof setTimeout>>()
const realSetTimeout = globalThis.setTimeout
const spy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
  callback: (...args: unknown[]) => void,
  ms?: number,
  ...args: unknown[]
) => {
  const id: ReturnType<typeof setTimeout> = realSetTimeout(() => {
    pendingRemovals.delete(id)
    callback(...args)
  }, ms)
  if (ms === 200) pendingRemovals.add(id)
  return id
}) as typeof setTimeout)

afterAll(() => {
  spy.mockRestore()
})

/** sonner applies each toast change on a zero-delay timer of its own. */
function nextTask() {
  return new Promise((resolve) => realSetTimeout(resolve, 0))
}

test("a toast closed in a test starts sonner's removal timer", async () => {
  render(<Toaster />)
  await act(async () => {
    toast('Session archived', { id: 'toast-timers' })
    await nextTask()
  })
  expect(document.querySelectorAll('[data-sonner-toast]')).toHaveLength(1)
  await act(async () => {
    toast.dismiss('toast-timers')
    await nextTask()
  })

  expect(pendingRemovals.size).toBeGreaterThan(0)
})

test('no removal timer outlives the test that started it', () => {
  expect(pendingRemovals.size).toBe(0)
})

test('a toast left open is closed with its test', async () => {
  render(<Toaster />)
  await act(async () => {
    toast('Session restored', { duration: 60_000, id: 'toast-timers-open' })
    await nextTask()
  })

  expect(document.querySelectorAll('[data-sonner-toast]')).toHaveLength(1)
})

test('the open toast neither stays nor leaves a removal timer behind', () => {
  expect(toast.getToasts()).toHaveLength(0)
  expect(pendingRemovals.size).toBe(0)
})
