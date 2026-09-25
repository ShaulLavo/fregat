import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

const store = createStore<string>(() => '')

export function selectSettingsSearch(next: string) {
  store.setState(next, true)
}

export function useSettingsSearch() {
  return useStore(store)
}
