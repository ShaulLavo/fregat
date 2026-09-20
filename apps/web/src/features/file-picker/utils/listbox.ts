import { clamp } from '@workspace/utils/numbers'
export type FileListVirtualItem = {
  index: number
  key: string
  size: number
  start: number
}

export type FileListRowMetrics = {
  items: readonly FileListVirtualItem[]
  totalSize: number
}

export type FileListViewport = {
  height: number
  top: number
}

type VirtualRowDefinition = {
  key: string
  size: number
}

const ROW_OVERSCAN = 12

export function buildFileListRowMetrics(rows: readonly VirtualRowDefinition[]): FileListRowMetrics {
  const items: FileListVirtualItem[] = []
  let totalSize = 0

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    if (!row) continue

    items.push({ index, key: row.key, size: row.size, start: totalSize })
    totalSize += row.size
  }

  return { items, totalSize }
}

export function visibleFileListRows(
  metrics: FileListRowMetrics,
  viewport: FileListViewport,
  pinnedIndex?: number,
) {
  const items = metrics.items
  if (items.length === 0) return []

  const firstVisible = findFirstItemEndingAfter(items, viewport.top)
  const afterVisible = findFirstItemStartingAtOrAfter(items, viewport.top + viewport.height)
  const startIndex = Math.max(0, firstVisible - ROW_OVERSCAN)
  const endIndex = Math.min(items.length, afterVisible + ROW_OVERSCAN)
  const visible = items.slice(startIndex, endIndex)
  if (pinnedIndex === undefined) return visible

  const pinned = items[pinnedIndex]
  if (!pinned) return visible
  if (pinnedIndex >= startIndex && pinnedIndex < endIndex) return visible
  if (pinnedIndex < startIndex) return [pinned, ...visible]

  return [...visible, pinned]
}

export function nearestFileListScrollTop(item: FileListVirtualItem, viewport: FileListViewport) {
  if (item.start < viewport.top) return item.start

  const itemEnd = item.start + item.size
  const viewportEnd = viewport.top + viewport.height
  if (itemEnd <= viewportEnd) return viewport.top

  return Math.max(0, itemEnd - viewport.height)
}

export function fileListSelectionScrollTop(
  item: FileListVirtualItem | undefined,
  viewport: FileListViewport,
) {
  if (!item) return 0

  return nearestFileListScrollTop(item, viewport)
}

export function fileListDensityScrollTop(
  previousMetrics: FileListRowMetrics,
  nextMetrics: FileListRowMetrics,
  viewport: FileListViewport,
) {
  const maxScrollTop = Math.max(0, nextMetrics.totalSize - viewport.height)
  const previousIndex = findFirstItemEndingAfter(previousMetrics.items, viewport.top)
  const previousItem = previousMetrics.items[previousIndex]
  const nextItem = nextMetrics.items[previousIndex]
  if (!previousItem || !nextItem || previousItem.key !== nextItem.key) {
    return clamp(viewport.top, 0, maxScrollTop)
  }

  const offset = clamp(viewport.top - previousItem.start, 0, previousItem.size)
  const offsetRatio = previousItem.size === 0 ? 0 : offset / previousItem.size
  const anchoredTop = nextItem.start + nextItem.size * offsetRatio

  return clamp(anchoredTop, 0, maxScrollTop)
}

export function fileListOptionId(listId: string, path: string) {
  const encodedListId = encodeIdPart(listId)
  const encodedPath = path ? encodeIdPart(path) : 'root'

  return `${encodedListId}-option-${encodedPath}`
}

function findFirstItemEndingAfter(items: readonly FileListVirtualItem[], offset: number) {
  let low = 0
  let high = items.length

  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    const item = items[middle]
    if (item && item.start + item.size <= offset) {
      low = middle + 1
      continue
    }

    high = middle
  }

  return low
}

function findFirstItemStartingAtOrAfter(items: readonly FileListVirtualItem[], offset: number) {
  let low = 0
  let high = items.length

  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    const item = items[middle]
    if (item && item.start < offset) {
      low = middle + 1
      continue
    }

    high = middle
  }

  return low
}

function encodeIdPart(value: string) {
  return Array.from(value, (character) => character.codePointAt(0)?.toString(16) ?? '').join('-')
}
