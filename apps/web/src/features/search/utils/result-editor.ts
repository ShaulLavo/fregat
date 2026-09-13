import type { EditorRangeDecoration, EditorScrollMode } from '@singapore-editor/core'
import type { CSSProperties, KeyboardEvent, RefObject } from 'react'

import type { SearchResultId } from '@/features/search/utils/result-items'
import {
  searchResultFileDocumentLineAtRow,
  searchResultVirtualRowContainsId,
  searchResultVirtualRowId,
  type SearchResultFileBlock,
  type SearchResultFileDocument,
  type SearchResultFileDocumentLine,
  type SearchResultRange,
  type SearchResultVirtualRow,
} from '@/features/search/utils/result-view-model'
import type {
  SearchResultVirtualListMetrics,
  SearchResultVirtualListViewport,
} from '@/features/search/utils/result-virtual-list'
import { colorForFileIcon, type ResolvedFileIcon } from '@/lib/file-icons'
import { cn } from '@workspace/ui/lib/utils'

import {
  EXCERPT_EDITOR_LINE_HEIGHT,
  FILE_RESULTS_EDITOR_MIN_HEIGHT,
  FILE_RESULTS_ROW_VERTICAL_PADDING,
  FILE_ROW_ESTIMATE,
  SEARCH_RESULT_FILE_EDITOR_FULL_RENDER_LINE_LIMIT,
  SEARCH_RESULT_FILE_EDITOR_LINE_OVERSCAN,
  SEARCH_RESULT_FILE_EDITOR_ROW_GAP,
  SEARCH_RESULT_STATIC_EDITOR_LINE_LIMIT,
  SEARCH_RESULT_VIRTUAL_BASE_MIN_OVERSCAN,
  SEARCH_RESULT_VIRTUAL_BASE_OVERSCAN_RATIO,
  SEARCH_RESULT_VIRTUAL_FAST_MIN_OVERSCAN,
  SEARCH_RESULT_VIRTUAL_FAST_OVERSCAN_RATIO,
  SEARCH_RESULT_VIRTUAL_FAST_SCROLL_PX_PER_MS,
  SEARCH_RESULT_VIRTUAL_FLING_MIN_OVERSCAN,
  SEARCH_RESULT_VIRTUAL_FLING_OVERSCAN_RATIO,
  SEARCH_RESULT_VIRTUAL_FLING_SCROLL_PX_PER_MS,
  SEARCH_RESULT_VIRTUAL_ROW_OFFSET,
} from '@/features/search/utils/result-editor-constants'
import type {
  SearchResultEditorScrollToIndex,
  SearchResultRenderedFileResultItem,
  SearchResultRenderedVirtualItem,
  SearchResultVirtualOverscanLevel,
  SearchResultVirtualRowScrollTarget,
} from '@/features/search/utils/result-editor-types'

const PASSIVE_MATCH_STYLE = {
  backgroundColor: 'var(--search-result-match-background)',
} satisfies Partial<CSSStyleDeclaration>

export const SEARCH_RESULT_FILE_DOCUMENT_ID_PREFIX = 'search-result-file:'

const ACTIVE_MATCH_STYLE = {
  backgroundColor: 'var(--search-result-match-active-background)',
  textDecoration: 'underline 1px var(--search-result-match-active-decoration)',
} satisfies Partial<CSSStyleDeclaration>

export function scrollActiveSearchResultIntoView({
  activeIndexRef,
  activeScrollTargetRef,
  scrollToIndexRef,
}: {
  activeIndexRef: RefObject<number>
  activeScrollTargetRef: RefObject<SearchResultVirtualRowScrollTarget | null>
  scrollToIndexRef: RefObject<SearchResultEditorScrollToIndex>
}) {
  const currentActiveIndex = activeIndexRef.current
  if (currentActiveIndex < 0) return

  scrollToIndexRef.current(currentActiveIndex, activeScrollTargetRef.current)
}

