import { listboxKeyAction } from '@workspace/ui/patterns/listbox-keys'
import type { SearchResultId } from '@/features/search/utils/result-items'
import {
  firstSearchResultExcerptId,
  searchResultSelectableIds,
  parentSearchResultFileId,
  searchResultOpenTargetForId,
  searchResultVirtualRowById,
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
  event: Pick<
    KeyboardEvent,
    'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'preventDefault'
  >
  onOpenTarget: (target: SearchResultOpenTarget) => void
  onSelectResult: (id: SearchResultId | null) => void
  onToggleGroup: (path: string) => void
  rows: readonly SearchResultVirtualRow[]
}) {
  const active = searchResultVirtualRowById(rows, activeResultId)
  const group = active?.type === 'file' ? active.file : null
  const ids = searchResultSelectableIds(rows)
  const action = listboxKeyAction({
    key: event.key,
    modifiers: {
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
    },
    role: 'tree',
    count: ids.length,
    activeIndex: ids.indexOf(activeResultId ?? ''),
    pageSize: 10,
    canCollapse: group !== null && group.excerpts.length > 0,
    isCollapsed: group?.collapsed,
  })
  if (action.kind === 'none') return
  event.preventDefault()
  if (action.kind === 'move') onSelectResult(ids[action.index] ?? null)
  if (action.kind === 'child' && group)
    onSelectResult(firstSearchResultExcerptId(rows, group.id) ?? group.id)
  if (action.kind === 'parent') {
    const parent = parentSearchResultFileId(rows, activeResultId)
    if (parent) onSelectResult(parent)
  }
  if ((action.kind === 'collapse' || action.kind === 'expand') && group) onToggleGroup(group.path)
  if (action.kind !== 'commit') return
  const target = searchResultOpenTargetForId(blocks, activeResultId)
  if (target) onOpenTarget(target)
}
