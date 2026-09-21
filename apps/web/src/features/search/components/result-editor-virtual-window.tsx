import type { EditorTheme } from '@singapore-editor/core/rendering'
import { memo, useLayoutEffect, useMemo, type RefObject } from 'react'

import { SEARCH_RESULT_VIRTUAL_PADDING } from '@/features/search/utils/result-editor-constants'
import type { SearchResultEditorScrollToIndex } from '@/features/search/utils/result-editor-types'
import {
  isSearchResultRenderedFileResultItem,
  searchResultRenderedVirtualItems,
} from '@/features/search/utils/result-editor'
import { SearchResultFileEditorPoolSlot } from '@/features/search/components/result-file-editor-pool-slot'
import { SearchResultFileHeaderRow } from '@/features/search/components/result-file-header-row'
import type { SearchResultId } from '@/features/search/utils/result-items'
import type { SearchResultVirtualRow } from '@/features/search/utils/result-view-model'
import type { SearchResultVirtualListViewport } from '@/features/search/utils/result-virtual-list'
import { useSearchResultEditorVirtualizer } from '@/features/search/hooks/use-result-editor-virtualizer'
import { useSearchResultFileEditorPoolEntries } from '@/features/search/hooks/use-result-file-editor-pool-entries'

type SearchResultEditorVirtualWindowProps = {
  readonly activeResultId: SearchResultId | null
  readonly canReplace?: boolean
  readonly editorTheme: EditorTheme
  readonly initialViewport: SearchResultVirtualListViewport

  readonly parentRef: RefObject<HTMLDivElement | null>
  readonly prewarmEditorPool: boolean
  readonly replaceVisible: boolean
  readonly rows: readonly SearchResultVirtualRow[]
  readonly scrollToIndexRef: RefObject<SearchResultEditorScrollToIndex>
  readonly scrollToOffsetRef: RefObject<(offset: number) => void>
  readonly treeId: string
}

export const SearchResultEditorVirtualWindow = memo(
  ({
    activeResultId,
    canReplace,
    editorTheme,
    initialViewport,

    parentRef,
    prewarmEditorPool,
    replaceVisible,
    rows,
    scrollToIndexRef,
    scrollToOffsetRef,
    treeId,
  }: SearchResultEditorVirtualWindowProps) => {
    const {
      items: virtualItems,
      scrollToIndex,
      scrollToOffset,
      totalSize: virtualTotalSize,
      viewport,
    } = useSearchResultEditorVirtualizer(rows, parentRef, 'raf', initialViewport)
    // Published from a layout effect, not during render: the surface above reads these from its
    // own layout effects, which React runs after every child's.
    useLayoutEffect(() => {
      scrollToIndexRef.current = scrollToIndex
      scrollToOffsetRef.current = scrollToOffset
    }, [scrollToIndex, scrollToIndexRef, scrollToOffset, scrollToOffsetRef])

    const renderedVirtualItems = useMemo(
      () => searchResultRenderedVirtualItems(virtualItems, rows),
      [rows, virtualItems],
    )
    // Manual memo: a hook keys on this value, and the compiler's cache is a cache, not an identity
    // guarantee — a recompute hands it a cold value every render.
    const fileResultItems = useMemo(
      () => renderedVirtualItems.filter(isSearchResultRenderedFileResultItem),
      [renderedVirtualItems],
    )
    const fileEditorPoolEntries = useSearchResultFileEditorPoolEntries(
      fileResultItems,
      prewarmEditorPool,
    )
    const windowStyle = { height: virtualTotalSize + SEARCH_RESULT_VIRTUAL_PADDING }

    return (
      <div className='relative' style={windowStyle}>
        {renderedVirtualItems.map(({ renderKey, row, virtualItem }) => {
          if (row.type !== 'file') return null

          return (
            <SearchResultFileHeaderRow
              activeResultId={activeResultId}
              canReplace={canReplace}
              key={renderKey}
              replaceVisible={replaceVisible}
              row={row}
              treeId={treeId}
              virtualItem={virtualItem}
            />
          )
        })}
        {fileEditorPoolEntries.map((entry) => (
          <SearchResultFileEditorPoolSlot
            activeResultId={activeResultId}
            canReplace={canReplace}
            editorTheme={editorTheme}
            entry={entry}
            key={`file-results-pool:${entry.key}`}
            replaceVisible={replaceVisible}
            treeId={treeId}
            viewport={viewport}
          />
        ))}
      </div>
    )
  },
)
