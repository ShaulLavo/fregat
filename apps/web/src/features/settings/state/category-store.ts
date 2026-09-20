import { createSubscriptions } from '@workspace/utils/subscriptions'
import { useSyncExternalStore } from 'react'

/**
 * Which category the settings page is showing, or null for all of them.
 *
 * Module-level for the same reason as the scope store: only the active editor tab
 * mounts, and a Settings tab that forgot which section you were reading every time
 * you glanced at another file would feel broken.
 */
let category: string | null = null
const subscriptions = createSubscriptions()
const subscribe = subscriptions.subscribe

export function selectSettingsCategory(next: string | null) {
  if (next === category) return

  category = next
  subscriptions.notify()
}

export function readSettingsCategory() {
  return category
}

export function useSettingsCategory() {
  return useSyncExternalStore(subscribe, readSettingsCategory, readSettingsCategory)
}
