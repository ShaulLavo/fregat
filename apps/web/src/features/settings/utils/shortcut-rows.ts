import type { KeybindingOverrides } from '@workspace/contracts'
import { unique } from '@workspace/utils/collections'
import {
  isBindableChord,
  keysConflict,
  normalizedChord,
  type PlatformName,
} from '@workspace/client-core/commands/chord'

import { keyBindingResolution, type LostChord } from '@/keymap/active-bindings'
import { platformCommandSpec } from '@/keymap/command-registry'
import { platformCommands } from '@/keymap/table'
import type { PlatformCommandId, PlatformKeyBinding } from '@/keymap/types'
import { formatChord } from '@/keymap/utils/format-keys'

/** Custom and Removed are the user's; Default is the preset's. */
export type ShortcutSource = 'default' | 'custom' | 'removed'

/** One chord of one command, as VS Code lists them; an unbound command has one row with no chord. */
export type ShortcutRow = {
  /** Unique across rows: the command, then the chord. */
  readonly id: string
  readonly command: PlatformCommandId
  readonly title: string
  /** This row's chord; null on an unbound command. */
  readonly keys: string | null
  /** Every chord the command is configured with, which Add, Change and Remove rewrite. */
  readonly commandKeys: readonly string[]
  /** Where this chord applies, one entry per distinct pane and condition. */
  readonly places: readonly string[]
  /** Null on an unassigned row the user never touched. */
  readonly source: ShortcutSource | null
  /** The command that took this chord. */
  readonly shadowedBy: PlatformCommandId | null
  /** The commands this chord took a shortcut from. */
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

/** One row per chord, bound (shadowed included) before unbound, then by title and chord order. */
export function shortcutRows(
  defaults: readonly PlatformKeyBinding[],
  overrides: KeybindingOverrides,
  platform: PlatformName,
): readonly ShortcutRow[] {
  const resolution = keyBindingResolution(defaults, overrides, platform)
  const live = bindingsByCommand(resolution.bindings)
  const preset = bindingsByCommand(defaults)

  const rows = platformCommands.flatMap(({ id }) =>
    commandRows({
      command: id,
      live: live.get(id) ?? [],
      lost: resolution.lostChords,
      override: appliedOverride(overrides, id, platform),
      preset: preset.get(id) ?? [],
    }),
  )

  return rows.toSorted(
    (left, right) =>
      Number(left.keys === null) - Number(right.keys === null) ||
      left.title.localeCompare(right.title) ||
      left.commandKeys.indexOf(left.keys ?? '') - right.commandKeys.indexOf(right.keys ?? ''),
  )
}

/** The list a command would carry with one chord added, replaced or removed. */
export function shortcutListWith(
  row: ShortcutRow,
  change: { readonly add: string } | { readonly replace: string } | { readonly remove: true },
): readonly string[] {
  if ('add' in change) return unique([...row.commandKeys, change.add])
  if ('remove' in change) return row.commandKeys.filter((keys) => keys !== row.keys)
  if (row.keys === null) return [change.replace]

  return unique(row.commandKeys.map((keys) => (keys === row.keys ? change.replace : keys)))
}

export function shortcutFilterMatches(row: ShortcutRow, filter: ShortcutFilter): boolean {
  if (filter === 'custom') return row.source === 'custom' || row.source === 'removed'
  if (filter === 'conflicts') return row.shadowedBy !== null || row.shadows.length > 0
  if (filter === 'unassigned') return row.keys === null

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

  return rows.filter((row) => row.keys === chord)
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

function commandRows({
  command,
  live,
  lost,
  override,
  preset,
}: {
  readonly command: PlatformCommandId
  readonly live: readonly PlatformKeyBinding[]
  readonly lost: readonly LostChord[]
  readonly override: readonly string[] | undefined
  readonly preset: readonly PlatformKeyBinding[]
}): ShortcutRow[] {
  const title = shortcutTitle(command)
  const commandKeys = override ?? unique(preset.map((binding) => binding.keys))
  const source = shortcutSource(override, commandKeys)
  if (commandKeys.length === 0) {
    const row = { command, commandKeys, keys: null, places: [], shadowedBy: null, shadows: [] }
    return [{ ...row, id: command, source, title }]
  }

  return commandKeys.map((keys) => {
    const liveHere = live.filter((binding) => binding.keys === keys)
    const taken = lost.find((chord) => chord.command === command && chord.keys === keys)
    const shadowedBy = liveHere.length > 0 ? null : (taken?.winner ?? null)

    return {
      command,
      commandKeys,
      id: `${command} ${keys}`,
      keys,
      places: unique(placesOf(liveHere, preset, keys).map(shortcutPlace)),
      shadowedBy,
      shadows: [
        ...new Set(
          lost
            .filter((chord) => chord.winner === command && keysConflict(chord.keys, keys))
            .map((chord) => chord.command),
        ),
      ],
      source,
      title,
    }
  })
}

/** Live bindings where the chord works, else where it is configured (what a winner took). */
function placesOf(
  liveHere: readonly PlatformKeyBinding[],
  preset: readonly PlatformKeyBinding[],
  keys: string,
): readonly Pick<PlatformKeyBinding, 'editorWhen' | 'pane'>[] {
  if (liveHere.length > 0) return liveHere

  const presetHere = preset.filter((binding) => binding.keys === keys)
  if (presetHere.length > 0) return presetHere

  return preset.length > 0 ? preset : [{ editorWhen: undefined, pane: 'any' }]
}

function shortcutSource(
  override: readonly string[] | undefined,
  commandKeys: readonly string[],
): ShortcutSource | null {
  if (override === undefined) return commandKeys.length > 0 ? 'default' : null

  return override.length === 0 ? 'removed' : 'custom'
}

/** The list the resolver applies, normalized; an unknown command or all-invalid list is ignored there too. */
function appliedOverride(
  overrides: KeybindingOverrides,
  command: PlatformCommandId,
  platform: PlatformName,
): readonly string[] | undefined {
  if (!Object.hasOwn(overrides, command)) return undefined

  const list = overrides[command] ?? []
  const chords = list.filter(isBindableChord)
  if (chords.length === 0 && list.length > 0) return undefined

  return unique(chords.map((keys) => normalizedChord(keys, platform)))
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
  const labels = row.keys ? `${row.keys} ${formatChord(row.keys, platform)}` : ''

  return `${row.command} ${row.title} ${labels}`.toLowerCase()
}
