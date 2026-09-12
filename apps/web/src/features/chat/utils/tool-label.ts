import type {
  ChatActivityLifecycle,
  ChatActivityTool,
} from '@/features/chat/utils/activity-presentation'
import type { ChatWorkLogEntry } from '@/features/chat/utils/work-log'

import { commandProgramName } from '@/features/chat/utils/command-label'

export function isWorkLogToolEntry(entry: ChatWorkLogEntry) {
  return entry.sourceKind.startsWith('tool.') || entry.tone === 'tool'
}

export function workLogEntryLabel(entry: ChatWorkLogEntry, active: boolean): string {
  if (!isWorkLogToolEntry(entry)) return entry.title

  const lifecycle = entry.lifecycle
  const title = entry.title.replace(/\s+(?:started|updated|completed?)$/i, '').trim()
  if (entry.command) {
    const program = commandProgramName(entry.command) ?? 'command'
    return `${lifecycleVerb(lifecycle, active, 'Running', 'Ran')} ${program}`
  }
  if (entry.tool) return describedToolLabel(entry.tool, lifecycle, active)
  if (
    /^command(?:execution|_execution|\s+execution|\s+run)?$/i.test(title) ||
    (entry.itemType === 'command_execution' && (!title || title === 'Tool'))
  ) {
    return `${lifecycleVerb(lifecycle, active, 'Running', 'Ran')} command`
  }
  if (entry.itemType === 'file_change') {
    const target = entry.changedFiles.length === 1 ? (entry.changedFiles[0] ?? 'file') : 'files'
    return describedToolLabel({ kind: 'edit', target }, lifecycle, active)
  }

  if (!active && (!lifecycle || lifecycle === 'completed') && title) return title

  return `${lifecycleVerb(lifecycle, active, 'Using', 'Used')} ${title || 'tool'}`
}

function describedToolLabel(
  tool: ChatActivityTool,
  lifecycle: ChatActivityLifecycle | null,
  active: boolean,
) {
  const verbs = {
    read: ['Reading', 'Read'],
    edit: ['Editing', 'Changed'],
    search: ['Searching', 'Searched'],
    browse: ['Opening', 'Opened'],
    mcp: ['Using', 'Used'],
  } as const
  const [running, completed] = verbs[tool.kind]
  return `${lifecycleVerb(lifecycle, active, running, completed)} ${tool.target}`
}

function lifecycleVerb(
  lifecycle: ChatActivityLifecycle | null,
  active: boolean,
  running: string,
  completed: string,
) {
  if (lifecycle === 'failed') return 'Failed'
  if (lifecycle === 'declined') return 'Declined'
  if (lifecycle === 'stopped') return 'Stopped'
  if (lifecycle === 'completed') return completed
  if (lifecycle === 'running' && !active) return 'Started'

  return active ? running : completed
}
