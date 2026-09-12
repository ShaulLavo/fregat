import type { WorkspaceSearchMatch } from '@workspace/contracts'
import {
  searchResultTreeKeyDown,
  type SearchResultKeyEvent,
} from '@/features/search/utils/result-tree-keyboard'
import {
  firstSearchResultChildId,
  firstSearchResultId,
  lastSearchResultId,
  parentSearchResultId,
  searchResultIdByOffset,
  searchResultItemById,
  type SearchResultItem,
} from '@/features/search/utils/result-items'

export function handleSearchResultKeyDown({
  activeResultId,
  event,
  items,
  onOpenMatch,
  onSelectResult,
  onToggleGroup,
}: {
  activeResultId: string | null
  event: SearchResultKeyEvent
  items: readonly SearchResultItem[]
  onOpenMatch: (match: WorkspaceSearchMatch) => void
  onSelectResult: (id: string | null) => void
  onToggleGroup: (path: string) => void
}) {
  const active = searchResultItemById(items, activeResultId)
  const group = active?.type === 'group' ? active : null
  searchResultTreeKeyDown({
    event,
    onSelectResult,
    onToggleGroup,
    navigator: {
      group: group?.group ?? null,
      idByOffset: (offset) => searchResultIdByOffset({ activeResultId, items, offset }),
      firstId: () => firstSearchResultId(items),
      lastId: () => lastSearchResultId(items),
      childId: () => (group ? (firstSearchResultChildId(items, group.id) ?? group.id) : null),
      parentId: () => parentSearchResultId(items, activeResultId),
      canCollapse: true,
      commit: () => commitSearchResult(items, activeResultId, onOpenMatch, onToggleGroup),
    },
  })
}

function commitSearchResult(
  items: readonly SearchResultItem[],
  activeResultId: string | null,
  onOpenMatch: (match: WorkspaceSearchMatch) => void,
  onToggleGroup: (path: string) => void,
) {
  const active = searchResultItemById(items, activeResultId)
  if (!active) return
  if (active.type === 'group') {
    onToggleGroup(active.group.path)
    return
  }

  onOpenMatch(active.match)
}
