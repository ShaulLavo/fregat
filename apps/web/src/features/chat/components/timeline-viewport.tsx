import { LoadingState } from '@workspace/ui/components/loading-state'
import { useChatTransport } from '@/features/chat/hooks/use-chat-transport'
import {
  captureTimelineReload,
  flushTimelineReload,
  readTimelineReload,
} from '@/features/chat/state/timeline-reload'
import { addLifecycleFlush } from '@/lib/lifecycle-flush'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { Button } from '@workspace/ui/components/button'
import { cn } from '@workspace/ui/lib/utils'
import { ArrowDownIcon } from '@phosphor-icons/react'
import { useEffect, useLayoutEffect, useState, type Dispatch } from 'react'
import type { VirtualListLayout } from '@workspace/ui/patterns/virtual-list'
import type { ChatSession } from '@workspace/client-core/chat/types'
import type { ChatTimelineItem } from '@/features/chat/utils/timeline-items'
import {
  isTimelineAtContentEnd,
  resolveTimelineAnchorItemId,
  TIMELINE_ANCHOR_OFFSET_PX,
  type TimelineScrollEvent,
  type TimelineScrollState,
  type TimelineViewportMetrics,
} from '@/features/chat/utils/timeline-scroll-anchoring'
import {
  shouldShowTimelineMinimap,
  timelineMinimapActiveMarkId,
  timelineMinimapMarks,
  timelineMinimapScrollTop,
  timelineMinimapViewportBand,
  type TimelineMinimapMark,
} from '@/features/chat/utils/timeline-minimap'
import { useSessionEarlierPage } from '@/features/chat/hooks/use-session-earlier-page'
import {
  attachTimelineNavigationListeners,
  readTimelineViewport,
} from '@/features/chat/state/timeline-navigation'
import {
  absorbTimelinePrepend,
  applyTimelineScroll,
  observeTimelineMeasurements,
} from '@/features/chat/state/timeline-scroll'
import { ChatWelcomeView } from '@/features/chat/components/chat-welcome-view'
import { TimelineLoadEarlier } from '@/features/chat/components/timeline-load-earlier'
import { TimelineMinimap } from '@/features/chat/components/timeline-minimap'
import { AgentsPanel } from '@/features/chat/components/agents-panel'

