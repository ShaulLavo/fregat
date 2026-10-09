import type { KeybindingOverrides } from '@workspace/contracts'
import { unique } from '@workspace/utils/collections'
import { normalizedChord, type PlatformName } from '@workspace/client-core/commands/chord'

import {
  bindingResolutionId,
  keyBindingResolution,
  type BindingResolutionEntry,
} from '@/keymap/active-bindings'
import { platformCommands } from '@/keymap/table'
import type { PlatformKeyBinding } from '@/keymap/types'
import { formatChord } from '@/keymap/utils/format-keys'

export type ShortcutSource = 'default' | 'custom' | 'removed'
export type ShortcutRow = {
  readonly id: string
  readonly command: string
  readonly title: string
  readonly keys: string | null
  readonly context?: string
  readonly defaultKeys: readonly string[]
  readonly commandKeys: readonly string[]
  readonly places: readonly string[]
  readonly source: ShortcutSource | null
  readonly shadowedBy: string | null
  readonly shadows: readonly string[]
  readonly losses: readonly { readonly winner: string; readonly place: string }[]
}

export const SHORTCUT_FILTERS = ['all', 'custom', 'conflicts', 'unassigned'] as const
export type ShortcutFilter = (typeof SHORTCUT_FILTERS)[number]

export function shortcutRows(
  defaults: readonly PlatformKeyBinding[],
  overrides: KeybindingOverrides,
  platform: PlatformName,
): readonly ShortcutRow[] {
  const resolution = keyBindingResolution(defaults, overrides, platform)
  const rows = resolution.bindings.flatMap((binding, index): ShortcutRow[] => {
    if (binding.command === null || 'unbind' in binding.entry) return []
    const command = binding.command
    const context = binding.context
    const report = resolution.report.filter(
      (entry) => entry.bindingId === bindingResolutionId(binding, index),
    )
    const losses = report.filter((entry) => entry.reason === 'shadowed' && entry.winner !== null)
    const unbound = report.some((entry) => entry.reason === 'unbound')
    let source: ShortcutSource = binding.source === 'user' ? 'custom' : 'default'
    if (unbound) source = 'removed'
    const defaultKeys = defaults
      .filter((entry) => entry.command === command && entry.context === context)
      .map((entry) => entry.keys)
    return [
      {
        id: bindingResolutionId(binding, index),
        command,
        title: shortcutTitle(command),
        keys: binding.keys,
        context,
        defaultKeys,
        commandKeys: [],
        places: [context ?? 'Workspace'],
        source,
        shadowedBy: losses[0]?.winner ?? null,
        shadows: unique(
          resolution.report
            .filter(
              (entry) =>
                entry.winner === command &&
                entry.winnerKeys === binding.keys &&
                (entry.winnerContext ?? undefined) === context,
            )
            .flatMap((entry) => (entry.command ? [entry.command] : [])),
        ),
        losses: losses.flatMap((entry) =>
          entry.winner ? [{ winner: entry.winner, place: entry.context }] : [],
        ),
      },
    ]
  })
  const assigned = new Set(rows.map((row) => row.command))
  for (const command of platformCommands) {
    if (assigned.has(command.id)) continue
    rows.push({
      id: command.id,
      command: command.id,
      title: command.title,
      keys: null,
      defaultKeys: [],
      commandKeys: [],
      places: ['Workspace'],
      source: null,
      shadowedBy: null,
      shadows: [],
      losses: [],
    })
  }
  const grouped = rows.map((row) => ({
    ...row,
    commandKeys: unique(
      rows
        .filter(
          (candidate) =>
            candidate.command === row.command &&
            candidate.context === row.context &&
            candidate.source !== 'removed',
        )
        .flatMap((candidate) => (candidate.keys ? [candidate.keys] : [])),
    ),
  }))
  return grouped.sort(
    (left, right) =>
      Number(left.keys === null) - Number(right.keys === null) ||
      left.title.localeCompare(right.title) ||
      (left.context ?? '').localeCompare(right.context ?? '') ||
      left.id.localeCompare(right.id),
  )
}

export function shortcutListWith(
  row: ShortcutRow,
  change: { readonly add: string } | { readonly replace: string } | { readonly remove: true },
): readonly string[] {
  if ('add' in change) return unique(row.commandKeys.concat([change.add]))
  if ('remove' in change) return row.commandKeys.filter((keys) => keys !== row.keys)
  if (row.keys === null) return [change.replace]
  if (!row.commandKeys.includes(row.keys)) return unique(row.commandKeys.concat([change.replace]))
  return unique(row.commandKeys.map((keys) => (keys === row.keys ? change.replace : keys)))
}

export function shortcutFilterMatches(row: ShortcutRow, filter: ShortcutFilter): boolean {
  if (filter === 'custom') return row.source === 'custom' || row.source === 'removed'
  if (filter === 'conflicts') return row.losses.length > 0 || row.shadows.length > 0
  if (filter === 'unassigned') return row.keys === null || row.source === 'removed'
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

export function matchingShortcutRows(
  rows: readonly ShortcutRow[],
  query: string,
  platform: PlatformName,
): readonly ShortcutRow[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return rows
  return rows.filter((row) =>
    `${row.command} ${row.title} ${row.context ?? 'Workspace'} ${row.keys ?? ''} ${row.keys ? formatChord(row.keys, platform) : ''}`
      .toLowerCase()
      .includes(needle),
  )
}

export function shortcutRowsWithChord(
  rows: readonly ShortcutRow[],
  keys: string,
  platform: PlatformName,
): readonly ShortcutRow[] {
  const chord = normalizedChord(keys, platform)
  return rows.filter((row) => row.keys === chord)
}

export function shortcutIdMatches(row: ShortcutRow, query: string): boolean {
  const needle = query.trim().toLowerCase()
  return needle !== '' && row.command.toLowerCase().includes(needle)
}

export function shortcutPlacesLabel(places: readonly string[]): string {
  if (places.length <= 2) return places.join('; ')
  return `${places.slice(0, 2).join('; ')} +${places.length - 2}`
}

export function shortcutSourceLabel(source: ShortcutSource | null): string {
  if (source === 'custom') return 'Custom'
  if (source === 'removed') return 'Unbound'
  if (source === 'default') return 'Preset'
  return ''
}

export function shortcutTitle(command: string): string {
  return platformCommands.find((entry) => entry.id === command)?.title ?? command
}

export function shortcutConflictLabel(row: ShortcutRow): string | null {
  if (row.shadowedBy) return `Shadowed by ${shortcutTitle(row.shadowedBy)}`
  return row.losses.length > 0
    ? `Shadowed in ${shortcutPlacesLabel(unique(row.losses.map((loss) => loss.place)))}`
    : null
}

export function shortcutPreview(
  report: readonly BindingResolutionEntry[],
  command: string,
  keys: string,
) {
  return {
    takes: report
      .filter(
        (entry) =>
          entry.reason === 'shadowed' &&
          ((entry.winner === command && entry.winnerKeys === keys) ||
            (entry.command === command && entry.keys === keys)),
      )
      .map((entry) => ({
        title: shortcutTitle(
          entry.command === command ? (entry.winner ?? command) : (entry.command ?? command),
        ),
        where: entry.context,
      })),
  }
}