export function resetSearchResultScroll(
  ref: RefObject<HTMLDivElement | null>,
  scrollToOffset: (offset: number) => void,
) {
  if (ref.current) ref.current.scrollTop = 0

  scrollToOffset(0)
}

export function searchResultFileRangeDecorations(
  document: SearchResultFileDocument,
  activeResultId: SearchResultId | null,
) {
  const decorations: EditorRangeDecoration[] = []
  for (const line of document.lines) {
    const active = line.id === activeResultId
    for (const range of line.matchRanges) {
      decorations.push(searchResultRangeDecoration(range, active))
    }
  }

  return decorations
}

function searchResultRangeDecoration(
  range: SearchResultRange,
  active: boolean,
): EditorRangeDecoration {
  const className = active ? 'search-result-match-active' : 'search-result-match'
  const style = active ? ACTIVE_MATCH_STYLE : PASSIVE_MATCH_STYLE

  return {
    className,
    end: range.end,
    start: range.start,
    style,
  }
}

export function fileBlockLineDigits(block: SearchResultFileBlock) {
  let digits = 1
  for (const excerpt of block.excerpts) {
    digits = Math.max(digits, decimalDigitCount(excerpt.startLine))
  }

  return digits
}

export function searchResultVirtualRowIndex(
  rows: readonly SearchResultVirtualRow[],
  id: SearchResultId | null,
) {
  if (!id) return -1

  return rows.findIndex((row) => searchResultVirtualRowContainsId(row, id))
}

export function searchResultVirtualRowScrollTarget(
  row: SearchResultVirtualRow | null,
  activeResultId: SearchResultId | null,
): SearchResultVirtualRowScrollTarget | null {
  if (!row) return null
  if (row.type === 'file') {
    return {
      offset: 0,
      size: FILE_ROW_ESTIMATE,
    }
  }
  if (!activeResultId) return null

  const index = row.file.excerpts.findIndex((excerpt) => excerpt.id === activeResultId)
  if (index < 0) return null

  return {
    offset: searchResultFileExcerptOffset(index),
    size: EXCERPT_EDITOR_LINE_HEIGHT,
  }
}

function searchResultFileExcerptOffset(index: number) {
  const rowStep = EXCERPT_EDITOR_LINE_HEIGHT + SEARCH_RESULT_FILE_EDITOR_ROW_GAP
  const visibleIndex = Math.min(index, SEARCH_RESULT_STATIC_EDITOR_LINE_LIMIT - 1)

  return FILE_RESULTS_ROW_VERTICAL_PADDING / 2 + Math.max(0, visibleIndex) * rowStep
}

function searchResultVirtualRowEstimate(row: SearchResultVirtualRow | undefined) {
  if (row?.type === 'file') return FILE_ROW_ESTIMATE
  if (row?.type === 'file-results') return searchResultFileEditorRowHeight(row.file)

  return FILE_RESULTS_EDITOR_MIN_HEIGHT
}

function searchResultVirtualRowKey(row: SearchResultVirtualRow | undefined, index: number) {
  if (!row) return `missing:${index}`

  return searchResultVirtualRowId(row)
}

export function searchResultRenderedVirtualItems(
  virtualItems: SearchResultVirtualListMetrics['items'],
  rows: readonly SearchResultVirtualRow[],
): SearchResultRenderedVirtualItem[] {
  const renderedItems: SearchResultRenderedVirtualItem[] = []

  for (const virtualItem of virtualItems) {
    const row = rows[virtualItem.index]
    if (!row) continue

    renderedItems.push({
      renderKey: virtualItem.key,
      row,
      virtualItem,
    })
  }

  return renderedItems
}

export function isSearchResultRenderedFileResultItem(
  item: SearchResultRenderedVirtualItem,
): item is SearchResultRenderedFileResultItem {
  return item.row.type === 'file-results'
}

export function searchResultVirtualRowStyle(
  virtualItem: SearchResultVirtualListMetrics['items'][number],
): CSSProperties {
  return {
    contain: 'layout paint style',
    height: virtualItem.size,
    transform: `translateY(${virtualItem.start + SEARCH_RESULT_VIRTUAL_ROW_OFFSET}px)`,
  }
}

