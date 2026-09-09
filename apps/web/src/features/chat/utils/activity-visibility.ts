import type { OrchestrationSessionActivity } from '@workspace/contracts'

import { chatActivityHasFailure } from '@/features/chat/utils/activity-presentation'
import type { ChatWorkLogEntry } from '@/features/chat/utils/work-log'

const QUIET_ACTIVITY_KINDS = new Set([
  'account.updated',
  'account.rate-limits.updated',
  'auth.status',
  'mcp.status.updated',
  'mcp.oauth.completed',
  'model.rerouted',
  'config.warning',
  'deprecation.notice',
  'files.persisted',
  'conversation.realtime.started',
  'conversation.realtime.item-added',
  'conversation.realtime.audio.delta',
  'conversation.realtime.closed',
  'task.started',
  'task.updated',
  'tool.progress',
  'tool.summary',
  'turn.diff.updated',
  'context-window.updated',
])

const CODEX_DIAGNOSTIC_LINE =
  /^\d{4}-\d{2}-\d{2}T\S+\s+(TRACE|DEBUG|INFO|WARN|ERROR)\s+[a-zA-Z0-9_]+(?:::[a-zA-Z0-9_]+)*:\s+/

export function isVisibleChatActivity(activity: OrchestrationSessionActivity) {
  if (isCodexDiagnosticActivity(activity)) return false
  if (
    activity.kind === 'runtime.warning' &&
    activity.summary.endsWith('(no displayable text content)')
  )
    return false
  if (chatActivityHasFailure(activity)) return true
  if (activity.summary === 'Checkpoint captured') return false

  return !QUIET_ACTIVITY_KINDS.has(activity.kind)
}

function isCodexDiagnosticActivity(activity: OrchestrationSessionActivity) {
  if (activity.kind !== 'runtime.warning') return false
  const payload = activity.payload
  if (!payload || typeof payload !== 'object' || !('message' in payload) || !('detail' in payload))
    return false
  const { message, detail } = payload
  if (typeof message !== 'string' || !detail || typeof detail !== 'object') return false
  if (!('message' in detail) || detail.message !== message) return false
  if ('willRetry' in detail || 'error' in detail) return false
  if (message.toLowerCase().includes('failed to connect to websocket')) return false

  return CODEX_DIAGNOSTIC_LINE.test(message)
}

export function visibleActivityGroupRows(activities: readonly ChatWorkLogEntry[], maxRows: number) {
  if (maxRows <= 0) return []
  if (activities.length <= maxRows) return [...activities]

  const selectedIds = new Set(activities.slice(-maxRows).map((activity) => activity.id))
  return activities.filter(
    (activity) =>
      selectedIds.has(activity.id) ||
      activity.tone === 'error' ||
      activity.outcome === 'failed' ||
      activity.icon === 'approval' ||
      activity.icon === 'user-input',
  )
}

export function activeActivityGroupEntry(
  activities: readonly ChatWorkLogEntry[],
  activeTurnId: OrchestrationSessionActivity['turnId'],
) {
  if (!activeTurnId) return undefined

  return activities.findLast(
    (activity) =>
      activity.turnId === activeTurnId &&
      activity.outcome === 'neutral' &&
      activity.status !== 'Stopped',
  )
}

export function activityGroupSummary(activities: readonly ChatWorkLogEntry[]) {
  const commands = activities.filter((activity) => activity.itemType === 'command_execution').length
  const edits = activities.filter((activity) => activity.itemType === 'file_change')
  const files = new Set(edits.flatMap((activity) => activity.changedFiles)).size || edits.length
  const others = activities.length - commands - edits.length
  const parts: string[] = []
  if (commands > 0) parts.push(`Ran ${commands} ${commands === 1 ? 'command' : 'commands'}`)
  if (files > 0) parts.push(`Changed ${files} ${files === 1 ? 'file' : 'files'}`)
  if (others > 0) parts.push(`Used ${others} ${others === 1 ? 'tool' : 'tools'}`)

  return parts
    .map((part, index) => (index === 0 ? part : part[0]?.toLowerCase() + part.slice(1)))
    .join(' and ')
}
