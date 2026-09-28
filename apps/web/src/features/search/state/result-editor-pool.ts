import type {
  SearchResultFileEditorSlot,
  SearchResultRenderedFileResultItem,
} from '@/features/search/utils/result-editor-types'
import {
  equalSearchResultFileEditorLineWindow,
  searchResultFileEditorLineWindow,
  type SearchResultFileEditorLineWindow,
} from '@/features/search/utils/result-editor'
import type { SearchResultId } from '@/features/search/utils/result-items'
import type { SearchResultVirtualListViewport } from '@/features/search/utils/result-virtual-list'

type ShownFile = {
  readonly item: SearchResultRenderedFileResultItem
  readonly lineWindow: SearchResultFileEditorLineWindow
}

/**
 * Editor slots keyed by position, so a file scrolling in takes a freed slot's editor and opens its
 * document there. Only files with lines in view take a slot; a freed slot parks until reused.
 */
export function syncSearchResultFileEditorSlots(
  slots: readonly SearchResultFileEditorSlot[],
  items: readonly SearchResultRenderedFileResultItem[],
  viewport: SearchResultVirtualListViewport,
): readonly SearchResultFileEditorSlot[] {
  const shown = shownFiles(items, viewport)
  const next: SearchResultFileEditorSlot[] = []
  const free: number[] = []
  for (const slot of slots) {
    const file = shown.get(slot.item.row.file.id)
    if (!file) {
      free.push(next.length)
      next.push(parkedSlot(slot))
      continue
    }

    shown.delete(slot.item.row.file.id)
    next.push(shownSlot(slot, file))
  }
  let freeIndex = 0
  for (const file of shown.values()) {
    const index = free[freeIndex]
    freeIndex += 1
    const slot = index === undefined ? undefined : next[index]
    if (index === undefined || !slot) {
      next.push({ key: `slot:${next.length}`, ...file, visible: true })
      continue
    }

    next[index] = shownSlot(slot, file)
  }

  return sameSlots(slots, next) ? slots : next
}

function shownFiles(
  items: readonly SearchResultRenderedFileResultItem[],
  viewport: SearchResultVirtualListViewport,
) {
  const shown = new Map<SearchResultId, ShownFile>()
  for (const item of items) {
    const lineWindow = searchResultFileEditorLineWindow({
      lineCount: item.row.file.excerpts.length,
      virtualItem: item.virtualItem,
      viewport,
    })
    if (lineWindow.end <= lineWindow.start) continue

    shown.set(item.row.file.id, { item, lineWindow })
  }

  return shown
}

function shownSlot(slot: SearchResultFileEditorSlot, file: ShownFile): SearchResultFileEditorSlot {
  const item = sameItem(slot.item, file.item) ? slot.item : file.item
  const lineWindow = equalSearchResultFileEditorLineWindow(slot.lineWindow, file.lineWindow)
    ? slot.lineWindow
    : file.lineWindow
  if (slot.visible && item === slot.item && lineWindow === slot.lineWindow) return slot

  return { key: slot.key, item, lineWindow, visible: true }
}

function parkedSlot(slot: SearchResultFileEditorSlot): SearchResultFileEditorSlot {
  if (!slot.visible) return slot

  return { ...slot, visible: false }
}

function sameItem(
  left: SearchResultRenderedFileResultItem,
  right: SearchResultRenderedFileResultItem,
) {
  return (
    left.renderKey === right.renderKey &&
    left.row === right.row &&
    left.virtualItem === right.virtualItem
  )
}

function sameSlots(
  left: readonly SearchResultFileEditorSlot[],
  right: readonly SearchResultFileEditorSlot[],
) {
  if (left.length !== right.length) return false

  return left.every((slot, index) => slot === right[index])
}
