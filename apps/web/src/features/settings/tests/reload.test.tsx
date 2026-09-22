import { environmentWindowStorage } from '@/lib/environments/state/window-storage'
import { act, fireEvent, render, renderHook } from '@testing-library/react'
import { useSettingsReloadOwner } from '@/features/settings/hooks/use-reload-owner'
import { useReloadView } from '@/features/settings/hooks/use-reload-view'
import { selectSettingsScope } from '@/features/settings/state/scope-store'
import { selectSettingsView } from '@/features/settings/state/view-store'
import { selectSettingsSearch } from '@/features/settings/state/search-store'
import { QueryClient } from '@tanstack/react-query'
import { expect, test } from '../../../../test/fixtures'
import { testScopedStorage } from '../../../../test/factories/scoped-storage'
import {
  captureSettingsView,
  prepareSettingsReload,
  restoreSettingsView,
  settingsScrollTop,
  settingsReloadGeneration,
} from '@/features/settings/state/reload'
import { settingsScope } from '@/features/settings/state/scope-store'
import { settingsView } from '@/features/settings/state/view-store'

test('the settings view restores after a reload, and a different root does not claim it', () => {
  const owner = new QueryClient()
  const storage = environmentWindowStorage(testScopedStorage.environmentId)
  prepareSettingsReload(owner, storage, 'repo')
  captureSettingsView(owner, {
    scope: 'workspace',
    view: 'json',
    search: 'font',
    category: null,
    scrollTop: 48,
  })

  const reloaded = new QueryClient()
  prepareSettingsReload(reloaded, storage, 'repo')
  restoreSettingsView(reloaded)
  expect(settingsScope()).toBe('workspace')
  expect(settingsView()).toBe('json')
  expect(settingsScrollTop(reloaded, 'workspace', 'json', 'font')).toBe(48)
  expect(settingsScrollTop(reloaded, 'user', 'json', 'font')).toBe(0)

  const other = new QueryClient()
  prepareSettingsReload(other, storage, 'different-repo')
  expect(settingsScrollTop(other, 'workspace', 'json', 'font')).toBe(0)
})

test('an outgoing view cannot overwrite a new root generation', () => {
  const owner = new QueryClient()
  const storage = environmentWindowStorage(testScopedStorage.environmentId)
  prepareSettingsReload(owner, storage, 'repo')
  const generation = settingsReloadGeneration(owner)
  prepareSettingsReload(owner, storage, 'other')
  captureSettingsView(
    owner,
    { scope: 'user', view: 'form', search: '', category: null, scrollTop: 75 },
    generation,
  )
  expect(settingsScrollTop(owner, 'user', 'form', '')).toBe(0)
})

test('closing the settings form captures scroll before its ref detaches', () => {
  selectSettingsScope('user')
  selectSettingsView('form')
  selectSettingsSearch('')
  const owner = new QueryClient()
  prepareSettingsReload(
    owner,
    environmentWindowStorage(testScopedStorage.environmentId),
    'scroll-repo',
  )
  function Form() {
    const ref = useReloadView(owner, true)
    return <div ref={ref} />
  }
  const mounted = render(<Form />)
  const scroller = mounted.container.firstElementChild
  expect(scroller).not.toBeNull()
  if (scroller) {
    scroller.scrollTop = 123
    fireEvent.scroll(scroller)
  }
  mounted.unmount()
  expect(settingsScrollTop(owner, 'user', 'form', '')).toBe(123)
})

test('an invalid or oversized record leaves the view unrestored', () => {
  const storage = environmentWindowStorage(testScopedStorage.environmentId)
  for (const raw of ['{', '{"root":"repo"}', ' '.repeat(32_768)]) {
    storage.setItem('settings.view.v1', raw)
    const owner = new QueryClient()
    prepareSettingsReload(owner, storage, 'repo')
    expect(settingsScrollTop(owner, 'user', 'form', '')).toBe(0)
  }
})

test('a mounted settings reader observes root replacement without a query event', () => {
  const owner = new QueryClient()
  const storage = environmentWindowStorage(testScopedStorage.environmentId)
  prepareSettingsReload(owner, storage, 'first-root')
  const { result, unmount } = renderHook(() => useSettingsReloadOwner(owner))
  const first = result.current
  expect(first?.root).toBe('first-root')
  act(() => {
    prepareSettingsReload(owner, storage, 'second-root')
  })
  expect(result.current).not.toBe(first)
  expect(result.current?.root).toBe('second-root')
  expect(result.current?.generation).not.toBe(first?.generation)
  unmount()
})
