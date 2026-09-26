import type { ScopedProjectRef } from '@workspace/contracts'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

export type SettingsProject = {
  readonly ref: ScopedProjectRef
  readonly title: string
}

/**
 * The project the settings page is editing, or null for the whole page. Module-level because
 * only the active editor tab mounts, and the rail's menus set it before opening the tab.
 */
const store = createStore<SettingsProject | null>(() => null)

export function selectSettingsProject(next: SettingsProject | null) {
  store.setState(next, true)
}

export function useSettingsProject() {
  return useStore(store)
}
