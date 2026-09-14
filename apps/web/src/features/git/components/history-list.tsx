import { useVirtualizer } from '@tanstack/react-virtual'
import type { GitHistoryRef } from '@workspace/contracts'
import { useEffect, useRef, type KeyboardEvent } from 'react'
import { HistoryRow } from '@/features/git/components/history-row'
import type { HistoryRow as GraphRow } from '@/features/git/utils/history-layout'
import { useWorkbenchDensity } from '@/features/settings/hooks/use-workbench-density'

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
  const density = useWorkbenchDensity()
  const rowHeight = density === 'compact' ? 20 : 24
  // TanStack Virtual keeps only visible commit rows mounted.
  const virtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: () => rowHeight,
    getItemKey: (index) => rows[index]?.commit.id ?? index,
    getScrollElement: () => scrollRef.current,
    overscan: 12,
    initialOffset: scrollTop,
  })
  const selectedIndex = rows.findIndex((row) => row.commit.id === selected)
  const laneCount = rows.reduce((width, row) => Math.max(width, row.width), 1)
  const graphWidth = laneCount * 14 + 10
  const items = virtualizer.getVirtualItems()
  const selectedVisible = items.some((item) => item.index === selectedIndex)

  useEffect(() => {
    virtualizer.measure()
  }, [virtualizer, rowHeight])

  useEffect(() => {
    if (revealRevision > 0 && selectedIndex >= 0)
      virtualizer.scrollToIndex(selectedIndex, { align: 'auto' })
  }, [selectedIndex, virtualizer, revealRevision])

  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    let index = selectedIndex
    if (event.key === 'ArrowDown') index = Math.min(rows.length - 1, index + 1)
    else if (event.key === 'ArrowUp') index = Math.max(0, index - 1)
    else if (event.key === 'Home') index = 0
    else if (event.key === 'End') index = rows.length - 1
    else return
    event.preventDefault()
    const row = rows[index]
    if (row) onSelect(row.commit.id)
  }

  return (
    <div
      ref={scrollRef}
      role='listbox'
      aria-label='Commit history'
      tabIndex={0}
      aria-activedescendant={
        selectedVisible ? `history-${expanded ? 'wide' : 'panel'}-${selected}` : undefined
      }
      className='app-scrollbar-thin focus-ring-inset min-h-0 flex-1 overflow-auto outline-none'
      onKeyDown={navigate}
      onScrollEnd={(event) => onScrollEnd(event.currentTarget.scrollTop)}
    >
      <div
        className='relative w-full'
        style={{
          height: virtualizer.getTotalSize(),
          minWidth: graphWidth + (expanded ? 520 : 200),
        }}
      >
        {items.map((item) => {
          const row = rows[item.index]
          if (!row) return null
          return (
            <div
              key={item.key}
              data-index={item.index}
              className='absolute top-0 left-0 w-full'
              style={{ transform: `translateY(${item.start}px)` }}
            >
              <HistoryRow
                id={`history-${expanded ? 'wide' : 'panel'}-${row.commit.id}`}
                row={row}
                refs={refs.get(row.commit.id) ?? []}
                graphWidth={graphWidth}
                selected={selected === row.commit.id}
                expanded={expanded}
                onSelect={onSelect}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
