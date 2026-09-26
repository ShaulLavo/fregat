import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

/**
 * Which category the settings page is showing, or null for all of them.
 * Module-level because only the active editor tab mounts, and the section must survive a tab switch.
 */
const store = createStore<string | null>(() => null)

export function selectSettingsCategory(next: string | null) {
  store.setState(next, true)
}

export function readSettingsCategory() {
  return store.getState()
}

export function useSettingsCategory() {
  return useStore(store)
}
