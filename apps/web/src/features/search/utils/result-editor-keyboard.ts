import {
  searchResultTreeKeyDown,
  type SearchResultKeyEvent,
} from '@/features/search/utils/result-tree-keyboard'
import type { SearchResultId } from '@/features/search/utils/result-items'
import {
  firstSearchResultExcerptId,
  firstSearchResultVirtualRowId,
  lastSearchResultVirtualRowId,
  parentSearchResultFileId,
  searchResultOpenTargetForId,
  searchResultVirtualRowById,
  searchResultVirtualRowIdByOffset,
  type SearchResultFileBlock,
  type SearchResultOpenTarget,
  type SearchResultVirtualRow,
} from '@/features/search/utils/result-view-model'

export function handleSearchResultSurfaceKeyDown({
  activeResultId,
  blocks,
  event,
  onOpenTarget,
  onSelectResult,
  onToggleGroup,
  rows,
}: {
  activeResultId: SearchResultId | null
  blocks: readonly SearchResultFileBlock[]
  event: SearchResultKeyEvent
  onOpenTarget: (target: SearchResultOpenTarget) => void
  onSelectResult: (id: SearchResultId | null) => void
  onToggleGroup: (path: string) => void
  rows: readonly SearchResultVirtualRow[]
}) {
  const active = searchResultVirtualRowById(rows, activeResultId)
  const group = active?.type === 'file' ? active.file : null
  searchResultTreeKeyDown({
    event,
    onSelectResult,
    onToggleGroup,
    navigator: {
      group,
      idByOffset: (offset) => searchResultVirtualRowIdByOffset({ activeResultId, offset, rows }),
      firstId: () => firstSearchResultVirtualRowId(rows),
      lastId: () => lastSearchResultVirtualRowId(rows),
      childId: () => (group ? (firstSearchResultExcerptId(rows, group.id) ?? group.id) : null),
      parentId: () => parentSearchResultFileId(rows, activeResultId),
      canCollapse: group !== null && group.excerpts.length > 0,
      commit: () => {
        const target = searchResultOpenTargetForId(blocks, activeResultId)
        if (target) onOpenTarget(target)
      },
    },
  })
}
