import { use } from 'react'
import { SettingsDisplayContext } from '@/features/settings/providers/display-context'
import type { SettingsViewTarget, SettingsWriteTarget } from '@workspace/contracts'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

/** The tab on screen. `default` is the generated registry document, read-only. */
export type SettingsScope = SettingsViewTarget

/** Which scope the page is editing. Module-level because only the active editor tab mounts. */
const store = createStore<SettingsScope>(() => 'user')

export function settingsScope(): SettingsScope {
  return store.getState()
}

export function selectSettingsScope(next: SettingsScope) {
  store.setState(next, true)
}

export function useSettingsScope(): SettingsScope {
  const requested = useStore(store)
  return use(SettingsDisplayContext)?.scope ?? requested
}

/** The layer a write from this page goes to. The defaults tab writes nothing, so it falls back to user. */
export function writableSettingsScope(scope: SettingsScope): SettingsWriteTarget {
  return scope === 'default' ? 'user' : scope
}
