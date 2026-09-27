import type { SearchResultFileEditorLineWindow } from '@/features/search/utils/result-editor'
import type { SearchResultVirtualRow } from '@/features/search/utils/result-view-model'
import type {
  SearchResultVirtualListMetrics,
  SearchResultVirtualListViewport,
} from '@/features/search/utils/result-virtual-list'

export type SearchResultEditorVirtualizer = {
  readonly items: SearchResultVirtualListMetrics['items']
  readonly totalSize: number
  readonly viewport: SearchResultVirtualListViewport
  readonly scrollToIndex: SearchResultEditorScrollToIndex
  readonly scrollToOffset: (offset: number) => void
}

export type SearchResultRenderedVirtualItem = {
  readonly renderKey: string
  readonly row: SearchResultVirtualRow
  readonly virtualItem: SearchResultVirtualListMetrics['items'][number]
}

export type SearchResultRenderedFileResultItem = SearchResultRenderedVirtualItem & {
  readonly row: Extract<SearchResultVirtualRow, { type: 'file-results' }>
}

export type SearchResultFileEditorSlot = {
  readonly key: string
  readonly item: SearchResultRenderedFileResultItem
  readonly lineWindow: SearchResultFileEditorLineWindow
  readonly visible: boolean
}

export type SearchResultVirtualOverscanLevel = 0 | 1 | 2

export type SearchResultVirtualScrollSample = {
  readonly time: number
  readonly top: number
}

export type SearchResultEditorScrollToIndex = (
  index: number,
  target?: SearchResultVirtualRowScrollTarget | null,
) => void

export type SearchResultVirtualRowScrollTarget = {
  readonly offset: number
  readonly size: number
}
