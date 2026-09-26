import type { Dispatch } from 'react'
import type { VirtualListVirtualizer as TimelineVirtualizer } from '@workspace/ui/patterns/virtual-list'
import type { ChatTimelineItem } from '@/features/chat/utils/timeline-items'
import {
  shouldReleaseTimelineAnchorForActivity,
  timelineAnchoredTurnMetrics,
  TIMELINE_ANCHOR_OFFSET_PX,
  TIMELINE_COMPOSER_INSET_PX,
  TIMELINE_RELEASED_THRESHOLD_PX,
  type TimelineScrollEvent,
  type TimelineScrollState,
} from '@/features/chat/utils/timeline-scroll-anchoring'
import { readTimelineViewport } from '@/features/chat/state/timeline-navigation'

/**
 * Releases end pinning the moment a gesture leaves the end. The render that follows sets the same
 * threshold; a row resize landing before it would pin the list and swallow the gesture.
 */
export function releaseTimelineEnd(virtualizer: TimelineVirtualizer) {
  virtualizer.options.scrollEndThreshold = TIMELINE_RELEASED_THRESHOLD_PX
}

export type DisclosureSettle = { readonly disclosure: Element; readonly measured: boolean }

/** A toggled disclosure holds its row still: no re-measure moves the offset until it settles. */
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
  // Growth and appends at the end are the virtualizer's (end anchoring); this catches the rest:
  // a jump or release into following, a shorter viewport, a replaced last row.
  if (virtualizer.isAtEnd()) return

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
