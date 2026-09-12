import type { TabId } from '@/lib/documents/utils/types'
export type EditorTabCloseTargetKind =
  | 'close'
  | 'closeAll'
  | 'closeOthers'
  | 'closeSaved'
  | 'closeToRight'

export type EditorTabCloseTarget = {
  dirty: boolean
  id: TabId
}

export function editorTabCloseTargetIds(
  tabs: readonly EditorTabCloseTarget[],
  targetId: TabId,
  kind: EditorTabCloseTargetKind,
) {
  const targetIndex = tabs.findIndex((tab) => tab.id === targetId)
  if (targetIndex === -1) return []

  if (kind === 'close') return [targetId]
  if (kind === 'closeOthers') {
    return tabs.filter((tab) => tab.id !== targetId).map((tab) => tab.id)
  }
  if (kind === 'closeToRight') {
    return tabs.slice(targetIndex + 1).map((tab) => tab.id)
  }
  if (kind === 'closeSaved') {
    return tabs.filter((tab) => !tab.dirty).map((tab) => tab.id)
  }

  return tabs.map((tab) => tab.id)
}
