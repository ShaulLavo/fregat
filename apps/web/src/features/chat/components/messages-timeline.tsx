/* eslint-disable oxc-react-compiler/refs -- The React Compiler bails on this whole component with "Use of incompatible library": @tanstack/react-virtual's instance methods (getVirtualItems/getTotalSize/measureElement) are consumed during render. The bail is structural — no useVirtualizer option clears it (directDomUpdates ruled out 2026-06-13: not a real option in the installed virtual-core 3.16.0, and forcing it into the source still bails per the babel react-compiler probe). So fixing the ref-in-render here buys no memoization.
   TODO: revisit memoizing this component. The only real fix is swapping to a React-Compiler-compatible virtualizer (e.g. react-hook-tanstack-virtual) to reach CompileSuccess, then dropping this disable. Low priority — a chat timeline re-rendering on message/scroll change is cheap, so there's no measured cost to buy back yet. */
import { useVirtualizer, type Virtualizer } from '@tanstack/react-virtual'
import { Button } from '@workspace/ui/components/button'
import { cn } from '@workspace/ui/lib/utils'
import { ArrowDownIcon } from '@phosphor-icons/react'
import { useEffect, useLayoutEffect, useMemo, useReducer, useState, type Dispatch } from 'react'

import { chatTimelineItemEstimate, chatTimelineItems } from '@/features/chat/utils/timeline-items'
import type { ChatTimelineItem } from '@/features/chat/utils/timeline-items'
import type { ChatSession } from '@workspace/client-core/chat/types'
import type { OptimisticChatMessage } from '../state/chat-optimistic-store'
import {
  initialTimelineScrollState,
  isTimelineAtContentEnd,
  resolveTimelineAnchorItemId,
  shouldReleaseTimelineAnchorForActivity,
  timelineAnchoredTurnMetrics,
  timelinePrependedScrollTop,
  timelineRemeasureScrollDelta,
  timelineScrollReducer,
  TIMELINE_ANCHOR_OFFSET_PX,
  TIMELINE_COMPOSER_INSET_PX,
  TIMELINE_TOP_INSET_PX,
  type TimelineScrollEvent,
  type TimelineScrollState,
  type TimelineViewportMetrics,
} from '../utils/timeline-scroll-anchoring'
import {
  shouldShowTimelineMinimap,
  timelineMinimapActiveMarkId,
  timelineMinimapMarks,
  timelineMinimapScrollTop,
  timelineMinimapViewportBand,
  type TimelineMinimapMark,
} from '../utils/timeline-minimap'
import { useSessionEarlierPage } from '../hooks/use-session-earlier-page'
import {
  attachTimelineNavigationListeners,
  readTimelineViewport,
} from '@/features/chat/state/timeline-navigation'
import { ChatWelcomeView } from './chat-welcome-view'
import { TimelineLoadEarlier } from './timeline-load-earlier'
import { TimelineMinimap } from './timeline-minimap'
import { TimelineRow } from './timeline-row'

const CHAT_TIMELINE_OVERSCAN = 6

type TimelineVirtualizer = Virtualizer<HTMLDivElement, Element>

