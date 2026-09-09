import type {
  OrchestrationMessage,
  OrchestrationProposedPlan,
  OrchestrationSessionActivity,
} from '@workspace/contracts'
import type { ChatSession } from '@workspace/client-core/chat/types'

export type TimelineRow =
  | {
      readonly kind: 'message'
      readonly id: string
      readonly time: string
      readonly message: OrchestrationMessage
    }
  | {
      readonly kind: 'activity'
      readonly id: string
      readonly time: string
      readonly activity: OrchestrationSessionActivity
    }
  | {
      readonly kind: 'plan'
      readonly id: string
      readonly time: string
      readonly plan: OrchestrationProposedPlan
    }

export function timelineRows(session: ChatSession): readonly TimelineRow[] {
  const messages: TimelineRow[] = session.messages.map((message) => ({
    kind: 'message',
    id: message.id,
    time: message.createdAt,
    message,
  }))
  const activities: TimelineRow[] = session.activities
    .filter((activity) => activity.kind !== 'context-window.updated')
    .map((activity) => ({ kind: 'activity', id: activity.id, time: activity.createdAt, activity }))
  const plans: TimelineRow[] = session.proposedPlans.map((plan) => ({
    kind: 'plan',
    id: plan.id,
    time: plan.createdAt,
    plan,
  }))
  return [...messages, ...activities, ...plans].sort((a, b) => a.time.localeCompare(b.time))
}

export function activityText(activity: OrchestrationSessionActivity) {
  return activity.summary || activity.kind.replaceAll('.', ' ')
}

export function transcriptMarkdown(session: ChatSession) {
  const lines = [
    `# ${session.title}`,
    '',
    `Project: ${session.project.title}`,
    `Checkout: ${session.worktree.canonicalPath}`,
    '',
  ]
  for (const row of timelineRows(session)) appendTranscriptRow(lines, row)
  return `${lines.join('\n').trimEnd()}\n`
}

function appendTranscriptRow(lines: string[], row: TimelineRow) {
  if (row.kind === 'activity') {
    lines.push(`- ${activityText(row.activity)}`, '')
    return
  }
  if (row.kind === 'plan') {
    lines.push('## Proposed plan', '', row.plan.planMarkdown, '')
    return
  }
  lines.push(`## ${row.message.role === 'user' ? 'You' : 'Assistant'}`, '', row.message.text, '')
  for (const attachment of row.message.attachments)
    lines.push(`[Image: ${attachment.name}, ${attachment.sizeBytes} bytes]`, '')
}

export type GroupedTimelineRow =
  | Exclude<TimelineRow, { kind: 'activity' }>
  | {
      readonly kind: 'activity-group'
      readonly id: string
      readonly activities: readonly OrchestrationSessionActivity[]
    }
export function groupTimelineRows(rows: readonly TimelineRow[]): readonly GroupedTimelineRow[] {
  const result: GroupedTimelineRow[] = []
  let pending: OrchestrationSessionActivity[] = []
  for (const row of rows) {
    if (row.kind === 'activity') {
      pending.push(row.activity)
      continue
    }
    if (pending.length) {
      result.push({ kind: 'activity-group', id: `group:${pending[0].id}`, activities: pending })
      pending = []
    }
    result.push(row)
  }
  if (pending.length)
    result.push({ kind: 'activity-group', id: `group:${pending[0].id}`, activities: pending })
  return result
}
