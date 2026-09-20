import { clampComposerCursor as clampCursor } from '@workspace/contracts'
import {
  activeComposerMention,
  serializeComposerMention,
  type EntryTypeFilter,
  type ProviderCommandCatalog,
} from '@workspace/contracts'

import {
  composerCommandHint,
  composerCommandLabel,
  composerCommandReplacement,
  composerSkillLabel,
  composerSkillReplacement,
} from '@/features/chat/utils/composer-skills'
import {
  searchComposerCommands,
  searchComposerSkills,
} from '@/features/chat/utils/composer-command-search'

export type ChatInputTriggerKind = 'mention' | 'skill' | 'slash-command'

export type ChatInputTrigger = {
  kind: ChatInputTriggerKind
  query: string
  rangeEnd: number
  rangeStart: number
  /**
   * Exactly what the range covered when the trigger was detected. A menu commit
   * arrives one or more renders later, so this is the proof that the range still
   * points at the same characters.
   */
  text: string
}

export type ChatInputRangeReplacement = {
  cursor: number
  rangeEnd: number
  rangeStart: number
  text: string
}

export type ChatInputLineEdge = 'end' | 'start'

export type ChatInputSlashCommand = 'default' | 'plan'

export type ChatInputCommandItem =
  | {
      description: string
      id: string
      label: string
      replacement: string
      type: 'slash-command'
      value: ChatInputSlashCommand
    }
  | {
      description: string
      id: string
      label: string
      replacement: string
      /** A command the provider advertises. Unlike a built-in it sets no mode. */
      type: 'provider-command'
    }
  | {
      description: string
      id: string
      label: string
      replacement: string
      type: 'skill'
    }
  | {
      description: string
      entryType: EntryTypeFilter
      id: string
      label: string
      path: string
      replacement: string
      type: 'mention'
    }

export type ChatInputCommandGroup = {
  id: string
  items: ChatInputCommandItem[]
  label: string | null
}

const CHAT_INPUT_SLASH_COMMANDS: readonly ChatInputCommandItem[] = [
  {
    description: 'Use default build mode',
    id: 'slash-default',
    label: '/default',
    replacement: '',
    type: 'slash-command',
    value: 'default',
  },
  {
    description: 'Ask for a plan first',
    id: 'slash-plan',
    label: '/plan',
    replacement: '',
    type: 'slash-command',
    value: 'plan',
  },
]

/**
 * Typing an opening symbol while text is selected wraps the selection instead of
 * replacing it — the editing affordance a prose composer is most often missing.
 */
const CHAT_INPUT_SURROUND_PAIRS = new Map<string, string>([
  ['"', '"'],
  ["'", "'"],
  ['(', ')'],
  ['*', '*'],
  ['<', '>'],
  ['[', ']'],
  ['_', '_'],
  ['`', '`'],
  ['{', '}'],
  ['«', '»'],
  ['“', '”'],
])

const SENSITIVE_MENTION_PATH_WORDS = new Set([
  'apikey',
  'cert',
  'certificate',
  'certificates',
  'certs',
  'credential',
  'credentials',
  'env',
  'keystore',
  'oauth',
  'passwd',
  'password',
  'passwords',
  'pem',
  'secret',
  'secrets',
  'token',
  'tokens',
])
const SENSITIVE_MENTION_PATH_COMPOUNDS = ['accesskey', 'apikey', 'privatekey'] as const
const SENSITIVE_MENTION_PATH_SEGMENTS = new Set([
  '.env',
  '.netrc',
  '.npmrc',
  '.pypirc',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'id_rsa',
])

export function detectChatInputTrigger(text: string, cursorInput: number): ChatInputTrigger | null {
  const cursor = clampCursor(text, cursorInput)
  const slashTrigger = slashCommandTrigger(text, cursor)
  if (slashTrigger) return slashTrigger

  const skill = skillTrigger(text, cursor)
  if (skill) return skill

  // The grammar owns where a mention starts and what has been typed into it, so
  // a quoted path keeps the menu open across the spaces inside it.
  const mention = activeComposerMention(text, cursor)
  if (!mention) return null

  return {
    kind: 'mention',
    query: mention.query,
    rangeEnd: cursor,
    rangeStart: mention.start,
    text: text.slice(mention.start, cursor),
  }
}

/**
 * The splice a menu commit performs, or `null` when the range no longer covers
 * `expectedText`. Refusing is the only safe answer: the prompt has moved since
 * the menu opened, so the recorded offsets would cut a hole somewhere else — and
 * a second commit of the same item lands here too, because the first one already
 * changed the text the range points at.
 */
