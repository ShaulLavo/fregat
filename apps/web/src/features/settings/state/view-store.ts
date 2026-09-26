import { use } from 'react'
import { SettingsDisplayContext } from '@/features/settings/providers/display-context'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

export type SettingsView = 'form' | 'json'

/**
 * Whether the settings tab shows the form or the raw document; module-level so it survives a tab switch.
 * Not a setting: the JSON view is how you fix a broken document, so it cannot depend on one.
 */
const store = createStore<SettingsView>(() => 'form')

export function settingsView(): SettingsView {
  return store.getState()
}

export function selectSettingsView(next: SettingsView) {
  store.setState(next, true)
}

export function useSettingsView(): SettingsView {
  const requested = useStore(store)
  return use(SettingsDisplayContext)?.view ?? requested
}
