import { isContentSearchResultItem as isSearchResultMatchItem } from '@/features/search/utils/result-items'
import { clampIndex } from '@/features/search/utils/result-items'
import { queryRange as searchResultQueryRange } from '@/features/search/utils/match-display'
import { searchMatchPreviewRange as searchResultContentPreviewRange } from '@/features/search/utils/match-display'
import type { EditorSyntaxLanguageId } from '@singapore-editor/core'
import type { WorkspaceSearchMatch } from '@workspace/contracts'

import { languageIdForFilePath } from '@/features/editor/utils/file-path'
import type { WorkspaceSearchFileGroup } from '@/features/search/state/buffer-state'
import { searchMatchDisplay, type SearchMatchDisplay } from '@/features/search/utils/match-display'
import {
  expandedSearchResultItems,
  type SearchResultId,
  type SearchResultItemOptions,
  type SearchResultItem,
} from '@/features/search/utils/result-items'

const SEARCH_RESULT_EXCERPT_MAX_LENGTH = 160

export type SearchResultRange = {
  readonly end: number
  readonly start: number
}

export type SearchResultFileBlock = {
  readonly collapsed: boolean
  readonly excerpts: readonly SearchResultExcerpt[]
  readonly id: SearchResultId
  readonly languageId: EditorSyntaxLanguageId | null
  readonly matchCount: number
  readonly pending: boolean
  readonly path: string
  readonly pathLabel: string
}

type SearchResultExcerpt = {
  readonly id: SearchResultId
  readonly languageId: EditorSyntaxLanguageId | null
  readonly matchRanges: readonly SearchResultRange[]
  readonly pending: boolean
  readonly path: string
  readonly sourceMatch: WorkspaceSearchMatch
  readonly startLine: number
  readonly text: string
}

export type SearchResultVirtualRow =
  | {
      readonly file: SearchResultFileBlock
      readonly type: 'file'
    }
  | {
      readonly file: SearchResultFileBlock
      readonly type: 'file-results'
    }

export type SearchResultOpenTarget = {
  readonly match: WorkspaceSearchMatch | null
  readonly path: string
}

export type SearchResultFileDocumentLine = {
  readonly end: number
  readonly id: SearchResultId
  readonly matchRanges: readonly SearchResultRange[]
  readonly pending: boolean
  readonly row: number
  readonly sourceLine: number
  readonly sourceMatch: WorkspaceSearchMatch
  readonly start: number
}

export type SearchResultFileDocument = {
  readonly languageId: EditorSyntaxLanguageId | null
  readonly lines: readonly SearchResultFileDocumentLine[]
  readonly path: string
  readonly text: string
}

type SearchResultFileBlockCacheEntry = {
  readonly block: SearchResultFileBlock | null
  readonly pendingIdsKey: string
  readonly query: string
}

const searchResultFileBlockCache = new WeakMap<
  WorkspaceSearchFileGroup,
  SearchResultFileBlockCacheEntry
>()

export function searchResultFileBlocks(
  groups: readonly WorkspaceSearchFileGroup[],
  query: string,
  options: SearchResultItemOptions = {},
) {
  const blocks: SearchResultFileBlock[] = []
  const pendingIdsKey = searchResultPendingIdsCacheKey(options.pendingResultIds)
  for (const group of groups) {
    const block = cachedSearchResultFileBlock(group, query, options, pendingIdsKey)
    if (!block) continue
    blocks.push(block)
  }

  return blocks
}

export function searchResultVirtualRows(blocks: readonly SearchResultFileBlock[]) {
  const rows: SearchResultVirtualRow[] = []
  for (const block of blocks) {
    rows.push({ file: block, type: 'file' })
    if (block.collapsed) continue
    if (block.excerpts.length === 0) continue

    rows.push({ file: block, type: 'file-results' })
  }

  return rows
}

export function searchResultVirtualRowId(row: SearchResultVirtualRow) {
  if (row.type === 'file') return row.file.id

  return searchResultFileResultsRowId(row.file.id)
}

export function searchResultVirtualRowContainsId(
  row: SearchResultVirtualRow,
  id: SearchResultId | null,
) {
  if (!id) return false
  if (row.type === 'file') return row.file.id === id

  return row.file.excerpts.some((excerpt) => excerpt.id === id)
}

export function searchResultVirtualRowById(
  rows: readonly SearchResultVirtualRow[],
  id: SearchResultId | null,
) {
  if (!id) return null

  return rows.find((row) => searchResultVirtualRowContainsId(row, id)) ?? null
}

