import type {
  ChatActivityLifecycle,
  ChatActivityTool,
} from '@/features/chat/utils/activity-presentation'
import type { ChatWorkLogEntry } from '@/features/chat/utils/work-log'

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ash', 'ksh', 'fish'])
const SHELL_SYNTAX = /[;&|<>$`(){}\n\r]/
const NON_PROGRAMS = new Set([
  'if',
  'for',
  'while',
  'case',
  'function',
  'echo',
  'printf',
  'cd',
  'export',
  'set',
  'test',
  '[',
  '[[',
])

export function isWorkLogToolEntry(entry: ChatWorkLogEntry) {
  return entry.sourceKind.startsWith('tool.') || entry.tone === 'tool'
}

export function workLogEntryLabel(entry: ChatWorkLogEntry, active: boolean): string {
  if (!isWorkLogToolEntry(entry)) return entry.title

  const lifecycle = entry.lifecycle
  const title = entry.title.replace(/\s+(?:started|updated|completed?)$/i, '').trim()
  if (entry.command) {
    const program = commandProgram(entry.command) ?? 'command'
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

function commandProgram(command: string, depth = 0): string | null {
  if (depth > 3) return null
  const tokens = shellTokens(command)
  if (!tokens) return null
  const index = programIndex(tokens)
  const executable = tokens[index]
  if (!executable || !/^[\w./-]+$/.test(executable)) return null
  const program = executable.split('/').at(-1)
  if (!program || NON_PROGRAMS.has(program)) return null
  if (!SHELLS.has(program)) return program

  const flag = tokens[index + 1]
  if (!flag || !/^-[a-zA-Z]*c[a-zA-Z]*$/.test(flag)) return null
  const script = tokens[index + 2]
  return script ? commandProgram(script, depth + 1) : null
}

function programIndex(tokens: readonly string[]) {
  let index = 0
  if (tokens[index] === 'env' || tokens[index] === '/usr/bin/env') index += 1
  for (; index < tokens.length; index += 1) {
    const token = tokens[index] ?? ''
    if (/^[A-Za-z_][A-Za-z\d_]*=/.test(token)) continue
    if (token === '-i' || token === '--ignore-environment') continue
    break
  }
  return index
}

// Only static single commands are described. Shell control flow keeps the generic label.
function shellTokens(command: string): string[] | null {
  const tokens: string[] = []
  let token = ''
  let quote = ''
  let escaped = false
  for (const character of command.trim()) {
    if (escaped) {
      token += character
      escaped = false
      continue
    }
    if (character === '\\' && quote !== "'") {
      escaped = true
      continue
    }
    if (quote && character === quote) {
      quote = ''
      continue
    }
    if (quote) {
      token += character
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (SHELL_SYNTAX.test(character)) return null
    if (/\s/.test(character)) {
      tokens.push(token)
      token = ''
      continue
    }
    token += character
  }
  if (quote || escaped) return null
  if (token) tokens.push(token)
  return tokens.filter(Boolean)
}
