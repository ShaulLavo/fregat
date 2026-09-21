import { writeWorkspaceCacheEntry } from '@/lib/workspace-cache-storage'
import { testScopedStorage } from '../../../test/factories/scoped-storage'
import { afterEach, vi } from 'vitest'

import { expect, test } from '../../../test/fixtures'
import { addLifecycleFlush } from '@/lib/lifecycle-flush'

afterEach(() => {
  vi.restoreAllMocks()
})

test('flushes on pagehide and hidden visibility, then removes both listeners', () => {
  const flush = vi.fn()
  const visibilityState = vi.spyOn(document, 'visibilityState', 'get')
  visibilityState.mockReturnValue('visible')
  const remove = addLifecycleFlush(flush)

  document.dispatchEvent(new Event('visibilitychange'))
  expect(flush).not.toHaveBeenCalled()

  visibilityState.mockReturnValue('hidden')
  document.dispatchEvent(new Event('visibilitychange'))
  window.dispatchEvent(new Event('pagehide'))
  expect(flush).toHaveBeenCalledTimes(2)

  remove()
  document.dispatchEvent(new Event('visibilitychange'))
  window.dispatchEvent(new Event('pagehide'))
  expect(flush).toHaveBeenCalledTimes(2)
})

test('measures whole lifecycle flush and actual serialized writes without cache contents', () => {
  const value = { text: 'private fixture' }
  const remove = addLifecycleFlush(() =>
    writeWorkspaceCacheEntry('measured', value, { storage: testScopedStorage }),
  )
  window.dispatchEvent(new Event('pagehide'))
  const entry = performance.getEntriesByName('workspace.reload.flush').at(-1) as PerformanceMeasure
  expect(entry.detail).toMatchObject({
    callbacks: 1,
    writes: 1,
    serializedBytes: JSON.stringify(value).length * 2,
    writtenBytes: JSON.stringify(value).length * 2,
  })
  expect(entry.detail.durationMs).toBeGreaterThanOrEqual(entry.detail.writeMs)
  expect(JSON.stringify(entry.detail)).not.toContain(value.text)
  remove()
})

test('a failed owner flush does not prevent another owner from saving', () => {
  const removeBroken = addLifecycleFlush(() => {
    throw new DOMException('fixture', 'QuotaExceededError')
  })
  const saved = vi.fn()
  const removeSaved = addLifecycleFlush(saved)
  window.dispatchEvent(new Event('pagehide'))
  expect(saved).toHaveBeenCalledOnce()
  removeBroken()
  removeSaved()
})
