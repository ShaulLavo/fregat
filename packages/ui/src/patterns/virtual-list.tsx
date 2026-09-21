import { defaultRangeExtractor, useVirtualizer, type Virtualizer } from '@tanstack/react-virtual'
import {
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type ComponentProps,
  type Key,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react'

import { cn } from '@workspace/ui/lib/utils'
import { useRowHeight } from '@workspace/ui/patterns/use-row-height'

export type VirtualListHandle = Pick<
  Virtualizer<HTMLDivElement, HTMLDivElement>,
  'scrollToIndex' | 'scrollToOffset' | 'measure' | 'getTotalSize' | 'getVirtualItems'
>

export type VirtualListVirtualizer = Virtualizer<HTMLDivElement, HTMLDivElement>

export type VirtualListLayout = {
  virtualizer: VirtualListVirtualizer
  content: ReactNode
  scrollRef: RefObject<HTMLDivElement | null>
}

export type VirtualListProps<T> = Omit<ComponentProps<'div'>, 'children' | 'ref'> & {
  items: readonly T[]
  getKey: (item: T, index: number) => Key
  renderRow: (item: T, index: number) => ReactNode
  activeIndex?: number
  overscan?: number
  estimateSize?: (item: T, index: number, rowHeight: number) => number
  measureItems?: boolean
  layout?: 'absolute' | 'flow'
  initialRect?: { width: number; height: number }
  initialMeasurementsCache?: Virtualizer<HTMLDivElement, HTMLDivElement>['measurementsCache']
  initialOffset?: number
  paddingStart?: number
  paddingEnd?: number
  scrollRef?: RefObject<HTMLDivElement | null>
  handleRef?: Ref<VirtualListHandle>
  contentClassName?: string
  onItemsRendered?: (range: { startIndex: number; endIndex: number }) => void
  renderLayout?: (layout: VirtualListLayout) => ReactNode
}

export function VirtualList<T>({
  items,
  getKey,
  renderRow,
  activeIndex,
  overscan = 12,
  estimateSize,
  measureItems = false,
  layout = 'absolute',
  initialRect,
  initialMeasurementsCache,
  initialOffset,
  paddingStart = 0,
  paddingEnd = 0,
  scrollRef,
  handleRef,
  className,
  contentClassName,
  onItemsRendered,
  renderLayout,
  ...props
}: VirtualListProps<T>) {
  'use no memo' // TanStack's mutable virtualizer must be read on every render.
  const internalRef = useRef<HTMLDivElement>(null)
  const ref = scrollRef ?? internalRef
  const rowHeight = useRowHeight(ref)
  const densitySized = estimateSize === undefined && !measureItems
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: items.length,
    getScrollElement: () => ref.current,
    estimateSize: (index) => {
      const item = items[index]
      return item === undefined ? rowHeight : (estimateSize?.(item, index, rowHeight) ?? rowHeight)
    },
    getItemKey: (index) => {
      const item = items[index]
      return item === undefined ? index : getKey(item, index)
    },
    overscan,
    initialRect,
    initialMeasurementsCache,
    initialOffset,
    paddingStart,
    paddingEnd,
    rangeExtractor: (range) => {
      const indices = defaultRangeExtractor(range)
      if (
        activeIndex === undefined ||
        activeIndex < 0 ||
        activeIndex >= items.length ||
        indices.includes(activeIndex)
      )
        return indices
      return [...indices, activeIndex].sort((left, right) => left - right)
    },
  })
  const rows = virtualizer.getVirtualItems()
  const previousHeight = useRef(rowHeight)
  const previousActiveIndex = useRef(activeIndex)
  const startIndex = rows[0]?.index ?? -1
  const endIndex = rows.at(-1)?.index ?? -1

  useImperativeHandle(handleRef, () => virtualizer, [virtualizer])

  useLayoutEffect(() => {
    const priorHeight = previousHeight.current
    previousHeight.current = rowHeight
    if (measureItems || priorHeight === rowHeight) return
    const offset = virtualizer.scrollOffset ?? 0
    const anchor = virtualizer.getVirtualItemForOffset(offset)
    const fraction = anchor && anchor.size > 0 ? (offset - anchor.start) / anchor.size : 0
    const scaledOffset = (offset * rowHeight) / priorHeight
    virtualizer.measure()
    if (densitySized) {
      virtualizer.scrollToOffset(scaledOffset)
      return
    }
    if (!anchor) return
    const next = virtualizer.getOffsetForIndex(anchor.index, 'start')
    if (next) virtualizer.scrollToOffset(next[0] + fraction * rowHeight)
  }, [rowHeight, virtualizer, densitySized, measureItems])

  useLayoutEffect(() => {
    const changed = previousActiveIndex.current !== activeIndex
    previousActiveIndex.current = activeIndex
    if (activeIndex === undefined || activeIndex < 0) return
    if (!changed && initialOffset !== undefined) return
    virtualizer.scrollToIndex(activeIndex, { align: 'auto' })
  }, [activeIndex, initialOffset, virtualizer])

  useLayoutEffect(() => {
    onItemsRendered?.({ startIndex, endIndex })
  }, [startIndex, endIndex, onItemsRendered])

  const content = (
    <div
      className={cn('relative w-full', contentClassName)}
      style={
        layout === 'flow'
          ? {
              paddingTop: rows[0]?.start ?? 0,
              paddingBottom: virtualizer.getTotalSize() - (rows.at(-1)?.end ?? 0),
            }
          : { height: virtualizer.getTotalSize() }
      }
    >
      {rows.map((row, index) => {
        const item = items[row.index]
        if (item === undefined) return null
        return (
          <div
            key={row.key}
            data-index={row.index}
            ref={measureItems ? virtualizer.measureElement : undefined}
            className={cn('w-full', layout === 'absolute' && 'absolute top-0 left-0')}
            style={
              layout === 'absolute'
                ? { transform: `translateY(${row.start}px)` }
                : {
                    marginTop: row.start - (rows[index - 1]?.end ?? row.start),
                  }
            }
          >
            {renderRow(item, row.index)}
          </div>
        )
      })}
    </div>
  )

  // eslint-disable-next-line oxc-react-compiler/refs -- The layout forwards scrollRef to its DOM scroller without reading current.
  if (renderLayout) return renderLayout({ virtualizer, content, scrollRef: ref })

  return (
    <div
      {...props}
      ref={ref}
      data-slot='virtual-list'
      className={cn('relative min-h-0 overflow-auto', className)}
    >
      {content}
    </div>
  )
}
