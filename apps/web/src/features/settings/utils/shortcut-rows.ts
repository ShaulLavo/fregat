import type { KeybindingOverrides } from '@workspace/contracts'
import { unique } from '@workspace/utils/collections'
import {
  isBindableChord,
  normalizedChord,
  type PlatformName,
} from '@workspace/client-core/commands/chord'

import { keyBindingResolution } from '@/keymap/active-bindings'
import { platformCommandSpec } from '@/keymap/command-registry'
import { platformCommands } from '@/keymap/table'
import type { PlatformCommandId, PlatformKeyBinding } from '@/keymap/types'
import { formatChord } from '@/keymap/utils/format-keys'

/** Custom and Removed are the user's; Default is the preset's. */
export type ShortcutSource = 'default' | 'custom' | 'removed'

export type ShortcutRow = {
  readonly command: PlatformCommandId
  readonly title: string
  /** Every configured chord: the live ones, or what a shadowed row is configured with. */
  readonly keys: readonly string[]
  /** Where the chords apply, one entry per distinct pane and condition. */
  readonly places: readonly string[]
  /** Null on an unassigned row the user never touched. */
  readonly source: ShortcutSource | null
  /** The command that took this row's chord. */
  readonly shadowedBy: PlatformCommandId | null
  /** The commands this row took a chord from. */
  readonly shadows: readonly PlatformCommandId[]
}

export const SHORTCUT_FILTERS = ['all', 'custom', 'conflicts', 'unassigned'] as const

export type ShortcutFilter = (typeof SHORTCUT_FILTERS)[number]

const PANE_WORDS: Readonly<Record<string, string>> = {
  any: 'Everywhere',
  chat: 'Chat',
  'command-palette': 'Command palette',
  dialog: 'Dialog',
  editor: 'Editor',
  'file-tree': 'Files',
  git: 'Git',
  global: 'App',
  logs: 'Logs',
  problems: 'Problems',
  search: 'Search',
  settings: 'Settings',
  terminal: 'Terminal',
}

const CONDITION_WORDS: Readonly<Record<string, string>> = {
  writable: 'editable',
  hasSelection: 'with a selection',
  findVisible: 'find open',
  '!findVisible': 'find closed',
  suggestWidgetVisible: 'suggestions open',
  parameterHintsVisible: 'signature help open',
  parameterHintsMultipleSignatures: 'several signatures',
  inlineSuggestionVisible: 'inline suggestion shown',
  '!tabFocusMode': 'Tab inserts',
}

/** One row per command, bound (shadowed included) before unbound, then by title. */
export function shortcutRows(
  defaults: readonly PlatformKeyBinding[],
  overrides: KeybindingOverrides,
  platform: PlatformName,
): readonly ShortcutRow[] {
  const { bindings, shadowedBy } = keyBindingResolution(defaults, overrides, platform)
  const live = bindingsByCommand(bindings)
  const preset = bindingsByCommand(defaults)
  const shadows = new Map<PlatformCommandId, PlatformCommandId[]>()
  for (const [loser, winner] of shadowedBy) {
    shadows.set(winner, [...(shadows.get(winner) ?? []), loser])
  }

  const rows = platformCommands.map(({ id }) =>
    shortcutRow({
      command: id,
      live: live.get(id) ?? [],
      override: appliedOverride(overrides, id),
      platform,
      preset: preset.get(id) ?? [],
      shadowedBy: shadowedBy.get(id) ?? null,
      shadows: shadows.get(id) ?? [],
    }),
  )

  return rows.toSorted(
    (left, right) =>
      Number(left.keys.length === 0) - Number(right.keys.length === 0) ||
      left.title.localeCompare(right.title),
  )
}

export function shortcutFilterMatches(row: ShortcutRow, filter: ShortcutFilter): boolean {
  if (filter === 'custom') return row.source === 'custom' || row.source === 'removed'
  if (filter === 'conflicts') return row.shadowedBy !== null || row.shadows.length > 0
  if (filter === 'unassigned') return row.keys.length === 0

  return true
}

export function shortcutFilterCounts(
  rows: readonly ShortcutRow[],
): Readonly<Record<ShortcutFilter, number>> {
  const count = (filter: ShortcutFilter) =>
    rows.filter((row) => shortcutFilterMatches(row, filter)).length

  return {
    all: rows.length,
    custom: count('custom'),
    conflicts: count('conflicts'),
    unassigned: count('unassigned'),
  }
}

