import type { ChatWorkLogEntry } from '@/features/chat/utils/work-log'
import { isWorkLogToolEntry } from '@/features/chat/utils/tool-label'
import { formatChatElapsed } from '@/features/chat/utils/formatters'
import { isWorkLogFailure } from '@/features/chat/utils/work-row'

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
  if (parts.length === 0) parts.push(`${activities.length} steps`)
  const failures = activities.filter(isWorkLogFailure).length
  if (failures > 0) parts.push(`${failures} failed`)
  const duration = activityGroupDuration(activities)
  if (duration) parts.push(duration)

  return parts.join(' · ')
}

/** First start to newest event; a group quicker than a second has nothing worth saying. */
function activityGroupDuration(activities: readonly ChatWorkLogEntry[]) {
  const first = activities[0]
  if (!first) return null
  const end = activities.reduce(
    (newest, entry) => (entry.lastActivityAt > newest ? entry.lastActivityAt : newest),
    first.lastActivityAt,
  )
  if (Date.parse(end) - Date.parse(first.createdAt) < 1_000) return null

  return formatChatElapsed(first.createdAt, end)
}
