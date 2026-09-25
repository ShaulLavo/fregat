import { useChatTransport } from '@/features/chat/hooks/use-chat-transport'
import { readTimelineReload, timelineInitialView } from '@/features/chat/state/timeline-reload'
import { useReducer, useState } from 'react'
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
import { useReasoningAutoFold } from '@/features/chat/hooks/use-reasoning-auto-fold'

export function MessagesTimeline({
  checkpointRevertPending = false,
  optimisticMessages,
  session,
}: {
  checkpointRevertPending?: boolean
  optimisticMessages: readonly OptimisticChatMessage[]
  session: ChatSession
}) {
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

  const { environmentId } = useChatTransport()
  const [initialView] = useState(() =>
    timelineInitialView(readTimelineReload(environmentId), session, items),
  )
  const [scrollState, dispatch] = useReducer(
    timelineScrollReducer,
    initialView?.scrollState ?? initialTimelineScrollState,
  )
  useReasoningAutoFold(items, scrollState.followMode !== 'free-scrolling')

  return (
    <VirtualList
      initialOffset={initialView?.offset}
      initialRect={initialView?.rect}
      initialMeasurementsCache={initialView?.measurements}
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
