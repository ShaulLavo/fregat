import {
  APPROVAL_ANSWER_SUBMITTED_KIND,
  type OrchestrationSessionActivity,
} from '@workspace/contracts'

import { chatActivityHasFailure } from '@/features/chat/utils/activity-presentation'
import type { ChatWorkLogEntry } from '@/features/chat/utils/work-log'
import { isWorkLogToolEntry } from '@/features/chat/utils/tool-label'
import { isWorkLogFailure } from '@/features/chat/utils/work-row'

const QUIET_ACTIVITY_KINDS = new Set([
  APPROVAL_ANSWER_SUBMITTED_KIND,
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

/** A collapsed group still shows every failure, every request and every tool call still running. */
export function isPinnedWorkLogEntry(entry: ChatWorkLogEntry) {
  if (isWorkLogFailure(entry)) return true
  if (entry.icon === 'approval' || entry.icon === 'user-input') return true

  return isWorkLogToolEntry(entry) && entry.lifecycle === 'running'
}

export function activityGroupSummary(activities: readonly ChatWorkLogEntry[]) {
  const tools = activities.filter((activity) => !activity.plan && isWorkLogToolEntry(activity))
  const commands = tools.filter(
    (activity) => activity.command || activity.itemType === 'command_execution',
  ).length
  const edits = tools.filter(
    (activity) => activity.itemType === 'file_change' || activity.tool?.kind === 'edit',
  )
  const files = new Set(edits.flatMap((activity) => activity.changedFiles)).size || edits.length
  const reads = tools.filter((activity) => activity.tool?.kind === 'read').length
  const searches = tools.filter((activity) => activity.tool?.kind === 'search').length
  const others = tools.length - commands - edits.length - reads - searches
  const parts: string[] = []
  if (commands > 0) parts.push(`Ran ${commands} ${commands === 1 ? 'command' : 'commands'}`)
  if (files > 0) parts.push(`Changed ${files} ${files === 1 ? 'file' : 'files'}`)
  if (reads > 0) parts.push(`Read ${reads} ${reads === 1 ? 'file' : 'files'}`)
  if (searches > 0) parts.push(`Searched ${searches} ${searches === 1 ? 'time' : 'times'}`)
  if (others > 0) parts.push(`Used ${others} ${others === 1 ? 'tool' : 'tools'}`)
  if (parts.length === 0) return `${activities.length} steps`

  return parts.join(' · ')
}
