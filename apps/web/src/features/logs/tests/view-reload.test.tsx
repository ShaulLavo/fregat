import { QueryClient } from '@tanstack/react-query'
import { expect, test } from '../../../../test/fixtures'
import { testScopedStorage } from '../../../../test/factories/scoped-storage'
import { environmentWindowStorage } from '@/lib/environments/state/window-storage'
import {
  captureLogsView,
  prepareLogsViewReload,
  savedLogsView,
  savedLogsWindow,
} from '@/features/logs/state/view-reload'

const view = {
  filterKey: '["be"]',
  windowTime: 1_700_000_000_000,
  scrollTop: 740,
  inspectedId: 'e1',
}

test('the logs scroll, window and inspected row survive a reload under the same filters', () => {
  const storage = environmentWindowStorage(testScopedStorage.environmentId)
  const owner = new QueryClient()
  prepareLogsViewReload(owner, storage, 'repo')
  captureLogsView(owner, view)

  const reloaded = new QueryClient()
  prepareLogsViewReload(reloaded, storage, 'repo')
  expect(savedLogsView(reloaded, view.filterKey)?.scrollTop).toBe(740)
  expect(savedLogsView(reloaded, view.filterKey)?.inspectedId).toBe('e1')
  expect(savedLogsWindow(reloaded)?.windowTime).toBe(view.windowTime)
  // A different filter set is a different list, so it starts at the top.
  expect(savedLogsView(reloaded, '["client"]')).toBeNull()
})

test('a different root does not inherit the view, and no events are persisted', () => {
  const storage = environmentWindowStorage(testScopedStorage.environmentId)
  const owner = new QueryClient()
  prepareLogsViewReload(owner, storage, 'repo')
  captureLogsView(owner, view)
  expect(storage.getItem('logs.view.v1')).not.toContain('events')

  const other = new QueryClient()
  prepareLogsViewReload(other, storage, 'different-repo')
  expect(savedLogsView(other, view.filterKey)).toBeNull()
})