export function searchResultVirtualRowInputs(rows: readonly SearchResultVirtualRow[]) {
  return rows.map((row, index) => ({
    key: searchResultVirtualRowKey(row, index),
    size: searchResultVirtualRowEstimate(row),
  }))
}

export function searchResultVirtualOverscan(
  viewportHeight: number,
  level: SearchResultVirtualOverscanLevel,
) {
  const height = Math.max(0, viewportHeight)
  if (level === 2) {
    return Math.max(
      SEARCH_RESULT_VIRTUAL_FLING_MIN_OVERSCAN,
      Math.floor(height * SEARCH_RESULT_VIRTUAL_FLING_OVERSCAN_RATIO),
    )
  }
  if (level === 1) {
    return Math.max(
      SEARCH_RESULT_VIRTUAL_FAST_MIN_OVERSCAN,
      Math.floor(height * SEARCH_RESULT_VIRTUAL_FAST_OVERSCAN_RATIO),
    )
  }

  return Math.max(
    SEARCH_RESULT_VIRTUAL_BASE_MIN_OVERSCAN,
    Math.floor(height * SEARCH_RESULT_VIRTUAL_BASE_OVERSCAN_RATIO),
  )
}

export function searchResultVirtualOverscanLevel(
  velocityPxPerMs: number,
): SearchResultVirtualOverscanLevel {
  if (velocityPxPerMs >= SEARCH_RESULT_VIRTUAL_FLING_SCROLL_PX_PER_MS) return 2
  if (velocityPxPerMs >= SEARCH_RESULT_VIRTUAL_FAST_SCROLL_PX_PER_MS) return 1

  return 0
}

export function searchResultFileEditorRenderViewport(
  viewport: SearchResultVirtualListViewport,
): SearchResultVirtualListViewport {
  const rowStride = EXCERPT_EDITOR_LINE_HEIGHT + SEARCH_RESULT_FILE_EDITOR_ROW_GAP

  return {
    height: viewport.height,
    top: Math.floor(viewport.top / rowStride) * rowStride,
  }
}

export function searchResultVirtualViewportHeight(entry: ResizeObserverEntry) {
  return Math.max(0, Math.floor(entry.contentRect.height))
}

export function searchResultVirtualRowExpanded(row: SearchResultVirtualRow) {
  if (row.type !== 'file') return undefined
  if (row.file.excerpts.length === 0) return undefined

  return !row.file.collapsed
}

export function openFileResultOnEnter(event: KeyboardEvent<HTMLDivElement>, onOpen: () => void) {
  if (event.key !== 'Enter') return false
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false

  event.preventDefault()
  event.stopPropagation()
  onOpen()
  return true
}

export function readonlyEditingKey(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key === 'Backspace') return true
  if (event.key === 'Delete') return true
  if (event.key === 'Tab') return true
  if (event.key !== 'Enter') return false

  return event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
}

export function preventReadonlyInput(event: { preventDefault(): void; stopPropagation(): void }) {
  event.preventDefault()
  event.stopPropagation()
}

export function isSearchResultEditorActionTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false

  return target.closest('button') !== null
}

export function searchResultFileLineIdAtClientY(
  document: SearchResultFileDocument,
  element: HTMLElement,
  clientY: number,
) {
  const rect = element.getBoundingClientRect()
  const style = getComputedStyle(element)
  const offsetY = clientY - rect.top - Number.parseFloat(style.paddingTop)

  return searchResultFileLineIdAtOffsetY(document, offsetY)
}

function searchResultFileLineIdAtOffsetY(document: SearchResultFileDocument, offsetY: number) {
  if (offsetY < 0) return null

  const rowStride = EXCERPT_EDITOR_LINE_HEIGHT + SEARCH_RESULT_FILE_EDITOR_ROW_GAP
  const row = Math.floor(offsetY / rowStride)
  const rowTop = row * rowStride
  if (offsetY > rowTop + EXCERPT_EDITOR_LINE_HEIGHT) return null

  return document.lines[row]?.id ?? null
}

