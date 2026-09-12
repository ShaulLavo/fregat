import type { SearchResultId } from '@/features/search/utils/result-items'

export type SearchResultKeyEvent = Pick<
  KeyboardEvent,
  'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'preventDefault'
>

type TreeNavigator = {
  group: { collapsed: boolean; path: string } | null
  idByOffset: (offset: number) => SearchResultId | null
  firstId: () => SearchResultId | null
  lastId: () => SearchResultId | null
  childId: () => SearchResultId | null
  parentId: () => SearchResultId | null
  canCollapse: boolean
  commit: () => void
}

export function searchResultTreeKeyDown({
  event,
  navigator,
  onSelectResult,
  onToggleGroup,
}: {
  event: SearchResultKeyEvent
  navigator: TreeNavigator
  onSelectResult: (id: SearchResultId | null) => void
  onToggleGroup: (path: string) => void
}) {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault()
      onSelectResult(navigator.idByOffset(1))
      return
    case 'ArrowUp':
      event.preventDefault()
      onSelectResult(navigator.idByOffset(-1))
      return
    case 'Home':
      event.preventDefault()
      onSelectResult(navigator.firstId())
      return
    case 'End':
      event.preventDefault()
      onSelectResult(navigator.lastId())
      return
    case 'ArrowRight':
      event.preventDefault()
      moveIntoGroup(navigator, onSelectResult, onToggleGroup)
      return
    case 'ArrowLeft':
      event.preventDefault()
      moveOutOfGroup(navigator, onSelectResult, onToggleGroup)
      return
    case 'Enter':
      event.preventDefault()
      navigator.commit()
  }
}

function moveIntoGroup(
  navigator: TreeNavigator,
  onSelectResult: (id: SearchResultId | null) => void,
  onToggleGroup: (path: string) => void,
) {
  const { group } = navigator
  if (!group) return
  if (group.collapsed) {
    onToggleGroup(group.path)
    return
  }
  onSelectResult(navigator.childId())
}

function moveOutOfGroup(
  navigator: TreeNavigator,
  onSelectResult: (id: SearchResultId | null) => void,
  onToggleGroup: (path: string) => void,
) {
  const parentId = navigator.parentId()
  if (parentId) {
    onSelectResult(parentId)
    return
  }
  const { group } = navigator
  if (!group || group.collapsed || !navigator.canCollapse) return
  onToggleGroup(group.path)
}