/** Rows whose title, command id or chord text contains the query. */
export function matchingShortcutRows(
  rows: readonly ShortcutRow[],
  query: string,
  platform: PlatformName,
): readonly ShortcutRow[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return rows

  return rows.filter((row) => shortcutHaystack(row, platform).includes(needle))
}

/** Rows bound to exactly this chord, for Record keys and Show conflicts. */
export function shortcutRowsWithChord(
  rows: readonly ShortcutRow[],
  keys: string,
  platform: PlatformName,
): readonly ShortcutRow[] {
  const chord = normalizedChord(keys, platform)

  return rows.filter((row) => row.keys.some((candidate) => candidate === chord))
}

/** VS Code shows the id inline only when the search matched it; the title is enough otherwise. */
export function shortcutIdMatches(row: ShortcutRow, query: string): boolean {
  const needle = query.trim().toLowerCase()

  return needle !== '' && row.command.toLowerCase().includes(needle)
}

/** "App; Git +4": two places, then a count, with every place in the row's title. */
export function shortcutPlacesLabel(places: readonly string[]): string {
  if (places.length <= 2) return places.join('; ')

  return `${places.slice(0, 2).join('; ')} +${places.length - 2}`
}

export function shortcutSourceLabel(source: ShortcutSource | null): string {
  if (source === 'custom') return 'Custom'
  if (source === 'removed') return 'Removed'
  if (source === 'default') return 'Default'

  return ''
}

function shortcutPlace(binding: Pick<PlatformKeyBinding, 'editorWhen' | 'pane'>): string {
  const pane = binding.pane ?? 'any'
  const words = [
    PANE_WORDS[pane] ?? pane,
    ...(binding.editorWhen ?? []).map((condition) => CONDITION_WORDS[condition] ?? condition),
  ]

  return words.join(', ')
}

export function shortcutTitle(command: PlatformCommandId): string {
  return platformCommandSpec(command)?.title ?? command
}

function shortcutRow({
  command,
  live,
  override,
  platform,
  preset,
  shadowedBy,
  shadows,
}: {
  readonly command: PlatformCommandId
  readonly live: readonly PlatformKeyBinding[]
  readonly override: string | null | undefined
  readonly platform: PlatformName
  readonly preset: readonly PlatformKeyBinding[]
  readonly shadowedBy: PlatformCommandId | null
  readonly shadows: readonly PlatformCommandId[]
}): ShortcutRow {
  const configured = configuredBindings(live, preset, override, shadowedBy)
  const keys =
    live.length === 0 && typeof override === 'string'
      ? [normalizedChord(override, platform)]
      : unique(configured.map((binding) => binding.keys))

  return {
    command,
    title: shortcutTitle(command),
    keys,
    places: keys.length === 0 ? [] : unique(configured.map(shortcutPlace)),
    source: shortcutSource(override, keys),
    shadowedBy,
    shadows,
  }
}

/** A shadowed row keeps its configured chord and places: they are what the winner took. */
function configuredBindings(
  live: readonly PlatformKeyBinding[],
  preset: readonly PlatformKeyBinding[],
  override: string | null | undefined,
  shadowedBy: PlatformCommandId | null,
): readonly PlatformKeyBinding[] {
  if (live.length > 0) return live
  if (shadowedBy === null || override === null) return []

  return preset
}

function shortcutSource(
  override: string | null | undefined,
  keys: readonly string[],
): ShortcutSource | null {
  if (override === null) return 'removed'
  if (typeof override === 'string') return 'custom'

  return keys.length > 0 ? 'default' : null
}

/** The override the resolver applies; an unknown command or unbindable chord is ignored there too. */
function appliedOverride(
  overrides: KeybindingOverrides,
  command: PlatformCommandId,
): string | null | undefined {
  if (!Object.hasOwn(overrides, command)) return undefined

  const keys = overrides[command]
  if (keys === null) return null

  return isBindableChord(keys) ? keys : undefined
}

function bindingsByCommand(bindings: readonly PlatformKeyBinding[]) {
  const byCommand = new Map<PlatformCommandId, PlatformKeyBinding[]>()
  for (const binding of bindings) {
    if (!binding.command) continue

    byCommand.set(binding.command, [...(byCommand.get(binding.command) ?? []), binding])
  }

  return byCommand
}

function shortcutHaystack(row: ShortcutRow, platform: PlatformName): string {
  const labels = row.keys.map((keys) => `${keys} ${formatChord(keys, platform)}`).join(' ')

  return `${row.command} ${row.title} ${labels}`.toLowerCase()
}
