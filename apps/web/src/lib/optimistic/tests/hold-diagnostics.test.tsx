import { createIntentQueue } from '@workspace/client-core/optimistic/queue'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { log } from '@/lib/client-logging'
import { LONG_HOLD_MS, SILENT_HOLD_MS, watchIntentHolds } from '@/lib/optimistic/hold-diagnostics'

beforeEach(() => {
  vi.useFakeTimers()
  document.body.innerHTML = ''
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

test('a pending intent with no status element on the page is a silent hold, and a long one escalates', () => {
  const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined)
  const queue = watchIntentHolds(createIntentQueue<{ readonly name: string }>(), {
    area: 'test',
    describe: (patch) => patch.name,
  })
  queue.submit({ name: 'rename' })

  vi.advanceTimersByTime(SILENT_HOLD_MS)
  expect(warn).toHaveBeenCalledWith(
    expect.objectContaining({ action: 'optimistic.silent_hold', area: 'test', summary: 'rename' }),
  )

  vi.advanceTimersByTime(LONG_HOLD_MS)
  expect(warn).toHaveBeenCalledWith(expect.objectContaining({ action: 'optimistic.long_hold' }))
})

test('a loader on the page or an acknowledgement before the threshold keeps the log quiet', () => {
  const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined)
  const queue = watchIntentHolds(createIntentQueue<{ readonly name: string }>(), { area: 'test' })

  document.body.innerHTML = '<div role="status"></div>'
  const covered = queue.submit({ name: 'with-loader' }).intent
  vi.advanceTimersByTime(SILENT_HOLD_MS)
  expect(warn).not.toHaveBeenCalled()
  queue.settleTransport(covered.intentId)
  queue.acknowledge(covered.intentId)

  document.body.innerHTML = ''
  const { intent } = queue.submit({ name: 'quick' })
  queue.settleTransport(intent.intentId)
  queue.acknowledge(intent.intentId)
  vi.advanceTimersByTime(LONG_HOLD_MS)
  expect(warn).not.toHaveBeenCalled()
})
