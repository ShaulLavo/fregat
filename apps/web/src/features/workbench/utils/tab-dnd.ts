import type { UniqueIdentifier } from '@dnd-kit/core'

export type TabReorderIntent<Id extends string> = {
  readonly tabId: Id
  readonly targetIndex: number
}

export function tabReorderIntent<Id extends string>(
  tabs: readonly { readonly id: Id }[],
  activeId: UniqueIdentifier,
  overId: UniqueIdentifier | null | undefined,
): TabReorderIntent<Id> | null {
  if (!overId) return null

  const activeTabId = String(activeId)
  const overTabId = String(overId)
  if (activeTabId === overTabId) return null
  const activeTab = tabs.find((tab) => tab.id === activeTabId)
  if (!activeTab) return null

  const targetIndex = tabs.findIndex((tab) => tab.id === overTabId)
  if (targetIndex < 0) return null

  return { tabId: activeTab.id, targetIndex }
}
