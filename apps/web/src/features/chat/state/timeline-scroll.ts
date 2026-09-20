import type { Dispatch } from 'react'
import type { VirtualListVirtualizer as TimelineVirtualizer } from '@workspace/ui/patterns/virtual-list'
import type { ChatTimelineItem } from '@/features/chat/utils/timeline-items'
import {
  shouldReleaseTimelineAnchorForActivity,
  timelineAnchoredTurnMetrics,
  timelinePrependedScrollTop,
  timelineRemeasureScrollDelta,
  TIMELINE_ANCHOR_OFFSET_PX,
  TIMELINE_COMPOSER_INSET_PX,
  TIMELINE_TOP_INSET_PX,
  type TimelineScrollEvent,
  type TimelineScrollState,
} from '@/features/chat/utils/timeline-scroll-anchoring'
import { readTimelineViewport } from '@/features/chat/state/timeline-navigation'

export function observeTimelineMeasurements(virtualizer: TimelineVirtualizer, suspended: boolean) {
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, delta, instance) =>
    timelineRemeasureScrollDelta({
      delta,
      rowStart: item.start,
      scrollTop: instance.scrollOffset ?? 0,
      suspended,
    }) !== 0
  return () => {
    virtualizer.shouldAdjustScrollPositionOnItemSizeChange = undefined
  }
}

// Browser anchoring is disabled; restore the reader after history is prepended.
export function absorbTimelinePrepend({
  dispatch,
  itemId,
  items,
  scrollElement,
  virtualizer,
}: {
  dispatch: Dispatch<TimelineScrollEvent>
  itemId: string
  items: readonly ChatTimelineItem[]
  scrollElement: HTMLDivElement
  virtualizer: TimelineVirtualizer
}) {
  const index = items.findIndex((item) => item.id === itemId)
  if (index < 0) {
    dispatch({ type: 'prepend-absorbed' })
    return
  }

  const scrollTop = timelinePrependedScrollTop({
    anchorRow: virtualizer.measurementsCache[index],
    scrollTop: readTimelineViewport(scrollElement).scrollTop,
    topInset: TIMELINE_TOP_INSET_PX,
  })
  dispatch({ type: 'prepend-absorbed' })
  if (scrollTop === null) return

  virtualizer.scrollToOffset(scrollTop, { behavior: 'auto' })
}

export function applyTimelineScroll({
  dispatch,
  disclosureSettling,
  items,
  scrollElement,
  scrollState,
  virtualizer,
}: {
  dispatch: Dispatch<TimelineScrollEvent>
  disclosureSettling: boolean
  items: readonly ChatTimelineItem[]
  scrollElement: HTMLDivElement
  scrollState: TimelineScrollState
  virtualizer: TimelineVirtualizer
}) {
  if (scrollState.pendingInitialScroll) {
    virtualizer.scrollToEnd({ behavior: 'auto' })
    dispatch({ type: 'initial-scroll-done' })
    return
  }
  if (disclosureSettling) return
  if (scrollState.followMode === 'anchoring-new-turn') {
    if (shouldReleaseTimelineAnchorForActivity(items)) {
      dispatch({ type: 'jump-to-end' })
      return
    }
    applyAnchoredTurnScroll({ dispatch, items, scrollElement, scrollState, virtualizer })
    return
  }
  if (scrollState.followMode !== 'following-end') return

  virtualizer.scrollToEnd({ behavior: 'auto' })
}

function applyAnchoredTurnScroll({
  dispatch,
  items,
  scrollElement,
  scrollState,
  virtualizer,
}: {
  dispatch: Dispatch<TimelineScrollEvent>
  items: readonly ChatTimelineItem[]
  scrollElement: HTMLDivElement
  scrollState: TimelineScrollState
  virtualizer: TimelineVirtualizer
}) {
  const anchorIndex = items.findIndex((item) => item.id === scrollState.anchorItemId)
  if (anchorIndex < 0) return

  const viewport = readTimelineViewport(scrollElement)
  const metrics = timelineAnchoredTurnMetrics({
    anchorOffset: TIMELINE_ANCHOR_OFFSET_PX,
    anchorRow: virtualizer.measurementsCache[anchorIndex],
    endInset: TIMELINE_COMPOSER_INSET_PX,
    lastRow: virtualizer.measurementsCache[items.length - 1],
    viewport,
  })
  if (!metrics) return
  // Reserve the space the park needs before moving, or the scroll clamps short.
  if (metrics.endSpace !== scrollState.anchoredEndSpace) {
    dispatch({ endSpace: metrics.endSpace, type: 'anchor-measured' })
    return
  }
  if (scrollState.parkedAnchorItemId !== scrollState.anchorItemId) {
    virtualizer.scrollToOffset(metrics.parkScrollTop, { behavior: 'auto' })
    dispatch({ type: 'anchor-parked' })
    return
  }
  // Sub-pixel deltas are measurement noise, not content the user is missing.
  if (metrics.scrollDeltaToRevealEnd <= 1) return

  virtualizer.scrollToOffset(viewport.scrollTop + metrics.scrollDeltaToRevealEnd, {
    behavior: 'auto',
  })
}
