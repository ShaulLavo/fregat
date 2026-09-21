import { act, renderHook } from '@testing-library/react'
import { useLogsReload } from '@/features/logs/hooks/use-reload'
import type { PropsWithChildren } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, test } from '../../../../test/fixtures'
import { testScopedStorage } from '../../../../test/factories/scoped-storage'
import {
  captureLogs,
  logsFilterIdentity,
  logsReloadOwner,
  prepareLogsReload,
  savedLogs,
} from '@/features/logs/state/reload'
import { defaultLogsFilterState } from '@/features/logs/utils/filter-params'

const filterKey = logsFilterIdentity(defaultLogsFilterState())
const record = {
  filterKey,
  windowTime: 1000,
  observedAt: 1100,
  events: { events: [], detailsById: {}, nextCursor: 'observed-only', total: 200 },
  scrollTop: 240,
  inspectedId: null,
}

test('restores observed coverage and anchor without a live cache or cursor', () => {
  const owner = new QueryClient()
  prepareLogsReload(owner, testScopedStorage, 'repo')
  captureLogs(owner, logsReloadOwner(owner), record)
  const next = new QueryClient()
  prepareLogsReload(next, testScopedStorage, 'repo')
  expect(savedLogs(next, filterKey)).toMatchObject(record)
  expect(next.getQueryCache().getAll()).toHaveLength(0)
  expect(
    savedLogs(next, logsFilterIdentity({ ...defaultLogsFilterState(), search: 'different URL' })),
  ).toBeNull()
  prepareLogsReload(next, testScopedStorage, 'other')
  expect(savedLogs(next, filterKey)).toBeNull()
})

test('a detached root capture cannot overwrite the next owner', () => {
  const owner = new QueryClient()
  prepareLogsReload(owner, testScopedStorage, 'repo')
  const target = logsReloadOwner(owner)
  prepareLogsReload(owner, testScopedStorage, 'other')
  captureLogs(owner, target, record)
  expect(savedLogs(owner, filterKey)).toBeNull()
})

test('oversized and corrupt records fall back to fetching', () => {
  const owner = new QueryClient()
  testScopedStorage.setItem('logs.display.v1', '{bad')
  prepareLogsReload(owner, testScopedStorage, 'repo')
  expect(savedLogs(owner, filterKey)).toBeNull()
  captureLogs(owner, logsReloadOwner(owner), { ...record, filterKey: 'a'.repeat(200_000) })
  expect(testScopedStorage.getItem('logs.display.v1')).toBeNull()
})

test('pending saved logs persist accepted scroll and inspection without fresh observation or query data', () => {
  const owner = new QueryClient()
  prepareLogsReload(owner, testScopedStorage, 'repo')
  captureLogs(owner, logsReloadOwner(owner), record)
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={owner}>{children}</QueryClientProvider>
  )
  const { result, rerender, unmount } = renderHook(
    ({ key, inspectedId }) =>
      useLogsReload(key, 9999, undefined, undefined, undefined, inspectedId),
    { wrapper, initialProps: { key: filterKey, inspectedId: null as string | null } },
  )
  act(() => result.current.onScroll(740))
  rerender({ key: filterKey, inspectedId: 'inspected-saved-row' })
  act(() => window.dispatchEvent(new Event('pagehide')))
  expect(savedLogs(owner, filterKey)).toMatchObject({
    ...record,
    scrollTop: 740,
    inspectedId: 'inspected-saved-row',
  })
  expect(owner.getQueryData(['logs', 'events'])).toBeUndefined()
  expect(owner.getQueryCache().getAll()).toHaveLength(0)
  rerender({ key: 'different-filter', inspectedId: null })
  act(() => {
    result.current.onScroll(900)
    window.dispatchEvent(new Event('pagehide'))
  })
  expect(savedLogs(owner, 'different-filter')).toBeNull()
  expect(savedLogs(owner, filterKey)?.scrollTop).toBe(740)
  unmount()
  const next = new QueryClient()
  prepareLogsReload(next, testScopedStorage, 'repo')
  expect(savedLogs(next, filterKey)?.scrollTop).toBe(740)
})
