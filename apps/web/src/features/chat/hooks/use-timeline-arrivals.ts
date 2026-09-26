import { useState } from 'react'
import { arrivedAtEdge } from '@workspace/ui/patterns/tail-follow'

import type { ChatTimelineItem } from '@/features/chat/utils/timeline-items'

/**
 * Messages that arrived while the reader was scrolled away from the latest one. A streaming
 * message keeps its id, so only a new message counts; returning to the end clears the count.
 */
export function useTimelineArrivals(items: readonly ChatTimelineItem[], away: boolean): number {
  const messageIds = items.filter((item) => item.type === 'message').map((item) => item.id)
  const lastId = messageIds.at(-1)
  const [seen, setSeen] = useState({ count: 0, lastId })
  if (seen.lastId !== lastId) {
    const added = away ? arrivedAtEdge(messageIds, seen.lastId, 'end') : 0
    setSeen({ count: away ? seen.count + added : 0, lastId })
  } else if (!away && seen.count !== 0) {
    setSeen({ count: 0, lastId })
  }
  return seen.count
}
