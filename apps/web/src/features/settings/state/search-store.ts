import { useSyncExternalStore } from 'react'

let search = ''
const searchListeners = new Set<() => void>()

export function selectSettingsSearch(next: string) {
  if (next === search) return
  search = next
  for (const listener of searchListeners) listener()
}

export function useSettingsSearch() {
  return useSyncExternalStore(
    subscribeSearch,
    () => search,
    () => search,
  )
}

function subscribeSearch(listener: () => void) {
  searchListeners.add(listener)
  return () => searchListeners.delete(listener)
}