export function TimelineViewport({
  content,
  virtualizer,
  scrollRef,
  items,
  session,
  scrollState,
  dispatch,
}: VirtualListLayout & {
  items: readonly ChatTimelineItem[]
  session: ChatSession
  scrollState: TimelineScrollState
  dispatch: Dispatch<TimelineScrollEvent>
}) {
  'use no memo' // Minimap and follow state read the virtualizer's mutable geometry.
  const { environmentId } = useChatTransport()
  const scrollElement = virtualizer.scrollElement
  // A disclosure keeps its row still until the row's new size has been measured.
  const [disclosureSettle, setDisclosureSettle] = useState<{
    disclosure: Element
    measured: boolean
  } | null>(null)
  const unmeasuredDisclosure = disclosureSettle?.measured
    ? null
    : (disclosureSettle?.disclosure ?? null)
  const virtualItems = virtualizer.getVirtualItems()
  const contentHeight = virtualizer.getTotalSize()
  const viewportHeight = virtualizer.scrollRect?.height ?? 0
  const disclosureSettling = disclosureSettle !== null
  const earlierPage = useSessionEarlierPage(session.id)
  // Earlier history is offered only after the reader reaches the oldest loaded row.
  const canLoadEarlier =
    earlierPage.hasEarlier &&
    scrollState.followMode === 'free-scrolling' &&
    virtualItems[0]?.index === 0

  useLayoutEffect(
    () => observeTimelineMeasurements(virtualizer, disclosureSettling),
    [disclosureSettling, virtualizer],
  )

  useLayoutEffect(() => {
    dispatch({
      firstItemId: items[0]?.id ?? null,
      latestUserItemId: resolveTimelineAnchorItemId(items),
      sessionId: session.id,
      type: 'items-changed',
      preserveReadingPosition:
        readTimelineReload(environmentId)?.sessionId === session.id &&
        !items.some(
          (item) =>
            item.type === 'message' && 'optimistic' in item.message && item.message.role === 'user',
        ),
    })
  }, [dispatch, environmentId, items, session.id])

  // Restore a prepended page's anchor before other effects measure the viewport.
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
  }, [dispatch, items, scrollElement, scrollState.prependedAboveItemId, virtualizer])

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
    dispatch,
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
      suspendForDisclosure: (disclosure) => setDisclosureSettle({ disclosure, measured: false }),
    })
  }, [dispatch, scrollElement])

  useEffect(() => {
    if (!unmeasuredDisclosure || !scrollElement) return

    // Observers report in creation order, so this first report of the row lands
    // after the virtualizer's own observer has measured the toggle.
    const observer = new ResizeObserver(() => {
      observer.disconnect()
      setDisclosureSettle({ disclosure: unmeasuredDisclosure, measured: true })
    })
    observer.observe(unmeasuredDisclosure.closest('[data-index]') ?? scrollElement)
    return () => observer.disconnect()
  }, [scrollElement, unmeasuredDisclosure])

  // Read in the commit that carries the measured size: the virtualizer re-renders
  // after its observer returns, so the observer itself still sees the old height.
  useLayoutEffect(() => {
    if (!disclosureSettle?.measured || !scrollElement) return

    // Measure-then-update is what a layout effect is for; nothing paints in between.
    // oxlint-disable-next-line oxc-react-compiler/set-state-in-effect
    setDisclosureSettle(null)
    dispatch({
      atContentEnd: isTimelineAtContentEnd(readTimelineViewport(scrollElement)),
      type: 'scrolled',
    })
  }, [disclosureSettle, dispatch, scrollElement])

  useEffect(() => {
    const capture = () =>
      captureTimelineReload(
        environmentId,
        session,
        items,
        virtualizer,
        scrollState.followMode === 'following-end',
      )
    const flush = () => {
      capture()
      flushTimelineReload(environmentId)
    }
    capture()
    const remove = addLifecycleFlush(flush)
    scrollElement?.addEventListener('scroll', capture, { passive: true })
    return () => {
      flushTimelineReload(environmentId)
      remove()
      scrollElement?.removeEventListener('scroll', capture)
    }
  }, [environmentId, items, session, scrollElement, scrollState.followMode, virtualizer])

  if (items.length === 0) {
    return session.detailSynced ? (
      <ChatWelcomeView />
    ) : (
      <LoadingState label='Loading conversation'>
        <div aria-hidden='true' className='skeleton-sweep h-16 w-full rounded-md' />
        <div aria-hidden='true' className='skeleton-sweep h-16 w-3/4 rounded-md' />
      </LoadingState>
    )
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
    // Release follow before jumping so the next render cannot pull the reader back.
    dispatch({ type: 'user-navigated' })
    virtualizer.scrollToOffset(scrollTop, { behavior: 'auto' })
  }

  // The minimap shares the virtualizer's coordinates and scroll updates.
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
      <AgentsPanel activities={session.activities} />
      <div
        aria-label='Messages'
        className='focus-ring-inset scroll-fade scroll-gutter data-pinned:scroll-pinned h-full overflow-x-hidden overflow-y-auto overscroll-y-contain px-3 outline-none sm:px-5'
        data-pinned={scrollState.followMode === 'following-end' ? '' : undefined}
        ref={scrollRef}
        role='log'
        tabIndex={0}
        onScroll={handleScroll}
      >
        {content}
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
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label='Scroll to latest message'
              className={cn(
                'bg-popover-solid absolute right-(--density-section-padding) bottom-(--density-section-padding) rounded-full shadow-md transition-opacity',
                scrollState.followMode !== 'free-scrolling' && 'pointer-events-none opacity-0',
              )}
              size='icon'
              tabIndex={scrollState.followMode === 'free-scrolling' ? 0 : -1}
              type='button'
              variant='outline'
              onClick={() => dispatch({ type: 'jump-to-end' })}
            >
              <ArrowDownIcon aria-hidden='true' className='size-(--icon-size-sm)' />
            </Button>
          }
        />{' '}
        <TooltipContent>{'Scroll to latest message'}</TooltipContent>
      </Tooltip>
    </div>
  )
}