export function chatInputRangeReplacement({
  expectedText,
  rangeEnd,
  rangeStart,
  replacement,
  text,
}: {
  expectedText?: string
  rangeEnd: number
  rangeStart: number
  replacement: string
  text: string
}): ChatInputRangeReplacement | null {
  const safeStart = Math.max(0, Math.min(text.length, rangeStart))
  const safeEnd = Math.max(safeStart, Math.min(text.length, rangeEnd))
  if (expectedText !== undefined && text.slice(safeStart, safeEnd) !== expectedText) return null

  const spliceEnd = spliceEndForTrailingSpace(text, safeEnd, replacement)

  return {
    cursor: safeStart + replacement.length,
    rangeEnd: spliceEnd,
    rangeStart: safeStart,
    text: `${text.slice(0, safeStart)}${replacement}${text.slice(spliceEnd)}`,
  }
}

/** Replacements carry their own trailing blank, so mid-sentence commits ate one. */
function spliceEndForTrailingSpace(text: string, rangeEnd: number, replacement: string) {
  if (!replacement.endsWith(' ')) return rangeEnd
  if (text[rangeEnd] !== ' ') return rangeEnd

  return rangeEnd + 1
}

export function chatInputSurroundClose(character: string) {
  return CHAT_INPUT_SURROUND_PAIRS.get(character) ?? null
}

/**
 * Home/End target the logical line, not the wrapped visual one: the browser's
 * own `lineboundary` motion needs a live DOM selection, and on macOS it never
 * runs for these keys at all.
 */
export function chatInputLineBoundaryOffset(text: string, cursor: number, edge: ChatInputLineEdge) {
  const safeCursor = clampCursor(text, cursor)
  if (edge === 'end') {
    const lineEnd = text.indexOf('\n', safeCursor)

    return lineEnd === -1 ? text.length : lineEnd
  }
  if (safeCursor === 0) return 0

  return text.lastIndexOf('\n', safeCursor - 1) + 1
}

function chatInputMentionReplacement(path: string) {
  return `${serializeComposerMention(path)} `
}

export function searchChatInputSlashCommands(query: string) {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return CHAT_INPUT_SLASH_COMMANDS

  return CHAT_INPUT_SLASH_COMMANDS.filter((command) =>
    command.label.slice(1).toLowerCase().includes(normalizedQuery),
  )
}

/**
 * The mode a prompt that is *only* a slash command asks for. Picking the command
 * from the menu already clears the text, but a prompt that reaches submit
 * untouched — pasted, or sent with the mouse while the menu was open — must
 * still resolve to a mode instead of reaching the provider as prose.
 */
export function chatInputStandaloneSlashCommand(text: string): ChatInputSlashCommand | null {
  const match = /^\/(default|plan)$/i.exec(text.trim())
  const command = match?.[1]?.toLowerCase()
  if (command === 'plan') return 'plan'
  if (command === 'default') return 'default'

  return null
}

export function chatInputMentionCommandItems(
  entries: readonly {
    id: string
    label: string
    path: string
    type: EntryTypeFilter
  }[],
): ChatInputCommandItem[] {
  return entries
    .filter((entry) => !isSensitiveMentionPath(entry.path))
    .map((entry) => ({
      description: entry.path,
      entryType: entry.type,
      id: entry.id,
      label: entry.label,
      path: entry.path,
      replacement: chatInputMentionReplacement(entry.path),
      type: 'mention',
    }))
}

/** What the provider advertises for this project, ranked into menu rows. */
function chatInputProviderCommandItems(
  catalog: ProviderCommandCatalog | null,
  query: string,
): ChatInputCommandItem[] {
  if (!catalog?.supported) return []

  return searchComposerCommands(catalog.commands, query).map((command) => ({
    description: composerCommandHint(command),
    id: `provider-command:${command.name}`,
    label: composerCommandLabel(command),
    replacement: composerCommandReplacement(command),
    type: 'provider-command',
  }))
}

function chatInputSkillItems(
  catalog: ProviderCommandCatalog | null,
  query: string,
): ChatInputCommandItem[] {
  if (!catalog?.supported) return []

  return searchComposerSkills(catalog.skills, query).map((skill) => ({
    description: skill.description ?? '',
    id: `skill:${skill.name}`,
    label: composerSkillLabel(skill),
    replacement: composerSkillReplacement(skill),
    type: 'skill',
  }))
}

export function chatInputCommandItems(
  trigger: ChatInputTrigger | null,
  entries: Parameters<typeof chatInputMentionCommandItems>[0],
  catalog: ProviderCommandCatalog | null = null,
) {
  if (!trigger) return []
  if (trigger.kind === 'skill') return chatInputSkillItems(catalog, trigger.query)
  // Built-ins first: they are two fixed modes the user picks constantly, and a
  // provider with forty commands would otherwise bury them.
  if (trigger.kind === 'slash-command') {
    return [
      ...searchChatInputSlashCommands(trigger.query),
      ...chatInputProviderCommandItems(catalog, trigger.query),
    ]
  }

  return chatInputMentionCommandItems(entries)
}

