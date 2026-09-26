import { describe, expect, it } from 'vitest'

import { presetPlatformKeyBindings } from '@/keymap/default-bindings'
import type { PlatformCommandId } from '@/keymap/types'
import {
  matchingShortcutRows,
  shortcutFilterCounts,
  shortcutFilterMatches,
  shortcutListWith,
  shortcutPlacesLabel,
  shortcutRows,
  shortcutRowsWithChord,
  type ShortcutRow,
} from '@/features/settings/utils/shortcut-rows'

const defaults = presetPlatformKeyBindings('linux', 'default').bindings

function rowsFor(rows: readonly ShortcutRow[], command: PlatformCommandId): ShortcutRow[] {
  return rows.filter((candidate) => candidate.command === command)
}

function row(rows: readonly ShortcutRow[], command: PlatformCommandId, keys?: string): ShortcutRow {
  const found = rowsFor(rows, command).find(
    (candidate) => keys === undefined || candidate.keys === keys,
  )
  if (!found) throw new Error(`no row for ${command} ${keys ?? ''}`)

  return found
}

describe('shortcutRows', () => {
  it('gives every default chord of a command its own row', () => {
    const palette = rowsFor(shortcutRows(defaults, {}, 'linux'), 'workspace.showCommandPalette')

    expect(palette.map((candidate) => candidate.keys)).toEqual(['Mod+Shift+P', 'F1'])
    expect(palette.every((candidate) => candidate.source === 'default')).toBe(true)
    expect(palette[0]?.commandKeys).toEqual(['Mod+Shift+P', 'F1'])
    expect(palette[0]?.places).toEqual(['Everywhere'])
  })

  it('names each pane a chord is bound in, merging identical chords', () => {
    const undo = row(shortcutRows(defaults, {}, 'linux'), 'workspace.undoSessionAction')
    const panes = new Set(
      defaults
        .filter((binding) => binding.command === 'workspace.undoSessionAction')
        .map((binding) => binding.pane),
    )

    expect(undo.keys).toBe('Mod+Z')
    expect(undo.places).toHaveLength(panes.size)
    expect(undo.places).toEqual(expect.arrayContaining(['App', 'Git', 'Settings']))
    expect(shortcutPlacesLabel(undo.places)).toBe(
      `${undo.places[0]}; ${undo.places[1]} +${undo.places.length - 2}`,
    )
  })

  it('lists a custom list chord by chord, and a removal as one row with no keys', () => {
    const rows = shortcutRows(
      defaults,
      {
        'workspace.goToLine': ['Mod+Alt+G', 'F6'],
        'workspace.showCommandPalette': null,
        'workspace.saveFile': [],
      },
      'linux',
    )

    expect(rowsFor(rows, 'workspace.goToLine')).toEqual([
      expect.objectContaining({ keys: 'Mod+Alt+G', source: 'custom' }),
      expect.objectContaining({ keys: 'F6', source: 'custom' }),
    ])
    expect(rowsFor(rows, 'workspace.showCommandPalette')).toEqual([
      expect.objectContaining({ keys: null, source: 'removed' }),
    ])
    expect(rowsFor(rows, 'workspace.saveFile')).toEqual([
      expect.objectContaining({ keys: null, source: 'removed' }),
    ])
  })

  it('lists a command only the user has bound', () => {
    const rows = shortcutRows(defaults, { 'workspace.focusEditor': ['Mod+Alt+E'] }, 'linux')

    expect(row(rows, 'workspace.focusEditor')).toMatchObject({
      keys: 'Mod+Alt+E',
      source: 'custom',
    })
  })

  it('keeps a shadowed chord on the loser and names both sides of the clash', () => {
    const rows = shortcutRows(defaults, { 'workspace.goToLine': ['Mod+P'] }, 'linux')
    const quickAccess = row(rows, 'workspace.showQuickAccess')

    expect(quickAccess).toMatchObject({ keys: 'Mod+P', shadowedBy: 'workspace.goToLine' })
    expect(row(rows, 'workspace.goToLine').shadows).toEqual(['workspace.showQuickAccess'])
    expect(shortcutFilterMatches(quickAccess, 'conflicts')).toBe(true)
  })

  it('marks only the chord another command took when a command has two', () => {
    const rows = shortcutRows(defaults, { 'workspace.togglePanel': ['F1'] }, 'linux')

    expect(row(rows, 'workspace.showCommandPalette', 'F1').shadowedBy).toBe('workspace.togglePanel')
    expect(row(rows, 'workspace.showCommandPalette', 'Mod+Shift+P').shadowedBy).toBeNull()
  })

  it('marks the losing override when two of them name the same key', () => {
    const rows = shortcutRows(
      defaults,
      { 'workspace.saveFile': ['Mod+Alt+J'], 'workspace.togglePanel': ['Mod+Alt+J'] },
      'linux',
    )

    expect(row(rows, 'workspace.saveFile')).toMatchObject({
      keys: 'Mod+Alt+J',
      shadowedBy: 'workspace.togglePanel',
    })
  })

  it('orders bound rows before unbound ones, then by title', () => {
    const rows = shortcutRows(defaults, {}, 'linux')
    const firstUnbound = rows.findIndex((candidate) => candidate.keys === null)

    expect(firstUnbound).toBeGreaterThan(0)
    expect(rows.slice(firstUnbound).every((candidate) => candidate.keys === null)).toBe(true)
    const bound = rows.slice(0, firstUnbound).map((candidate) => candidate.title)
    expect(bound).toEqual(bound.toSorted((left, right) => left.localeCompare(right)))
  })

  it('counts each filter by row', () => {
    const rows = shortcutRows(
      defaults,
      { 'workspace.goToLine': ['Mod+P'], 'workspace.showCommandPalette': null },
      'linux',
    )
    const counts = shortcutFilterCounts(rows)

    expect(counts.all).toBe(rows.length)
    expect(counts.custom).toBe(2)
    expect(counts.conflicts).toBe(2)
    expect(counts.unassigned).toBe(rows.filter((candidate) => candidate.keys === null).length)
  })
})

describe('shortcutListWith', () => {
  const rows = shortcutRows(defaults, {}, 'linux')
  const f1 = row(rows, 'workspace.showCommandPalette', 'F1')

  it('adds a chord after the ones the command has', () => {
    expect(shortcutListWith(f1, { add: 'F2' })).toEqual(['Mod+Shift+P', 'F1', 'F2'])
  })

  it('replaces only this row’s chord', () => {
    expect(shortcutListWith(f1, { replace: 'F2' })).toEqual(['Mod+Shift+P', 'F2'])
  })

  it('removes only this row’s chord, and an empty list is what unbinds', () => {
    expect(shortcutListWith(f1, { remove: true })).toEqual(['Mod+Shift+P'])
    const save = row(rows, 'workspace.saveFile')
    expect(shortcutListWith(save, { remove: true })).toEqual([])
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

  it('finds the row bound to exactly one chord', () => {
    const exact = shortcutRowsWithChord(rows, 'F1', 'linux').map((candidate) => candidate.id)

    expect(exact).toEqual(['workspace.showCommandPalette F1'])
  })
})
