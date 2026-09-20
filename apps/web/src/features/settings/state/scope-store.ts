import { createSubscriptions } from '@workspace/utils/subscriptions'
import type { SettingsViewTarget, SettingsWriteTarget } from '@workspace/contracts'
import { useSyncExternalStore } from 'react'

/** The tab on screen. `default` is the generated registry document, read-only. */
export type SettingsScope = SettingsViewTarget

/**
 * Which scope the page is editing.
 *
 * Module-level rather than React state because only the active editor tab
 * mounts: a Settings tab that loses its scope selection every time the user
 * looks at another file would feel broken. Small enough that a store library
 * would be more machinery than the problem needs.
 */
let scope: SettingsScope = 'user'
const subscriptions = createSubscriptions()
const subscribe = subscriptions.subscribe

export function settingsScope(): SettingsScope {
  return scope
}

export function selectSettingsScope(next: SettingsScope) {
  if (next === scope) return

  scope = next
  subscriptions.notify()
}

export function useSettingsScope(): SettingsScope {
  return useSyncExternalStore(subscribe, settingsScope, settingsScope)
}

/** The layer a write from this page goes to. The defaults tab writes nothing, so it falls back to user. */
export function writableSettingsScope(scope: SettingsScope): SettingsWriteTarget {
  return scope === 'default' ? 'user' : scope
}
