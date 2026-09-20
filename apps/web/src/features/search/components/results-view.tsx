import { useLayoutEffect, useRef, type KeyboardEvent } from 'react'
import type { WorkspaceSearchQuery } from '@workspace/contracts'
import { VirtualList, type VirtualListHandle } from '@workspace/ui/patterns/virtual-list'
import { useListbox } from '@workspace/ui/patterns/use-listbox'
import { WarningCircleIcon } from '@phosphor-icons/react'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { cn } from '@workspace/ui/lib/utils'
import { useSearchResultActions } from '@/features/search/hooks/use-result-actions'
import { useSearchPreviewMaxLength } from '@/features/search/hooks/use-preview-max-length'
import {
  searchResultItems,
  searchResultItemById,
  type SearchResultId,
} from '@/features/search/utils/result-items'
import type {
  SearchBufferStatus,
  WorkspaceSearchFileGroup,
} from '@/features/search/state/buffer-state'
import { SearchIdleState } from '@/features/search/components/idle-state'
import { SearchPendingOrEmpty } from '@/features/search/components/pending-or-empty'
import { SearchResultRow } from '@/features/search/components/result-row'

export function SearchResultsView({
  activeResultId,
  activeResultPicked,
  className,
  compact,
  groups,
  canReplace,
  error,
  query,
  replaceText,
  replaceVisible,
  resultsSearchQuery,
  status,
}: {
  activeResultId: SearchResultId | null
  activeResultPicked: boolean
  className?: string
  compact?: boolean
  groups: readonly WorkspaceSearchFileGroup[]
  canReplace?: boolean
  error: string | null
  query: string
  replaceText: string
  replaceVisible?: boolean
  resultsSearchQuery: WorkspaceSearchQuery | null
  status: SearchBufferStatus
}) {
  const parentRef = useRef<HTMLDivElement>(null)
  const virtualRef = useRef<VirtualListHandle>(null)
  const { openMatch, selectResult, toggleGroup } = useSearchResultActions()
  const previewMaxLength = useSearchPreviewMaxLength(parentRef, replaceVisible)
  const items = searchResultItems(groups)
  function toggle(id: string) {
    const item = searchResultItemById(items, id)
    if (item?.type === 'group') toggleGroup(item.group.path)
  }
  const list = useListbox({
    role: 'tree',
    containerRef: parentRef,
    items: items.map((item) => ({
      id: item.id,
      parentId: item.type === 'match' ? item.groupId : undefined,
      hasChildren: item.type === 'group',
      expanded: item.type === 'group' ? !item.group.collapsed : undefined,
    })),
    activeId: activeResultId,
    onActiveChange: selectResult,
    onCommit(id) {
      const item = searchResultItemById(items, id)
      if (!item) return
      if (item.type === 'group') {
        toggleGroup(item.group.path)
        return
      }
      openMatch(item.match)
    },
    onSelect: selectResult,
    onCollapse: toggle,
    onExpand: toggle,
    onActiveKeyDown(event) {
      if (event.key !== 'F2' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
        return
      const id = event.currentTarget.getAttribute('aria-activedescendant')
      const row = id ? document.getElementById(id) : null
      const action = row?.querySelector<HTMLButtonElement>(
        '[data-row-action="replace"]:not(:disabled)',
      )
      if (!action) return
      event.preventDefault()
      action.focus()
    },
    // The default cursor moves as results stream in; only a picked one may scroll the list.
    scrollToIndex(index) {
      if (activeResultPicked) virtualRef.current?.scrollToIndex(index, { align: 'auto' })
    },
  })
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && event.target !== event.currentTarget) {
      event.preventDefault()
      event.currentTarget.focus()
      return
    }
    list.containerProps.onKeyDown(event)
  }
  const displayedQuery = resultsSearchQuery?.query
  useLayoutEffect(() => {
    virtualRef.current?.scrollToOffset(0)
  }, [displayedQuery])
  if (status === 'idle') {
    return <SearchIdleState className={className} />
  }
  // No retry button: editing or resubmitting the query in the header re-runs the search.
  if (status === 'error' && groups.length === 0) {
    return (
      <EmptyState
        className={className}
        description={error ?? 'Search failed.'}
        icon={<WarningCircleIcon className='size-(--icon-size)' weight='duotone' />}
        title='Search failed'
        tone='error'
      />
    )
  }
  if (groups.length === 0) {
    return <SearchPendingOrEmpty className={className} status={status} />
  }

  return (
    <VirtualList
      {...list.containerProps}
      onKeyDown={handleKeyDown}
      activeIndex={activeResultPicked ? list.activeIndex : undefined}
      scrollRef={parentRef}
      handleRef={virtualRef}
      aria-label='Search results'
      className={cn(
        'focus-ring-inset app-scrollbar-thin h-full min-h-0 overflow-x-hidden',
        className,
      )}
      items={items}
      getKey={(item) => item.id}
      renderRow={(item) => (
        <SearchResultRow
          item={item}
          active={item.id === activeResultId}
          rowProps={{
            ...list.rowProps(item.id),
            'aria-level': item.level,
            'aria-expanded': item.type === 'group' ? !item.group.collapsed : undefined,
          }}
          canReplace={canReplace}
          compact={compact}
          previewMaxLength={previewMaxLength}
          query={query}
          replaceQuery={resultsSearchQuery}
          replaceText={replaceText}
          replaceVisible={replaceVisible}
        />
      )}
    />
  )
}
