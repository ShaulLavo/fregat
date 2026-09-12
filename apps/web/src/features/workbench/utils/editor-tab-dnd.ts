import type { TabId } from '@/lib/documents/utils/types'
import type { UniqueIdentifier } from '@dnd-kit/core'

import type { EditorTabModel } from '@/features/workspace/utils/tab-types'

export type EditorTabReorderIntent = {
  readonly tabId: TabId
  readonly targetIndex: number
}

export function editorTabReorderIntent(
  tabs: readonly Pick<EditorTabModel, 'id'>[],
  activeId: UniqueIdentifier,
  overId: UniqueIdentifier | null | undefined,
): EditorTabReorderIntent | null {
  if (!overId) return null

  const activeTabId = String(activeId)
  const overTabId = String(overId)
  if (activeTabId === overTabId) return null
  const activeTab = tabs.find((tab) => tab.id === activeTabId)
  if (!activeTab) return null

  const targetIndex = editorTabIndexById(tabs, overTabId)
  if (targetIndex < 0) return null

  return { tabId: activeTab.id, targetIndex }
}

function editorTabIndexById(tabs: readonly Pick<EditorTabModel, 'id'>[], tabId: string) {
  return tabs.findIndex((tab) => tab.id === tabId)
}
