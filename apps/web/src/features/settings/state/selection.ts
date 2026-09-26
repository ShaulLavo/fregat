import type { QueryClient } from '@tanstack/react-query'
import type { SettingsSelection, TabId } from '@/lib/documents/utils/types'
import { settingsScope } from '@/features/settings/state/scope-store'
import { settingsView } from '@/features/settings/state/view-store'

const displayedSelections = new WeakMap<QueryClient, Map<TabId, SettingsSelection>>()

export function registerDisplayedSelection(
  owner: QueryClient,
  tabId: TabId,
  selection: SettingsSelection,
) {
  const selections = displayedSelections.get(owner) ?? new Map<TabId, SettingsSelection>()
  displayedSelections.set(owner, selections)
  selections.set(tabId, selection)
  return () => {
    if (selections.get(tabId) === selection) selections.delete(tabId)
  }
}

export function settingsSelection(owner: QueryClient, tabId: TabId | null): SettingsSelection {
  const shown = tabId ? displayedSelections.get(owner)?.get(tabId) : undefined
  if (shown) return shown
  if (settingsView() === 'form') return { kind: 'form' }
  return { kind: 'json', target: settingsScope() }
}
