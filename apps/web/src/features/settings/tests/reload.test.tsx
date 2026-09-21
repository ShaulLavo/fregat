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
import { settingsSnapshot } from '../../../../test/factories/settings'
import { settingsKeys } from '@workspace/client-core/settings/query-keys'
import {
  captureSettingsView,
  prepareSettingsReload,
  restoreSettingsView,
  savedSettings,
  settingsScrollTop,
  settingsReloadGeneration,
  SETTINGS_RELOAD_MAX_BYTES,
} from '@/features/settings/state/reload'
import { settingsScope } from '@/features/settings/state/scope-store'
import { settingsView } from '@/features/settings/state/view-store'

test('saved settings restore display and view without confirming revisions', () => {
  const owner = new QueryClient()
  const stop = prepareSettingsReload(
    owner,
    environmentWindowStorage(testScopedStorage.environmentId),
    'repo',
  )
  const snapshot = settingsSnapshot({ values: { 'editor.fontSize': 23 } })
  owner.setQueryData(settingsKeys.document(), snapshot)
  captureSettingsView(owner, {
    scope: 'workspace',
    view: 'json',
    search: 'font',
    category: null,
    scrollTop: 48,
  })
  stop()
  const reloaded = new QueryClient()
  const dispose = prepareSettingsReload(
    reloaded,
    environmentWindowStorage(testScopedStorage.environmentId),
    'repo',
  )
  expect(savedSettings(reloaded)?.values['editor.fontSize']).toBe(23)
  expect(reloaded.getQueryData(settingsKeys.document())).toBeUndefined()
  restoreSettingsView(reloaded)
  expect(settingsScope()).toBe('workspace')
  expect(settingsView()).toBe('json')
  expect(settingsScrollTop(reloaded, 'workspace', 'json', 'font')).toBe(48)
  expect(settingsScrollTop(reloaded, 'user', 'json', 'font')).toBe(0)
  dispose()
  const other = new QueryClient()
  const stopOther = prepareSettingsReload(
    other,
    environmentWindowStorage(testScopedStorage.environmentId),
    'different-repo',
  )
  expect(savedSettings(other)).toBeUndefined()
  stopOther()
})

test('an outgoing view cannot overwrite a new root generation', () => {
  const owner = new QueryClient()
  const stop = prepareSettingsReload(
    owner,
    environmentWindowStorage(testScopedStorage.environmentId),
    'repo',
  )
  const generation = settingsReloadGeneration(owner)
  stop()
  const dispose = prepareSettingsReload(
    owner,
    environmentWindowStorage(testScopedStorage.environmentId),
    'other',
  )
  captureSettingsView(
    owner,
    { scope: 'user', view: 'form', search: '', category: null, scrollTop: 75 },
    generation,
  )
  expect(settingsScrollTop(owner, 'user', 'form', '')).toBe(0)
  dispose()
})

test('closing the settings form captures scroll before its ref detaches', () => {
  selectSettingsScope('user')
  selectSettingsView('form')
  selectSettingsSearch('')
  const owner = new QueryClient()
  const stop = prepareSettingsReload(
    owner,
    environmentWindowStorage(testScopedStorage.environmentId),
    'scroll-repo',
  )
  owner.setQueryData(settingsKeys.document(), settingsSnapshot())
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
  stop()
})

test('invalid and oversized settings records fall back without confirming data', () => {
  const storage = environmentWindowStorage(testScopedStorage.environmentId)
  for (const raw of ['{', '{"root":"repo"}', ' '.repeat(SETTINGS_RELOAD_MAX_BYTES)]) {
    storage.setItem('settings.display.v1', raw)
    const owner = new QueryClient()
    const dispose = prepareSettingsReload(
      owner,
      environmentWindowStorage(testScopedStorage.environmentId),
      'repo',
    )
    expect(savedSettings(owner)).toBeUndefined()
    expect(owner.getQueryData(settingsKeys.document())).toBeUndefined()
    expect(storage.getItem('settings.display.v1')).toBeNull()
    dispose()
  }
})

test('local view changes survive another reload while settings revalidation is pending', () => {
  const warm = new QueryClient()
  const stopWarm = prepareSettingsReload(
    warm,
    environmentWindowStorage(testScopedStorage.environmentId),
    'pending-view',
  )
  warm.setQueryData(settingsKeys.document(), settingsSnapshot())
  captureSettingsView(warm, {
    scope: 'user',
    view: 'form',
    search: 'editor',
    category: null,
    scrollTop: 320,
  })
  stopWarm()
  const pending = new QueryClient()
  const stopPending = prepareSettingsReload(
    pending,
    environmentWindowStorage(testScopedStorage.environmentId),
    'pending-view',
  )
  expect(savedSettings(pending)).toBeDefined()
  captureSettingsView(pending, {
    scope: 'user',
    view: 'form',
    search: 'font size',
    category: null,
    scrollTop: 24,
  })
  expect(pending.getQueryData(settingsKeys.document())).toBeUndefined()
  stopPending()
  const reopened = new QueryClient()
  const stopReopened = prepareSettingsReload(
    reopened,
    environmentWindowStorage(testScopedStorage.environmentId),
    'pending-view',
  )
  expect(settingsScrollTop(reopened, 'user', 'form', 'font size')).toBe(24)
  expect(reopened.getQueryData(settingsKeys.document())).toBeUndefined()
  stopReopened()
})

test('a mounted settings reader observes root replacement without a query event', () => {
  const owner = new QueryClient()
  const storage = environmentWindowStorage(testScopedStorage.environmentId)
  const stop = prepareSettingsReload(owner, storage, 'first-root')
  owner.setQueryData(settingsKeys.document(), settingsSnapshot())
  const { result, unmount } = renderHook(() => useSettingsReloadOwner(owner))
  const first = result.current
  expect(first?.saved).toBeDefined()
  stop()
  let stopNext = () => {}
  act(() => {
    stopNext = prepareSettingsReload(owner, storage, 'second-root')
  })
  expect(result.current).not.toBe(first)
  expect(result.current?.root).toBe('second-root')
  expect(result.current?.saved).toBeUndefined()
  expect(result.current?.generation).not.toBe(first?.generation)
  unmount()
  stopNext()
})
