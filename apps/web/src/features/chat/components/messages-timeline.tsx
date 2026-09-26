import { useChatTransport } from '@/features/chat/hooks/use-chat-transport'
import { readTimelineReload, timelineInitialView } from '@/features/chat/state/timeline-reload'
import { useReducer, useState } from 'react'
import type { DisclosureSettle } from '@/features/chat/state/timeline-scroll'
import { VirtualList } from '@workspace/ui/patterns/virtual-list'
import type { ChatSession } from '@workspace/client-core/chat/types'

import { chatTimelineItemEstimate, chatTimelineItems } from '@/features/chat/utils/timeline-items'
import type { OptimisticChatMessage } from '@/features/chat/state/chat-message-intents'
import {
  initialTimelineScrollState,
  timelineScrollReducer,
  TIMELINE_COMPOSER_INSET_PX,
  TIMELINE_END_THRESHOLD_PX,
  TIMELINE_RELEASED_THRESHOLD_PX,
  TIMELINE_TOP_INSET_PX,
} from '@/features/chat/utils/timeline-scroll-anchoring'
import { TimelineRow } from '@/features/chat/components/timeline-row'
import { useRestoringCheckpoint } from '@/features/chat/hooks/use-restoring-checkpoint'
import { checkpointRestoreRoles } from '@/features/chat/utils/checkpoint-restore'
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
    turns: session.turns,
    messages: session.messages,
    optimisticMessages,
    proposedPlans: session.proposedPlans,
    turnDiffSummaries: session.turnDiffSummaries,
  })

  const { environmentId } = useChatTransport()
  const restoreRoles = checkpointRestoreRoles(items, useRestoringCheckpoint(session.id))
  const [initialView] = useState(() =>
    timelineInitialView(readTimelineReload(environmentId), session, items),
  )
  const [scrollState, dispatch] = useReducer(
    timelineScrollReducer,
    initialView?.scrollState ?? initialTimelineScrollState,
  )
  const [disclosureSettle, setDisclosureSettle] = useState<DisclosureSettle | null>(null)
  const [previousSessionId, setPreviousSessionId] = useState(session.id)
  if (previousSessionId !== session.id) {
    setPreviousSessionId(session.id)
    setDisclosureSettle(null)
  }
  useReasoningAutoFold(items, scrollState.followMode !== 'free-scrolling')
  // The park and a settling disclosure each hold a row still; end anchoring would pull the
  // growing end into view instead.
  const endAnchored = scrollState.followMode !== 'anchoring-new-turn' && disclosureSettle === null
  const following = scrollState.followMode === 'following-end'

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
      anchorTo={endAnchored ? 'end' : 'start'}
      followOnAppend={following}
      scrollEndThreshold={following ? TIMELINE_END_THRESHOLD_PX : TIMELINE_RELEASED_THRESHOLD_PX}
      contentClassName='[overflow-anchor:none]'
      renderRow={(item) => (
        <TimelineRow
          checkpointRevertPending={checkpointRevertPending}
          item={item}
          restoreRole={restoreRoles?.get(item.id)}
        />
      )}
      renderLayout={(layout) => (
        <TimelineViewport
          {...layout}
          items={items}
          session={session}
          scrollState={scrollState}
          dispatch={dispatch}
          disclosureSettle={disclosureSettle}
          onDisclosureSettle={setDisclosureSettle}
        />
      )}
    />
  )
}
