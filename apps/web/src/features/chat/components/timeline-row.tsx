import { CopyButton } from '@/components/copy-button'
import { codexFileCitationsMarkdown } from '@/features/chat/utils/codex-file-citations'
import { artifactTemplateCopyText } from '@/features/chat/utils/artifact-templates'
import type { ChatTimelineItem } from '@/features/chat/utils/timeline-items'
import { useChatWorkLogExpansionStore } from '../state/chat-work-log-expansion-store'
import { ActivityGroupRow } from './activity-group-row'
import { MessageBubble } from './message-bubble'
import { MessageCompletionDivider } from './message-completion-divider'
import { ProposedPlanCard } from './proposed-plan-card'
import { WorkingRow } from './working-row'
import { TurnRetryActions } from './turn-retry-actions'
import { LiveActivityRow } from '@/features/chat/components/live-activity-row'
import { timelineRowSpacing } from '@/features/chat/utils/timeline-items'
import { cn } from '@workspace/ui/lib/utils'
import { RenderErrorBoundary } from '@workspace/ui/patterns/render-error-boundary'
import { AgentsRow } from '@/features/chat/components/agents-row'
import { ReasoningRow } from '@/features/chat/components/reasoning-row'
import { ModelSwitchRow } from '@/features/chat/components/model-switch-row'
import type { CheckpointRestoreRole } from '@/features/chat/utils/checkpoint-restore'

export function TimelineRow({
  checkpointRevertPending = false,
  item,
  restoreRole,
}: {
  checkpointRevertPending?: boolean
  item: ChatTimelineItem
  restoreRole?: CheckpointRestoreRole
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
      className={cn(
        'mx-auto w-full max-w-3xl min-w-0 transition-opacity',
        timelineRowSpacing(item),
        restoreRole === 'receding' && 'opacity-50',
      )}
      data-restore-role={restoreRole}
      data-timeline-row-id={item.id}
      data-timeline-row-type={item.type}
    >
      {/* One bad row must not blank the transcript around it. */}
      <RenderErrorBoundary align='start' label='This row' resetKeys={[item.id]}>
        {timelineRowContent({
          checkpointRevertPending,
          foldExpanded,
          item,
          restoreRole,
          toggleFold: () => toggleGroupExpanded(foldId),
        })}
      </RenderErrorBoundary>
    </div>
  )
}

function timelineRowContent({
  checkpointRevertPending,
  foldExpanded,
  item,
  restoreRole,
  toggleFold,
}: {
  checkpointRevertPending: boolean
  foldExpanded: boolean
  item: ChatTimelineItem
  restoreRole: CheckpointRestoreRole | undefined
  toggleFold: () => void
}) {
  if (item.type === 'agent-group') return <AgentsRow group={item.group} />
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
        restoreRole={restoreRole}
        revertTurnCount={item.revertTurnCount}
        incomplete={item.incomplete}
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
          <div className='pt-1.5'>
            {item.items.map((folded) => (
              <TimelineRow
                checkpointRevertPending={checkpointRevertPending}
                item={folded}
                key={folded.id}
              />
            ))}
          </div>
        ) : null}
      </>
    )
  }
  if (item.type === 'activity-group') return <ActivityGroupRow activities={item.activities} />
  if (item.type === 'reasoning')
    return <ReasoningRow entry={item.entry} streaming={item.streaming} />
  if (item.type === 'proposed-plan') return <ProposedPlanCard plan={item.plan} />
  if (item.type === 'live-activity')
    return <LiveActivityRow activity={item.activity} groupId={item.id} />
  if (item.type === 'turn-status')
    return <MessageCompletionDivider completionSummary={item.label} />
  if (item.type === 'turn-retry') return <TurnRetryActions />
  if (item.type === 'model-switch')
    return <ModelSwitchRow kind={item.kind} selection={item.selection} />

  return <WorkingRow latestTurn={item.latestTurn} startedAt={item.startedAt} />
}

function renderAssistantCopyButton(text: string) {
  return (
    <CopyButton
      className='bg-background/35 text-muted-foreground text-2xs'
      label='response'
      text={artifactTemplateCopyText(codexFileCitationsMarkdown(text))}
      variant='outline'
    />
  )
}