export function searchResultVirtualRowIdByOffset({
  activeResultId,
  offset,
  rows,
}: {
  activeResultId: SearchResultId | null
  offset: number
  rows: readonly SearchResultVirtualRow[]
}) {
  const ids = searchResultSelectableIds(rows)
  if (ids.length === 0) return null

  const activeIndex = ids.findIndex((id) => id === activeResultId)
  const fallback = offset >= 0 ? 0 : ids.length - 1
  if (activeIndex < 0) return ids[fallback] ?? null

  const nextIndex = clampIndex(activeIndex + offset, ids.length)
  return ids[nextIndex] ?? null
}

export function firstSearchResultVirtualRowId(rows: readonly SearchResultVirtualRow[]) {
  const ids = searchResultSelectableIds(rows)

  return ids[0] ?? null
}

export function lastSearchResultVirtualRowId(rows: readonly SearchResultVirtualRow[]) {
  const ids = searchResultSelectableIds(rows)

  return ids.at(-1) ?? null
}

export function firstSearchResultExcerptId(
  rows: readonly SearchResultVirtualRow[],
  fileId: SearchResultId,
) {
  const row = rows.find(
    (candidate) => candidate.type === 'file-results' && candidate.file.id === fileId,
  )
  if (row?.type !== 'file-results') return null

  return row.file.excerpts[0]?.id ?? null
}

export function parentSearchResultFileId(
  rows: readonly SearchResultVirtualRow[],
  activeResultId: SearchResultId | null,
) {
  const row = searchResultVirtualRowById(rows, activeResultId)
  if (row?.type !== 'file-results') return null

  return row.file.id
}

export function searchResultOpenTargetForId(
  blocks: readonly SearchResultFileBlock[],
  id: SearchResultId | null,
): SearchResultOpenTarget | null {
  if (!id) return null

  for (const block of blocks) {
    if (block.id === id) return { match: null, path: block.path }

    const excerpt = block.excerpts.find((candidate) => candidate.id === id)
    if (!excerpt) continue

    return { match: excerpt.sourceMatch, path: excerpt.path }
  }

  return null
}

export function searchResultExcerptById(
  blocks: readonly SearchResultFileBlock[],
  id: SearchResultId | null,
) {
  if (!id) return null

  for (const block of blocks) {
    const excerpt = block.excerpts.find((candidate) => candidate.id === id)
    if (excerpt) return excerpt
  }

  return null
}

export function searchResultFileDocument(file: SearchResultFileBlock): SearchResultFileDocument {
  const builder = createSearchResultFileDocumentBuilder(file)
  for (const excerpt of file.excerpts) builder.addExcerpt(excerpt)

  return builder.build()
}

export function searchResultFileDocumentLineAtRow(
  document: SearchResultFileDocument,
  row: number | undefined,
) {
  if (row === undefined) return null

  return document.lines[row] ?? null
}

export function searchResultFileDocumentLineById(
  document: SearchResultFileDocument,
  id: SearchResultId | null,
) {
  if (!id) return null

  return document.lines.find((line) => line.id === id) ?? null
}

function searchResultFileBlock(
  group: WorkspaceSearchFileGroup,
  query: string,
  options: SearchResultItemOptions,
): SearchResultFileBlock | null {
  const items = expandedSearchResultItems([group], options)
  const matchItems = items.filter(isSearchResultMatchItem)
  if (matchItems.length > 0) {
    return contentSearchResultFileBlock(group, items, matchItems, query)
  }

  const nameItem = items.find(isSearchResultNameItem)
  if (!nameItem) return null

  return nameSearchResultFileBlock(group, nameItem)
}

function cachedSearchResultFileBlock(
  group: WorkspaceSearchFileGroup,
  query: string,
  options: SearchResultItemOptions,
  pendingIdsKey: string,
): SearchResultFileBlock | null {
  const cached = searchResultFileBlockCache.get(group)
  if (cached?.query === query && cached.pendingIdsKey === pendingIdsKey) {
    return cached.block
  }

  const block = searchResultFileBlock(group, query, options)
  searchResultFileBlockCache.set(group, {
    block,
    pendingIdsKey,
    query,
  })
  return block
}

function searchResultPendingIdsCacheKey(
  pendingResultIds: SearchResultItemOptions['pendingResultIds'],
) {
  if (!pendingResultIds) return ''

  const ids = Array.isArray(pendingResultIds) ? pendingResultIds : Array.from(pendingResultIds)
  if (ids.length === 0) return ''

  return ids.toSorted().map(searchResultPendingIdCachePart).join('')
}

function searchResultPendingIdCachePart(id: SearchResultId) {
  return `${id.length}:${id};`
}

function contentSearchResultFileBlock(
  group: WorkspaceSearchFileGroup,
  items: readonly SearchResultItem[],
  matchItems: readonly SearchResultMatchItem[],
  query: string,
): SearchResultFileBlock | null {
  const groupItem = items.find(isSearchResultGroupItem)
  if (!groupItem) return null

  return {
    collapsed: group.collapsed,
    excerpts: matchItems.map((item) => searchResultExcerpt(item, query)),
    id: groupItem.id,
    languageId: languageIdForFilePath(groupItem.group.path),
    matchCount: matchItems.length,
    pending: groupItem.pending,
    path: groupItem.group.path,
    pathLabel: groupItem.group.pathLabel,
  }
}

