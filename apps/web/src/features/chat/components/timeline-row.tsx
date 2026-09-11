import type { ChatTimelineItem } from '@/features/chat/utils/timeline-items'
import { useChatWorkLogExpansionStore } from '../state/chat-work-log-expansion-store'
import { ActivityGroupRow } from './activity-group-row'
import { AssistantMessageCopyButton } from './assistant-message-copy-button'
import { MessageBubble } from './message-bubble'
import { MessageCompletionDivider } from './message-completion-divider'
import { ProposedPlanCard } from './proposed-plan-card'
import { WorkingRow } from './working-row'
import { LiveActivityRow } from '@/features/chat/components/live-activity-row'
import { ActivityRow } from '@/features/chat/components/activity-row'

export function TimelineRow({
  checkpointRevertPending = false,
  item,
}: {
  checkpointRevertPending?: boolean
  item: ChatTimelineItem
}) {
  // The fold's own row is what unmounts when it scrolls out of overscan, so its open
  // state lives above the list, keyed by the id the derivation already guarantees.
  const foldId = item.type === 'turn-fold' ? item.id : ''
  const foldExpanded = useChatWorkLogExpansionStore(
    (state) => state.expandedGroupIds[foldId] ?? false,
  )
  const toggleGroupExpanded = useChatWorkLogExpansionStore((state) => state.toggleGroupExpanded)

  return (
    <div
      className='mx-auto w-full max-w-3xl min-w-0'
      data-timeline-row-id={item.id}
      data-timeline-row-type={item.type}
    >
      {timelineRowContent({
        checkpointRevertPending,
        foldExpanded,
        item,
        toggleFold: () => toggleGroupExpanded(foldId),
      })}
    </div>
  )
}

function timelineRowContent({
  checkpointRevertPending,
  foldExpanded,
  item,
  toggleFold,
}: {
  checkpointRevertPending: boolean
  foldExpanded: boolean
  item: ChatTimelineItem
  toggleFold: () => void
}) {
  if (item.type === 'message') {
    return (
      <MessageBubble
        assistantStreaming={item.assistantStreaming}
        assistantTurnInProgress={item.assistantTurnInProgress}
        checkpointRevertPending={checkpointRevertPending}
        completionSummary={item.completionSummary}
        durationEnd={item.durationEnd}
        durationStart={item.durationStart}
        message={item.message}
        renderAssistantCopyButton={renderAssistantCopyButton}
        revertTurnCount={item.revertTurnCount}
        showAssistantCopyButton={item.showAssistantCopyButton}
        showCompletionDivider={item.showCompletionDivider}
        turnDiffSummary={item.turnDiffSummary}
      />
    )
  }
  if (item.type === 'turn-fold') {
    return (
      <>
        <MessageCompletionDivider
          completionSummary={item.label}
          expanded={foldExpanded}
          hiddenCount={item.hiddenCount}
          onToggle={toggleFold}
        />
        {foldExpanded ? (
          <div className='space-y-3'>
            {item.items.map((folded) =>
              folded.type === 'activity-group' ? (
                <div key={folded.id}>
                  {folded.activities.map((activity) => (
                    <ActivityRow activity={activity} key={activity.id} />
                  ))}
                </div>
              ) : (
                <TimelineRow
                  checkpointRevertPending={checkpointRevertPending}
                  item={folded}
                  key={folded.id}
                />
              ),
            )}
          </div>
        ) : null}
      </>
    )
  }
  if (item.type === 'activity-group') return <ActivityGroupRow activities={item.activities} />
  if (item.type === 'proposed-plan') return <ProposedPlanCard plan={item.plan} />
  if (item.type === 'live-activity')
    return <LiveActivityRow activity={item.activity} groupId={item.id} />
  if (item.type === 'turn-status')
    return <MessageCompletionDivider completionSummary={item.label} />

  return <WorkingRow latestTurn={item.latestTurn} startedAt={item.startedAt} />
}

function renderAssistantCopyButton(text: string) {
  return <AssistantMessageCopyButton text={text} />
}
