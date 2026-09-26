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
import type { TailEdge } from '@workspace/ui/patterns/tail-follow'
import { TailJumpButton } from '@workspace/ui/patterns/tail-jump-button'
import { useRowHeight } from '@workspace/ui/patterns/use-row-height'
import { useTailFollow } from '@workspace/ui/patterns/use-tail-follow'

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
  /** The list's offset inside a scroller it shares with content above it. */
  scrollMargin?: number
  /** Space a sticky header covers, so a revealed row lands below it. */
  scrollPaddingStart?: number
  scrollRef?: RefObject<HTMLDivElement | null>
  handleRef?: Ref<VirtualListHandle>
  contentClassName?: string
  /** Fades the edge content lies past. Off for a list that draws its own edge. */
  fade?: boolean
  /** Follows the live edge and offers a way back with the count of rows that arrived meanwhile. */
  follow?: {
    readonly edge: TailEdge
    readonly noun: string
    readonly count?: (value: number) => ReactNode
  }
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
  scrollMargin = 0,
  scrollPaddingStart = 0,
  scrollRef,
  handleRef,
  className,
  contentClassName,
  fade = true,
  follow,
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
    scrollMargin,
    scrollPaddingStart,
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
  const tail = useTailFollow({
    edge: follow?.edge ?? 'end',
    enabled: follow !== undefined,
    keys: follow ? items.map(getKey) : [],
    scrollRef: ref,
    scrollToEdge: () => {
      if (items.length === 0) return
      if (follow?.edge === 'start') virtualizer.scrollToOffset(0)
      else virtualizer.scrollToIndex(items.length - 1, { align: 'end' })
    },
    slack: rowHeight,
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
              paddingTop: (rows[0]?.start ?? scrollMargin) - scrollMargin,
              paddingBottom:
                virtualizer.getTotalSize() - ((rows.at(-1)?.end ?? scrollMargin) - scrollMargin),
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
                ? { transform: `translateY(${row.start - scrollMargin}px)` }
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

  const scroller = (
    <div
      {...props}
      ref={ref}
      data-pinned={follow && tail.following ? '' : undefined}
      data-slot='virtual-list'
      className={cn(
        'relative min-h-0 overflow-auto data-pinned:scroll-pinned',
        // The follow hook corrects for prepended rows itself; browser anchoring would double it.
        follow && '[overflow-anchor:none]',
        fade && 'scroll-fade',
        className,
      )}
    >
      {content}
    </div>
  )
  if (!follow) return scroller

  return (
    <div className='relative flex min-h-0 flex-1 flex-col'>
      {scroller}
      {tail.following ? null : (
        <TailJumpButton
          arrivals={tail.arrivals}
          className={cn(
            'absolute left-1/2 -translate-x-1/2',
            follow.edge === 'start'
              ? 'top-(--density-section-padding)'
              : 'bottom-(--density-section-padding)',
          )}
          count={follow.count}
          edge={follow.edge}
          noun={follow.noun}
          onJump={tail.jumpToEdge}
        />
      )}
    </div>
  )
}
