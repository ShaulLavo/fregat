import { canSplitGroup } from '@/lib/documents/utils/group-layout'
import type { GroupEdge, GroupId, TabPlacement } from '@/lib/documents/utils/group-types'

export function editorGroupElement(id: GroupId): HTMLElement | null {
  if (typeof document === 'undefined') return null
  return (
    Array.from(document.querySelectorAll<HTMLElement>('[data-editor-group-id]')).find(
      (element) => element.dataset.editorGroupId === id,
    ) ?? null
  )
}

export function readGroupBounds(id: GroupId): DOMRect | null {
  return editorGroupElement(id)?.getBoundingClientRect() ?? null
}

export function canSplitEditorGroup(id: GroupId, edge: GroupEdge): boolean {
  const bounds = readGroupBounds(id)
  return bounds !== null && canSplitGroup(bounds, edge)
}

export function canPlaceEditorTab(placement: TabPlacement): boolean {
  if (placement.target.kind !== 'edge') return true
  return canSplitEditorGroup(placement.target.groupId, placement.target.edge)
}
