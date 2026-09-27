import { useEffect, type Dispatch } from 'react'
import type { VirtualListLayout } from '@workspace/ui/patterns/virtual-list'
import type { SessionId } from '@workspace/contracts'

import { useChatWorkLogExpansionStore } from '@/features/chat/state/chat-work-log-expansion-store'
import { useTimelineRevealStore } from '@/features/chat/state/timeline-reveal-store'
import { timelineRowPath, type ChatTimelineItem } from '@/features/chat/utils/timeline-items'
import type { TimelineScrollEvent } from '@/features/chat/utils/timeline-scroll-anchoring'

/** Frames a folded row may take to mount after its fold opens before the reveal gives up. */
const ROW_MOUNT_FRAMES = 30

/**
 * Scrolls this session's timeline to a requested row once the row is among its items. A row
 * inside a turn's fold opens the fold, scrolls to it, then brings the row itself into view.
 */
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
    const path = timelineRowPath(items, request.rowId)
    if (!path) return

    // Release follow first so the next render cannot pull the reader back to the end.
    dispatch({ type: 'user-navigated' })
    const expand = useChatWorkLogExpansionStore.getState().expandGroup
    for (const fold of path.folds) expand(fold)
    virtualizer.scrollToIndex(path.index, { align: 'start', behavior: 'auto' })
    useTimelineRevealStore.getState().settle(request.rowId)
  }, [dispatch, items, request, sessionId, virtualizer])

  const highlighted = useTimelineRevealStore((state) => state.highlighted)
  const scrollElement = virtualizer.scrollElement
  // A row inside an opened fold is not a virtual row of its own: it is scrolled to once it mounts.
  useEffect(() => {
    if (!highlighted || !scrollElement) return
    return scrollRowIntoView(scrollElement, highlighted)
  }, [highlighted, scrollElement])

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

function scrollRowIntoView(scrollElement: Element, rowId: string) {
  let frame = 0
  let handle = 0
  const attempt = () => {
    const row = scrollElement.querySelector(`[data-timeline-row-id="${CSS.escape(rowId)}"]`)
    if (row) {
      row.scrollIntoView({ block: 'start' })
      return
    }
    if (++frame < ROW_MOUNT_FRAMES) handle = requestAnimationFrame(attempt)
  }
  handle = requestAnimationFrame(attempt)
  return () => cancelAnimationFrame(handle)
}
