import { useReducer } from 'react'
import { VirtualList } from '@workspace/ui/patterns/virtual-list'
import type { ChatSession } from '@workspace/client-core/chat/types'

import { chatTimelineItemEstimate, chatTimelineItems } from '@/features/chat/utils/timeline-items'
import type { OptimisticChatMessage } from '@/features/chat/state/chat-message-intents'
import {
  initialTimelineScrollState,
  timelineScrollReducer,
  TIMELINE_COMPOSER_INSET_PX,
  TIMELINE_TOP_INSET_PX,
} from '@/features/chat/utils/timeline-scroll-anchoring'
import { TimelineRow } from '@/features/chat/components/timeline-row'
import { TimelineViewport } from '@/features/chat/components/timeline-viewport'

export function MessagesTimeline({
  checkpointRevertPending = false,
  optimisticMessages,
  session,
}: {
  checkpointRevertPending?: boolean
  optimisticMessages: readonly OptimisticChatMessage[]
  session: ChatSession
}) {
  const [scrollState, dispatch] = useReducer(timelineScrollReducer, initialTimelineScrollState)
  // Stable identity is required: the items array feeds the virtualizer's option
  // closures and every scroll effect's dependency list.
  const items = chatTimelineItems({
    activities: session.activities,
    latestTurn: session.latestTurn,
    messages: session.messages,
    optimisticMessages,
    proposedPlans: session.proposedPlans,
    turnDiffSummaries: session.turnDiffSummaries,
  })

  return (
    <VirtualList
      items={items}
      getKey={(item) => item.id}
      estimateSize={(item) => chatTimelineItemEstimate(item)}
      layout='flow'
      measureItems
      paddingStart={TIMELINE_TOP_INSET_PX}
      paddingEnd={TIMELINE_COMPOSER_INSET_PX + scrollState.anchoredEndSpace}
      contentClassName='[overflow-anchor:none]'
      renderRow={(item) => (
        <TimelineRow checkpointRevertPending={checkpointRevertPending} item={item} />
      )}
      renderLayout={(layout) => (
        <TimelineViewport
          {...layout}
          items={items}
          session={session}
          scrollState={scrollState}
          dispatch={dispatch}
        />
      )}
    />
  )
}
