import type { GitHistoryRef } from '@workspace/contracts'
import { useCallback, useEffect, useRef } from 'react'
import { VirtualList, type VirtualListHandle } from '@workspace/ui/patterns/virtual-list'
import { useListbox } from '@workspace/ui/patterns/use-listbox'
import { HistoryRow } from '@/features/git/components/history-row'
import type { HistoryRow as GraphRow } from '@/features/git/utils/history-layout'

export function HistoryList({
  rows,
  refs,
  selected,
  expanded,
  onSelect,
  revealRevision,
  scrollTop,
  onScrollEnd,
}: {
  rows: readonly GraphRow[]
  refs: ReadonlyMap<string, readonly GitHistoryRef[]>
  selected: string | null
  expanded: boolean
  onSelect: (id: string) => void
  revealRevision: number
  scrollTop: number
  onScrollEnd: (scrollTop: number) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualList = useRef<VirtualListHandle>(null)
  const selectedIndex = rows.findIndex((row) => row.commit.id === selected)
  const laneCount = rows.reduce((width, row) => Math.max(width, row.width), 1)
  const graphWidth = laneCount * 14 + 10
  // The cursor effect must not re-scroll merely because commit details rendered.
  const scrollToIndex = useCallback((index: number) => {
    virtualList.current?.scrollToIndex(index, { align: 'auto' })
  }, [])
  const listbox = useListbox({
    role: 'listbox',
    items: rows.map((row) => ({ id: row.commit.id, label: row.commit.subject })),
    activeId: selected,
    onActiveChange: onSelect,
    onCommit: onSelect,
    containerRef: scrollRef,
    scrollToIndex,
    revealOnMount: false,
  })

  useEffect(() => {
    if (revealRevision > 0 && selectedIndex >= 0) scrollToIndex(selectedIndex)
  }, [selectedIndex, revealRevision, scrollToIndex])

  return (
    <VirtualList
      {...listbox.containerProps}
      scrollRef={scrollRef}
      handleRef={virtualList}
      activeIndex={listbox.activeIndex}
      aria-label='Commit history'
      className='app-scrollbar-thin focus-ring-inset min-h-0 flex-1 overflow-auto outline-none'
      items={rows}
      getKey={(row) => row.commit.id}
      initialOffset={scrollTop}
      onScrollEnd={(event) => onScrollEnd(event.currentTarget.scrollTop)}
      renderRow={(row) => (
        <HistoryRow
          rowProps={listbox.rowProps(row.commit.id)}
          row={row}
          refs={refs.get(row.commit.id) ?? []}
          graphWidth={graphWidth}
          expanded={expanded}
        />
      )}
    />
  )
}