export function currentSearchResultFileLine(
  document: SearchResultFileDocument,
  controller: { getState(): { cursor: { row: number } } | null },
) {
  const row = controller.getState()?.cursor.row

  return searchResultFileDocumentLineAtRow(document, row) ?? document.lines[0] ?? null
}

export function searchResultFileDocumentId(file: SearchResultFileBlock) {
  return `${SEARCH_RESULT_FILE_DOCUMENT_ID_PREFIX}${file.path}`
}

export function searchResultFileDocumentRevision(
  document: SearchResultFileDocument,
  window: SearchResultFileEditorLineWindow,
) {
  return `${window.start}:${window.end}:${document.text}`
}

export function searchResultLineOpenLabel(line: SearchResultFileDocumentLine) {
  const match = line.sourceMatch
  if (typeof match.column !== 'number') return `Open result at line ${line.sourceLine}`

  return `Open result at line ${line.sourceLine}, column ${match.column}`
}

export function searchResultLineActionClassName() {
  return cn(
    'pointer-events-none opacity-0 transition-opacity focus-visible:pointer-events-auto focus-visible:opacity-100 group-data-[hovered=true]/search-result-line-action-row:pointer-events-auto group-data-[hovered=true]/search-result-line-action-row:opacity-100',
  )
}

export function searchResultDomId(treeId: string, itemId: string) {
  return `${treeId}-${itemId}`
}

export function searchResultFileContainsId(file: SearchResultFileBlock, id: SearchResultId | null) {
  if (!id) return false
  if (file.id === id) return true

  return file.excerpts.some((excerpt) => excerpt.id === id)
}

export function matchNoun(count: number) {
  return count === 1 ? 'match' : 'matches'
}

export function fileName(path: string) {
  return path.split('/').at(-1) || path
}

export function fileIconStyle(icon: ResolvedFileIcon): CSSProperties {
  const mask = `url(${icon.src}) center / contain no-repeat`

  return {
    backgroundColor: colorForFileIcon(icon),
    mask,
    WebkitMask: mask,
  }
}

function decimalDigitCount(value: number) {
  return String(Math.max(1, Math.floor(value))).length
}

export function searchResultFileEditorStyle(document: SearchResultFileDocument): CSSProperties {
  return {
    height: searchResultFileEditorHeight(document.lines.length),
  }
}

export function searchResultFileEditorScrollMode(lineCount: number): EditorScrollMode {
  if (lineCount > SEARCH_RESULT_STATIC_EDITOR_LINE_LIMIT) return 'virtualized'

  return 'static'
}

export function searchResultFileEditorVisibleLineCount(lineCount: number) {
  return Math.max(0, Math.min(lineCount, SEARCH_RESULT_STATIC_EDITOR_LINE_LIMIT))
}

export function searchResultFileDocumentVisibleLines(document: SearchResultFileDocument) {
  return document.lines.slice(0, searchResultFileEditorVisibleLineCount(document.lines.length))
}

export type SearchResultFileEditorLineWindow = {
  readonly end: number
  readonly offsetY: number
  readonly start: number
}

export function equalSearchResultFileEditorLineWindow(
  current: SearchResultFileEditorLineWindow,
  next: SearchResultFileEditorLineWindow,
) {
  return (
    current.start === next.start && current.end === next.end && current.offsetY === next.offsetY
  )
}