export function MessagesTimeline({
  checkpointRevertPending = false,
  optimisticMessages,
  session,
}: {
  checkpointRevertPending?: boolean
  optimisticMessages: readonly OptimisticChatMessage[]
  session: ChatSession
}) {
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null)
  const [scrollState, dispatch] = useReducer(timelineScrollReducer, initialTimelineScrollState)
  // Bumped by a disclosure toggle; null once the two frames it takes to settle
  // have passed. Non-null suspends both end-follow and remeasure compensation so
  // the row the user just expanded stays put under their cursor.
  const [disclosureSettleTick, setDisclosureSettleTick] = useState<number | null>(null)
  // Stable identity is required: the items array feeds the virtualizer's option
  // closures and every scroll effect's dependency list.
  const items = useMemo(
    () =>
      chatTimelineItems({
        activities: session.activities,
        latestTurn: session.latestTurn,
        messages: session.messages,
        optimisticMessages,
        proposedPlans: session.proposedPlans,
        turnDiffSummaries: session.turnDiffSummaries,
      }),
    [
      optimisticMessages,
      session.activities,
      session.latestTurn,
      session.messages,
      session.proposedPlans,
      session.turnDiffSummaries,
    ],
  )
  // eslint-disable-next-line oxc-react-compiler/immutability -- the effect below installs `shouldAdjustScrollPositionOnItemSizeChange`, which virtual-core exposes as an instance property rather than a `useVirtualizer` option, so there is nowhere else to put it. The compiler already bails on this component (see the file header), so the freeze it is enforcing buys nothing here.
  const virtualizer = useVirtualizer({
    count: items.length,
    estimateSize: (index) => chatTimelineItemEstimate(items[index]),
    getItemKey: (index) => items[index]?.id ?? index,
    getScrollElement: () => scrollElement,
    overscan: CHAT_TIMELINE_OVERSCAN,
    // The insets live on the virtualizer rather than as CSS padding so scroll
    // offsets and row offsets share one coordinate space.
    paddingEnd: TIMELINE_COMPOSER_INSET_PX + scrollState.anchoredEndSpace,
    paddingStart: TIMELINE_TOP_INSET_PX,
  })
  const virtualItems = virtualizer.getVirtualItems()
  const contentHeight = virtualizer.getTotalSize()
  const viewportHeight = virtualizer.scrollRect?.height ?? 0
  const disclosureSettling = disclosureSettleTick !== null
  const earlierPage = useSessionEarlierPage(session.id)
  // Offered only to a reader who has walked back to the oldest row held. Pinned
  // to the live edge there is nothing to ask for, and an affordance floating
  // over the newest message while the agent types is pure noise.
  const canLoadEarlier =
    earlierPage.hasEarlier &&
    scrollState.followMode === 'free-scrolling' &&
    virtualItems[0]?.index === 0

  useLayoutEffect(() => {
    // eslint-disable-next-line oxc-react-compiler/immutability -- virtual-core exposes this hook as an instance property, not a `useVirtualizer` option, so there is nowhere else to install it. The compiler already bails on this component (see the file header), so the freeze it is enforcing buys nothing here.
    virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, delta, instance) =>
      timelineRemeasureScrollDelta({
        delta,
        rowStart: item.start,
        scrollTop: instance.scrollOffset ?? 0,
        suspended: disclosureSettling,
      }) !== 0

    return () => {
      virtualizer.shouldAdjustScrollPositionOnItemSizeChange = undefined
    }
  }, [disclosureSettling, virtualizer])

  useLayoutEffect(() => {
    dispatch({
      firstItemId: items[0]?.id ?? null,
      latestUserItemId: resolveTimelineAnchorItemId(items),
      sessionId: session.id,
      type: 'items-changed',
    })
  }, [items, session.id])

  // Ahead of every other scroll effect: a page that landed above the viewport
  // has already pushed the reader's row down, and anything that measures the
  // viewport before this runs measures the wrong place.
  useLayoutEffect(() => {
    if (!scrollElement) return
    if (!scrollState.prependedAboveItemId) return

    absorbTimelinePrepend({
      dispatch,
      itemId: scrollState.prependedAboveItemId,
      items,
      scrollElement,
      virtualizer,
    })
  }, [items, scrollElement, scrollState.prependedAboveItemId, virtualizer])

  useLayoutEffect(() => {
    if (!scrollElement) return
    if (items.length === 0) return

    applyTimelineScroll({
      dispatch,
      disclosureSettling,
      items,
      scrollElement,
      scrollState,
      virtualizer,
    })
  }, [
    contentHeight,
    disclosureSettling,
    items,
    scrollElement,
    scrollState,
    viewportHeight,
    virtualizer,
  ])

  useEffect(() => {
    if (!scrollElement) return

    return attachTimelineNavigationListeners({
      element: scrollElement,
      dispatch,
      suspendForDisclosure: () => setDisclosureSettleTick((current) => (current ?? 0) + 1),
    })
  }, [scrollElement])

  useEffect(() => {
    if (disclosureSettleTick === null) return

    let second: number | null = null
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        setDisclosureSettleTick(null)
        if (!scrollElement) return

        dispatch({
          atContentEnd: isTimelineAtContentEnd(readTimelineViewport(scrollElement)),
          type: 'scrolled',
        })
      })
    })

    return () => {
      cancelAnimationFrame(first)
      if (second !== null) cancelAnimationFrame(second)
    }
  }, [disclosureSettleTick, scrollElement])

  if (items.length === 0) {
    return <ChatWelcomeView />
  }

  function handleScroll() {
    if (!scrollElement) return

    dispatch({
      atContentEnd: isTimelineAtContentEnd(readTimelineViewport(scrollElement)),
      type: 'scrolled',
    })
  }

  function handleMinimapSelect(mark: TimelineMinimapMark) {
    if (!scrollElement) return

    const scrollTop = timelineMinimapScrollTop({
      mark,
      topInset: TIMELINE_ANCHOR_OFFSET_PX,
      viewport: readTimelineViewport(scrollElement),
    })
    // A jump is a navigation gesture like any other, so it breaks follow before
    // moving — otherwise the end-follow effect pulls the viewport straight back
    // on the commit that follows. It does not release the anchor or re-arm
    // anything itself: landing on the content end re-arms follow through the
    // same scroll rule every other gesture obeys.
    dispatch({ type: 'user-navigated' })
    virtualizer.scrollToOffset(scrollTop, { behavior: 'auto' })
  }

  // The virtualizer already re-renders this component on every scroll, so its
  // own tracked geometry is the cheapest honest read of the viewport: no DOM
  // measurement during render, and the same coordinate space as the rows.
  const minimapViewport: TimelineViewportMetrics = {
    contentHeight,
    scrollTop: virtualizer.scrollOffset ?? 0,
    viewportHeight,
  }
  const minimapMarks = timelineMinimapMarks({
    contentHeight: minimapViewport.contentHeight,
    items,
    rows: virtualizer.measurementsCache,
  })

  return (
    <div className='relative min-h-0 flex-1'>
      <div
        aria-label='Messages'
        className='app-scrollbar-thin focus-visible:ring-ring h-full overflow-x-hidden overflow-y-auto overscroll-y-contain px-3 outline-none [scrollbar-gutter:stable] focus-visible:ring-1 focus-visible:ring-inset sm:px-5'
        ref={setScrollElement}
        role='log'
        tabIndex={0}
        onScroll={handleScroll}
      >
        <div
          className='relative w-full'
          style={{
            height: contentHeight,
            // Scroll anchoring is ours: the browser's would fight the
            // compensation we apply when an estimated row is first measured.
            overflowAnchor: 'none',
          }}
        >
          {/* Rows stack in normal flow and only the window is translated. Giving
              each row its own absolute offset paints a broken frame on every
              width change: the reflow lands immediately but the offsets it
              invalidates are recomputed a frame later, so rows overlap by
              however much they grew. In flow they push each other instead, and
              a stale window offset is a uniform shift rather than a pile-up. */}
          <div
            className='absolute top-0 left-0 w-full'
            style={{ transform: `translateY(${virtualItems[0]?.start ?? 0}px)` }}
          >
            {virtualItems.map((virtualItem) => (
              <div
                className='w-full'
                data-index={virtualItem.index}
                key={virtualItem.key}
                ref={virtualizer.measureElement}
              >
                <TimelineRow
                  checkpointRevertPending={checkpointRevertPending}
                  item={items[virtualItem.index]!}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
      {shouldShowTimelineMinimap({
        markCount: minimapMarks.length,
        viewport: minimapViewport,
      }) ? (
        <TimelineMinimap
          activeMarkId={timelineMinimapActiveMarkId({
            marks: minimapMarks,
            viewport: minimapViewport,
          })}
          band={timelineMinimapViewportBand(minimapViewport)}
          marks={minimapMarks}
          onSelect={handleMinimapSelect}
        />
      ) : null}
      {canLoadEarlier ? (
        <TimelineLoadEarlier
          error={earlierPage.error}
          pending={earlierPage.pending}
          onLoad={earlierPage.loadEarlier}
        />
      ) : null}
      <Button
        aria-label='Scroll to latest message'
        className={cn(
          'border-border/70 bg-popover-solid absolute right-4 bottom-4 size-8 rounded-full shadow-sm transition-opacity hover:bg-muted compact:right-3 compact:bottom-3 compact:size-7',
          scrollState.followMode !== 'free-scrolling' && 'pointer-events-none opacity-0',
        )}
        size='icon-sm'
        tabIndex={scrollState.followMode === 'free-scrolling' ? 0 : -1}
        title='Scroll to latest message'
        type='button'
        variant='outline'
        onClick={() => dispatch({ type: 'jump-to-end' })}
      >
        <ArrowDownIcon aria-hidden='true' className='size-3.5' />
      </Button>
    </div>
  )
}

/**
 * Puts the reader back where they were after a page landed in front of the
 * transcript. Absorbed in one move rather than left to the browser: our own
 * `overflowAnchor: none` is what rules the browser's out.
 */
function absorbTimelinePrepend({
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

function applyTimelineScroll({
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