export function chatInputCommandMenuEmptyLabel(trigger: ChatInputTrigger | null) {
  if (trigger?.kind === 'slash-command') return 'No matching commands'
  if (trigger?.kind === 'skill') return 'No matching skills'
  if (trigger?.query.trim()) return 'No matching files or folders'

  return 'Type a file or folder name'
}

export function chatInputCommandMenuLoadingLabel(triggerKind: ChatInputTriggerKind) {
  if (triggerKind === 'mention') return 'Searching workspace files…'
  if (triggerKind === 'skill') return 'Loading skills…'

  return 'Loading commands…'
}

/**
 * Built-ins and provider commands are labelled apart because they behave apart:
 * one switches the mode of the turn, the other is text the provider expands.
 */
export function groupChatInputCommandItems(
  items: readonly ChatInputCommandItem[],
  triggerKind: ChatInputTriggerKind,
): ChatInputCommandGroup[] {
  if (items.length === 0) return []
  if (triggerKind !== 'slash-command')
    return [{ id: 'default', items: Array.from(items), label: null }]

  const builtIn = items.filter((item) => item.type === 'slash-command')
  const provider = items.filter((item) => item.type === 'provider-command')

  return [
    ...(builtIn.length > 0 ? [{ id: 'built-in', items: builtIn, label: 'Built-in' }] : []),
    ...(provider.length > 0 ? [{ id: 'provider', items: provider, label: 'Provider' }] : []),
  ]
}

export function activeChatInputCommandItem(
  items: readonly ChatInputCommandItem[],
  activeItemId: string | null,
) {
  return items.find((item) => item.id === activeItemId) ?? items[0] ?? null
}

export function chatInputCommandItemByOffset(
  items: readonly ChatInputCommandItem[],
  activeItemId: string | null,
  offset: number,
) {
  if (items.length === 0) return null

  const activeIndex = Math.max(
    0,
    items.findIndex((item) => item.id === activeItemId),
  )
  const nextIndex = (activeIndex + offset + items.length) % items.length

  return items[nextIndex] ?? null
}

/**
 * `$name`, anywhere a word can start. Unlike a slash command it is a token
 * inside the prompt rather than the whole line — a skill is invoked in the
 * middle of a sentence — so it ends at the first blank and never spans one.
 */
function skillTrigger(text: string, cursor: number): ChatInputTrigger | null {
  const start = text.lastIndexOf('$', Math.max(0, cursor - 1))
  if (start < 0) return null

  const before = text[start - 1]
  // Only at a word boundary, or `$5.00` and `${VAR}` would open the menu.
  if (before !== undefined && !/\s/.test(before)) return null

  const query = text.slice(start + 1, cursor)
  if (/[\s$]/.test(query)) return null

  return {
    kind: 'skill',
    query,
    rangeEnd: cursor,
    rangeStart: start,
    text: text.slice(start, cursor),
  }
}

function slashCommandTrigger(text: string, cursor: number): ChatInputTrigger | null {
  const lineStart = text.lastIndexOf('\n', Math.max(0, cursor - 1)) + 1
  const linePrefix = text.slice(lineStart, cursor)
  if (!linePrefix.startsWith('/')) return null

  // Trailing blanks stay part of the command: `/plan ` is a finished command,
  // not prose, and dropping the trigger there used to ship the literal text to
  // the provider. Prose after the command (`/plan ship it`) still ends it.
  const commandMatch = /^\/(\S*)[ \t]*$/.exec(linePrefix)
  if (!commandMatch) return null

  return {
    kind: 'slash-command',
    query: commandMatch[1] ?? '',
    rangeEnd: cursor,
    rangeStart: lineStart,
    text: linePrefix,
  }
}

function isSensitiveMentionPath(path: string) {
  return path.split('/').some(isSensitiveMentionPathSegment)
}

function isSensitiveMentionPathSegment(segment: string) {
  const normalized = segment.trim().toLowerCase()
  if (!normalized) return false
  if (normalized === '.env' || normalized.startsWith('.env.')) return true
  if (SENSITIVE_MENTION_PATH_SEGMENTS.has(normalized)) return true
  if (SENSITIVE_MENTION_PATH_SEGMENTS.has(normalized.split('.')[0] ?? normalized)) return true

  const words = normalized.split(/[^a-z0-9]+/).filter(Boolean)
  if (words.some((word) => SENSITIVE_MENTION_PATH_WORDS.has(word))) return true

  const compact = words.join('')
  return SENSITIVE_MENTION_PATH_COMPOUNDS.some((word) => compact.includes(word))
}
