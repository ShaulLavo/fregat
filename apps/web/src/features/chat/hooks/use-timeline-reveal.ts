import { useEffect, type Dispatch } from 'react'
import type { VirtualListLayout } from '@workspace/ui/patterns/virtual-list'
import type { SessionId } from '@workspace/contracts'

import { useTimelineRevealStore } from '@/features/chat/state/timeline-reveal-store'
import type { ChatTimelineItem } from '@/features/chat/utils/timeline-items'
import type { TimelineScrollEvent } from '@/features/chat/utils/timeline-scroll-anchoring'

/** Scrolls this session's timeline to a requested row once the row is among its items. */
export function useTimelineReveal({
  dispatch,
  items,
  sessionId,
  virtualizer,
}: {
  dispatch: Dispatch<TimelineScrollEvent>
  items: readonly ChatTimelineItem[]
  sessionId: SessionId
  virtualizer: VirtualListLayout['virtualizer']
}) {
  const request = useTimelineRevealStore((state) => state.request)
  useEffect(() => {
    if (!request || request.sessionId !== sessionId) return
    const index = items.findIndex((item) => item.id === request.rowId)
    if (index < 0) return

    // Release follow first so the next render cannot pull the reader back to the end.
    dispatch({ type: 'user-navigated' })
    virtualizer.scrollToIndex(index, { align: 'start', behavior: 'auto' })
    useTimelineRevealStore.getState().settle(request.rowId)
  }, [dispatch, items, request, sessionId, virtualizer])

  const highlighted = useTimelineRevealStore((state) => state.highlighted !== null)
  const scrollElement = virtualizer.scrollElement
  // The mark stays until the reader moves on by hand.
  useEffect(() => {
    if (!highlighted || !scrollElement) return
    const release = () => useTimelineRevealStore.getState().release()
    scrollElement.addEventListener('wheel', release, { once: true, passive: true })
    scrollElement.addEventListener('pointerdown', release, { once: true })
    return () => {
      scrollElement.removeEventListener('wheel', release)
      scrollElement.removeEventListener('pointerdown', release)
    }
  }, [highlighted, scrollElement])
}
