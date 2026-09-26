import {
  APPROVAL_ANSWER_SUBMITTED_KIND,
  TURN_ENDED_ACTIVITY_KIND,
  type OrchestrationSessionActivity,
} from '@workspace/contracts'
import { isRecord } from '@workspace/utils/objects'

const QUIET_ACTIVITY_KINDS = new Set([
  APPROVAL_ANSWER_SUBMITTED_KIND,
  TURN_ENDED_ACTIVITY_KIND,
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

export function chatActivityHasFailure(activity: OrchestrationSessionActivity) {
  if (activity.tone === 'error') return true
  const payload = isRecord(activity.payload) ? activity.payload : {}
  const status = isRecord(payload.status) ? payload.status : {}
  if (payload.success === false || payload.status === 'failed' || status.status === 'failed')
    return true
  const error = isRecord(payload.error) ? payload.error : {}
  return [
    payload.error,
    payload.failureReason,
    error.message,
    status.error,
    status.failureReason,
  ].some((value) => typeof value === 'string' && value.trim().length > 0)
}
