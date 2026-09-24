import { memo, use, useCallback } from 'react'
import { SearchFileMenuContext } from '@/features/search/providers/file-menu-context'

import { useSearchResultActions } from '@/features/search/hooks/use-result-actions'
import {
  searchResultFileContainsId,
  searchResultVirtualRowExpanded,
  searchResultVirtualRowStyle,
} from '@/features/search/utils/result-editor'
import { searchResultDomId } from '@/features/search/utils/result-dom-id'
import { SearchResultFileHeader } from '@/features/search/components/result-file-header'
import type { SearchResultId } from '@/features/search/utils/result-items'
import {
  searchResultVirtualRowId,
  type SearchResultVirtualRow,
} from '@/features/search/utils/result-view-model'
import type { SearchResultVirtualListMetrics } from '@/features/search/utils/result-virtual-list'

type SearchResultFileHeaderRowProps = {
  readonly activeResultId: SearchResultId | null
  readonly canReplace?: boolean
  readonly replaceVisible: boolean
  readonly row: Extract<SearchResultVirtualRow, { type: 'file' }>
  readonly treeId: string
  readonly virtualItem: SearchResultVirtualListMetrics['items'][number]
}

export const SearchResultFileHeaderRow = memo(
  ({
    activeResultId,
    canReplace,
    replaceVisible,
    row,
    treeId,
    virtualItem,
  }: SearchResultFileHeaderRowProps) => {
    const { selectResult } = useSearchResultActions()
    const openFileMenu = use(SearchFileMenuContext)
    const id = searchResultVirtualRowId(row)
    const active = searchResultFileContainsId(row.file, activeResultId)
    // Manual keys: the compiler would key this on the whole row and its virtual item, so every
    // scroll frame would hand a virtualized row a new handler.
    const handleMouseDown = useCallback(() => selectResult(id), [id, selectResult])

    return (
      <div
        aria-expanded={searchResultVirtualRowExpanded(row)}
        aria-level={1}
        aria-selected={active}
        className='absolute right-2 left-2'
        data-index={virtualItem.index}
        id={searchResultDomId(treeId, id)}
        role='treeitem'
        style={searchResultVirtualRowStyle(virtualItem)}
        onMouseDown={handleMouseDown}
        onContextMenu={(event) => openFileMenu?.({ match: null, path: row.file.path }, event)}
      >
        <SearchResultFileHeader
          active={active}
          canReplace={canReplace}
          file={row.file}
          replaceVisible={replaceVisible}
        />
      </div>
    )
  },
)
