import type { Dispatch } from 'react'
import type { VirtualListVirtualizer as TimelineVirtualizer } from '@workspace/ui/patterns/virtual-list'
import type { ChatTimelineItem } from '@/features/chat/utils/timeline-items'
import {
  isTimelineAtContentEnd,
  shouldReleaseTimelineAnchorForActivity,
  timelineAnchoredTurnMetrics,
  TIMELINE_ANCHOR_OFFSET_PX,
  TIMELINE_COMPOSER_INSET_PX,
  type TimelineScrollEvent,
  type TimelineScrollState,
} from '@/features/chat/utils/timeline-scroll-anchoring'
import { readTimelineViewport } from '@/features/chat/state/timeline-navigation'

export type DisclosureSettle = { readonly disclosure: Element; readonly measured: boolean }

/**
 * No re-measure moves the offset: a toggled disclosure holds its row still until it settles, and
 * while following the viewport holds the end. A compensation written at the end is clamped by the
 * browser, and virtual-core replays a clamped write on a later resize, after the reader has left.
 */
export function holdTimelineMeasurements(virtualizer: TimelineVirtualizer, held: boolean) {
  if (!held) return
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = () => false
  return () => {
    virtualizer.shouldAdjustScrollPositionOnItemSizeChange = undefined
  }
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
    scrollTimelineToEnd(scrollElement)
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
  // Growth between renders is held by the viewport's resize observer; this lands a jump or a
  // release into following.
  if (isTimelineAtContentEnd(readTimelineViewport(scrollElement))) return

  scrollTimelineToEnd(scrollElement)
}

/**
 * One write to the element's real end. virtual-core's `scrollToEnd` keeps re-aiming at the end
 * every frame the content grows until one frame holds still, so a wheel-up in that window is
 * pulled back to the end.
 */
export function scrollTimelineToEnd(scrollElement: HTMLDivElement) {
  scrollElement.scrollTop = scrollElement.scrollHeight
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
