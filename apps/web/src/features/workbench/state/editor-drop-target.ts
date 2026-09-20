import type { DragMoveEvent } from '@dnd-kit/core'
import { editorGroupElement, canSplitEditorGroup } from '@/lib/documents/state/group-geometry'
import { groupById, groupForTab, placeTabInGroups } from '@/lib/documents/utils/groups'
import type { EditorGroups, PlacementIds, TabPlacement } from '@/lib/documents/utils/group-types'
import type { TabId } from '@/lib/documents/utils/types'
import {
  dragPoint,
  editorDropData,
  splitEdgeAt,
  type EditorDropPreview,
} from '@/features/workbench/utils/editor-drag'

export function editorDropPreview(
  groups: EditorGroups,
  sourceTabId: TabId,
  event: DragMoveEvent,
  mode: TabPlacement['mode'],
  ids: PlacementIds,
): EditorDropPreview | null {
  const target = dropTarget(groups, sourceTabId, event, mode)
  if (!target) return null
  const result = placeTabInGroups(groups, { tabId: sourceTabId, mode, target }, ids)
  return result.status === 'applied' ? { mode, target } : null
}

function dropTarget(
  groups: EditorGroups,
  sourceTabId: TabId,
  event: DragMoveEvent,
  mode: TabPlacement['mode'],
): TabPlacement['target'] | null {
  const source = groupForTab(groups, sourceTabId)
  const tab = source?.tabs.find((item) => item.id === sourceTabId)
  const over = editorDropData(event.over?.data.current)
  if (!source || !tab || !over) return null
  if (
    mode === 'copy' &&
    (tab.content.kind === 'settings' || tab.content.document.kind === 'search')
  )
    return null
  const destination = groupById(groups, over.groupId)
  if (!destination) return null
  const point = dragPoint(event.collisions)
  if (over.kind !== 'group') {
    const beforeTabId = insertionAnchor(
      destination.tabs,
      sourceTabId,
      over,
      point?.x ?? null,
      source.id === destination.id,
    )
    return { kind: 'strip', groupId: destination.id, beforeTabId }
  }
  if (!point) return null
  const content = editorGroupElement(destination.id)?.querySelector<HTMLElement>(
    '[data-editor-group-content]',
  )
  if (!content) return null
  const edge = splitEdgeAt(content.getBoundingClientRect(), point)
  if (!edge) return { kind: 'group', groupId: destination.id }
  if (!canSplitEditorGroup(destination.id, edge)) return null
  if (mode === 'move' && source.id === destination.id && source.tabs.length === 1) return null
  return { kind: 'edge', groupId: destination.id, edge }
}

function insertionAnchor(
  tabs: readonly { readonly id: TabId }[],
  sourceTabId: TabId,
  over: NonNullable<ReturnType<typeof editorDropData>>,
  pointerX: number | null,
  sameGroup: boolean,
): TabId | null {
  if (over.kind !== 'tab') return null
  const index = tabs.findIndex((tab) => tab.id === over.tabId)
  const element = editorGroupElement(over.groupId)?.querySelector<HTMLElement>(
    `[data-editor-tab-id="${CSS.escape(over.tabId)}"]`,
  )
  const bounds = element?.getBoundingClientRect()
  const sourceIndex = tabs.findIndex((tab) => tab.id === sourceTabId)
  const after =
    pointerX === null
      ? sameGroup && sourceIndex < index
      : Boolean(bounds && pointerX > bounds.left + bounds.width / 2)
  if (!after) return over.tabId
  return tabs.slice(index + 1).find((tab) => tab.id !== sourceTabId)?.id ?? null
}