export function searchResultFileEditorLineWindow({
  lineCount,
  virtualItem,
  viewport,
}: {
  lineCount: number
  virtualItem: SearchResultVirtualListMetrics['items'][number]
  viewport: SearchResultVirtualListViewport
}): SearchResultFileEditorLineWindow {
  const visibleLineCount = searchResultFileEditorVisibleLineCount(lineCount)
  if (visibleLineCount === 0) return { end: 0, offsetY: 0, start: 0 }
  if (visibleLineCount <= SEARCH_RESULT_FILE_EDITOR_FULL_RENDER_LINE_LIMIT) {
    return { end: visibleLineCount, offsetY: 0, start: 0 }
  }

  const rowStride = EXCERPT_EDITOR_LINE_HEIGHT + SEARCH_RESULT_FILE_EDITOR_ROW_GAP
  const contentTop =
    virtualItem.start + SEARCH_RESULT_VIRTUAL_ROW_OFFSET + FILE_RESULTS_ROW_VERTICAL_PADDING / 2
  const startY = viewport.top - contentTop - SEARCH_RESULT_FILE_EDITOR_LINE_OVERSCAN
  const endY = viewport.top + viewport.height - contentTop + SEARCH_RESULT_FILE_EDITOR_LINE_OVERSCAN
  const start = Math.max(0, Math.floor(startY / rowStride))
  const end = Math.min(visibleLineCount, Math.ceil(endY / rowStride))
  if (end <= start) return { end: 0, offsetY: 0, start: 0 }

  return {
    end,
    offsetY: start * rowStride,
    start,
  }
}

export function searchResultFileDocumentWindow(
  document: SearchResultFileDocument,
  window: SearchResultFileEditorLineWindow,
): SearchResultFileDocument {
  if (window.start === 0 && window.end === document.lines.length) return document

  return buildSearchResultFileDocumentWindow(document, window)
}

function buildSearchResultFileDocumentWindow(
  document: SearchResultFileDocument,
  window: SearchResultFileEditorLineWindow,
): SearchResultFileDocument {
  const lines: SearchResultFileDocumentLine[] = []
  let text = ''

  for (const sourceLine of document.lines.slice(window.start, window.end)) {
    const lineText = document.text.slice(sourceLine.start, sourceLine.end)
    const start = text ? text.length + 1 : 0
    const offset = start - sourceLine.start
    lines.push({
      ...sourceLine,
      end: start + lineText.length,
      matchRanges: sourceLine.matchRanges.map((range) => ({
        end: range.end + offset,
        start: range.start + offset,
      })),
      row: lines.length,
      start,
    })
    text = text ? `${text}\n${lineText}` : lineText
  }

  return {
    languageId: document.languageId,
    lines,
    path: document.path,
    text,
  }
}

export function searchResultSourceLineGutterStyle(
  lineCount: number,
  minDigits: number,
): CSSProperties {
  return {
    gap: SEARCH_RESULT_FILE_EDITOR_ROW_GAP,
    gridTemplateRows: `repeat(${lineCount}, ${EXCERPT_EDITOR_LINE_HEIGHT}px)`,
    height: searchResultFileEditorHeight(lineCount),
    minWidth: 26,
    width: `calc(${Math.max(3, minDigits)}ch + 8px)`,
  }
}

export function searchResultLineActionsStyle(lineCount: number): CSSProperties {
  return {
    gap: SEARCH_RESULT_FILE_EDITOR_ROW_GAP,
    gridTemplateRows: `repeat(${lineCount}, ${EXCERPT_EDITOR_LINE_HEIGHT}px)`,
    height: searchResultFileEditorHeight(lineCount),
  }
}

export function searchResultFileEditorRowHeight(file: SearchResultFileBlock) {
  return searchResultFileEditorHeight(file.excerpts.length) + FILE_RESULTS_ROW_VERTICAL_PADDING
}

export function searchResultFileEditorHeight(lineCount: number) {
  const visibleLineCount = searchResultFileEditorVisibleLineCount(lineCount)
  const rowGaps = Math.max(0, visibleLineCount - 1) * SEARCH_RESULT_FILE_EDITOR_ROW_GAP

  return Math.max(
    FILE_RESULTS_EDITOR_MIN_HEIGHT,
    visibleLineCount * EXCERPT_EDITOR_LINE_HEIGHT + rowGaps,
  )
}