function nameSearchResultFileBlock(
  group: WorkspaceSearchFileGroup,
  item: SearchResultNameItem,
): SearchResultFileBlock {
  return {
    collapsed: false,
    excerpts: [],
    id: item.id,
    languageId: languageIdForFilePath(group.path),
    matchCount: 1,
    pending: item.pending,
    path: group.path,
    pathLabel: group.pathLabel,
  }
}

function searchResultExcerpt(item: SearchResultMatchItem, query: string): SearchResultExcerpt {
  const display = searchResultExcerptDisplay(searchResultEditorDisplay(item.match, query))

  return {
    id: item.id,
    languageId: languageIdForFilePath(item.match.path),
    matchRanges: display.range ? [display.range] : [],
    pending: item.pending,
    path: item.match.path,
    sourceMatch: item.match,
    startLine: searchResultExcerptStartLine(item.match),
    text: searchResultExcerptText(display.text),
  }
}

function searchResultEditorDisplay(match: WorkspaceSearchMatch, query: string): SearchMatchDisplay {
  if (match.kind !== 'content') {
    return searchMatchDisplay(match, query, {
      maxLength: SEARCH_RESULT_EXCERPT_MAX_LENGTH,
    })
  }

  const text = searchResultExcerptText(match.preview || 'Matched line')
  const range = searchResultContentPreviewRange(match, text) ?? searchResultQueryRange(text, query)
  if (!range) return { text }

  return { range, text }
}

function searchResultExcerptDisplay(display: SearchMatchDisplay) {
  const text = searchResultExcerptText(display.text)
  const leadingIndentLength = searchResultLeadingIndentLength(text)
  if (leadingIndentLength === 0) return { range: display.range, text }

  const trimmedText = text.slice(leadingIndentLength)
  const range = searchResultTrimmedRange(display.range, leadingIndentLength)
  if (!range) return { text: trimmedText }

  return { range, text: trimmedText }
}

function searchResultExcerptText(text: string) {
  return text.replace(/(?:\r\n|\r|\n)$/u, '')
}

function searchResultLeadingIndentLength(text: string) {
  const match = /^[\t ]+/u.exec(text)

  return match?.[0].length ?? 0
}

function searchResultTrimmedRange(
  range: SearchResultRange | undefined,
  leadingIndentLength: number,
) {
  if (!range) return undefined
  if (range.end <= leadingIndentLength) return undefined

  return {
    end: range.end - leadingIndentLength,
    start: Math.max(0, range.start - leadingIndentLength),
  }
}

function searchResultExcerptStartLine(match: WorkspaceSearchMatch) {
  if (match.kind !== 'content') return 1
  if (match.line === undefined) return 1

  return match.line
}

type SearchResultGroupItem = Extract<SearchResultItem, { type: 'group' }>
type SearchResultMatchItem = Extract<SearchResultItem, { type: 'match' }>
type SearchResultNameItem = Extract<SearchResultItem, { type: 'name' }>

function isSearchResultGroupItem(item: SearchResultItem): item is SearchResultGroupItem {
  return item.type === 'group'
}

function isSearchResultNameItem(item: SearchResultItem): item is SearchResultNameItem {
  return item.type === 'name'
}

function searchResultSelectableIds(rows: readonly SearchResultVirtualRow[]) {
  const ids: SearchResultId[] = []
  for (const row of rows) {
    if (row.type === 'file') {
      ids.push(row.file.id)
      continue
    }

    for (const excerpt of row.file.excerpts) ids.push(excerpt.id)
  }

  return ids
}

function searchResultFileResultsRowId(fileId: SearchResultId) {
  return `${fileId}-results`
}

function createSearchResultFileDocumentBuilder(file: SearchResultFileBlock) {
  const lines: SearchResultFileDocumentLine[] = []
  let text = ''

  function addExcerpt(excerpt: SearchResultExcerpt) {
    const start = text ? text.length + 1 : 0
    const matchRanges = excerpt.matchRanges.map((range) => ({
      end: start + range.end,
      start: start + range.start,
    }))

    lines.push({
      end: start + excerpt.text.length,
      id: excerpt.id,
      matchRanges,
      pending: excerpt.pending,
      row: lines.length,
      sourceLine: excerpt.startLine,
      sourceMatch: excerpt.sourceMatch,
      start,
    })

    text = text ? `${text}\n${excerpt.text}` : excerpt.text
  }

  return {
    addExcerpt,
    build(): SearchResultFileDocument {
      return {
        languageId: file.languageId,
        lines,
        path: file.path,
        text,
      }
    },
  }
}
