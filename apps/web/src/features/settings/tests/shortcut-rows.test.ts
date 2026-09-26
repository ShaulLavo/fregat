import { describe, expect, it } from 'vitest'

import { presetPlatformKeyBindings } from '@/keymap/default-bindings'
import type { PlatformCommandId } from '@/keymap/types'
import {
  matchingShortcutRows,
  shortcutFilterCounts,
  shortcutFilterMatches,
  shortcutPlacesLabel,
  shortcutRows,
  shortcutRowsWithChord,
  type ShortcutRow,
} from '@/features/settings/utils/shortcut-rows'

const defaults = presetPlatformKeyBindings('linux', 'default').bindings

function row(rows: readonly ShortcutRow[], command: PlatformCommandId): ShortcutRow {
  const found = rows.find((candidate) => candidate.command === command)
  if (!found) throw new Error(`no row for ${command}`)

  return found
}

describe('shortcutRows', () => {
  it('lists every default chord of a command', () => {
    const palette = row(shortcutRows(defaults, {}, 'linux'), 'workspace.showCommandPalette')

    expect(palette.keys).toEqual(['Mod+Shift+P', 'F1'])
    expect(palette.source).toBe('default')
    expect(palette.places).toEqual(['Everywhere'])
  })

  it('names each pane a command is bound in, merging identical chords', () => {
    const undo = row(shortcutRows(defaults, {}, 'linux'), 'workspace.undoSessionAction')

    const panes = new Set(
      defaults
        .filter((binding) => binding.command === 'workspace.undoSessionAction')
        .map((binding) => binding.pane),
    )

    expect(undo.keys).toEqual(['Mod+Z'])
    expect(undo.places).toHaveLength(panes.size)
    expect(undo.places).toEqual(expect.arrayContaining(['App', 'Git', 'Settings']))
    expect(shortcutPlacesLabel(undo.places)).toBe(
      `${undo.places[0]}; ${undo.places[1]} +${undo.places.length - 2}`,
    )
  })

  it('marks a custom chord, and a removed one with no keys', () => {
    const rows = shortcutRows(
      defaults,
      { 'workspace.goToLine': 'Mod+Alt+G', 'workspace.showCommandPalette': null },
      'linux',
    )

    expect(row(rows, 'workspace.goToLine')).toMatchObject({ keys: ['Mod+Alt+G'], source: 'custom' })
    expect(row(rows, 'workspace.showCommandPalette')).toMatchObject({ keys: [], source: 'removed' })
  })

  it('keeps a shadowed chord on the loser and names both sides of the clash', () => {
    const rows = shortcutRows(defaults, { 'workspace.goToLine': 'Mod+P' }, 'linux')
    const quickAccess = row(rows, 'workspace.showQuickAccess')

    expect(quickAccess).toMatchObject({ keys: ['Mod+P'], shadowedBy: 'workspace.goToLine' })
    expect(row(rows, 'workspace.goToLine').shadows).toEqual(['workspace.showQuickAccess'])
    expect(shortcutFilterMatches(quickAccess, 'conflicts')).toBe(true)
  })

  it('orders bound rows before unbound ones, then by title', () => {
    const rows = shortcutRows(defaults, {}, 'linux')
    const firstUnbound = rows.findIndex((candidate) => candidate.keys.length === 0)

    expect(firstUnbound).toBeGreaterThan(0)
    expect(rows.slice(firstUnbound).every((candidate) => candidate.keys.length === 0)).toBe(true)
    const bound = rows.slice(0, firstUnbound).map((candidate) => candidate.title)
    expect(bound).toEqual(bound.toSorted((left, right) => left.localeCompare(right)))
  })

  it('counts each filter', () => {
    const rows = shortcutRows(
      defaults,
      { 'workspace.goToLine': 'Mod+P', 'workspace.showCommandPalette': null },
      'linux',
    )
    const counts = shortcutFilterCounts(rows)

    expect(counts.all).toBe(rows.length)
    expect(counts.custom).toBe(2)
    expect(counts.conflicts).toBe(2)
    expect(counts.unassigned).toBe(rows.filter((candidate) => candidate.keys.length === 0).length)
  })
})

describe('shortcut search', () => {
  const rows = shortcutRows(defaults, {}, 'linux')

  it('matches title, command id and chord text', () => {
    const commands = (query: string) =>
      matchingShortcutRows(rows, query, 'linux').map((candidate) => candidate.command)

    expect(commands('command palette')).toContain('workspace.showCommandPalette')
    expect(commands('showcommandpalette')).toContain('workspace.showCommandPalette')
    expect(commands('ctrl+shift+p')).toContain('workspace.showCommandPalette')
  })

  it('finds rows bound to exactly one chord', () => {
    const exact = shortcutRowsWithChord(rows, 'F1', 'linux').map((candidate) => candidate.command)

    expect(exact).toEqual(['workspace.showCommandPalette'])
  })
})
