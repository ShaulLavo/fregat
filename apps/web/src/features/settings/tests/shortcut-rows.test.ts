import { describe, expect, it } from 'vitest'
import type { PlatformKeyBinding } from '@/keymap/types'
import {
  matchingShortcutRows,
  shortcutFilterMatches,
  shortcutListWith,
  shortcutRows,
} from '@/features/settings/utils/shortcut-rows'

const defaults: readonly PlatformKeyBinding[] = [
  {
    keys: 'Mod+B',
    chord: ['Mod+B'],
    command: 'workspace.toggleSidebarVisibility',
    context: 'Workspace',
    source: 'default',
    entry: {
      keys: 'Mod+B',
      command: 'workspace.toggleSidebarVisibility',
      context: 'Workspace',
      source: 'default',
    },
  },
  {
    keys: 'Mod+B',
    chord: ['Mod+B'],
    command: 'workspace.saveFile',
    context: 'Editor',
    source: 'default',
    entry: { keys: 'Mod+B', command: 'workspace.saveFile', context: 'Editor', source: 'default' },
  },
]

describe('contextual shortcut rows', () => {
  it('keeps deeper defaults and shallow user rows visible with depth precedence information', () => {
    const rows = shortcutRows(
      defaults,
      [{ keys: 'Mod+B', command: 'workspace.showSettings', context: 'Workspace' }],
      'linux',
    )
    const shallow = rows.find(
      (row) => row.command === 'workspace.showSettings' && row.source === 'custom',
    )
    expect(shallow).toMatchObject({ context: 'Workspace', shadowedBy: 'workspace.saveFile' })
    expect(rows.find((row) => row.command === 'workspace.saveFile')).toMatchObject({
      context: 'Editor',
      source: 'default',
    })
    expect(shallow && shortcutFilterMatches(shallow, 'conflicts')).toBe(true)
  })

  it('shows equal-depth user precedence while preserving the preset row', () => {
    const rows = shortcutRows(
      defaults,
      [{ keys: 'Mod+B', command: 'workspace.showSettings', context: 'Editor' }],
      'linux',
    )
    expect(rows.find((row) => row.command === 'workspace.saveFile')).toMatchObject({
      shadowedBy: 'workspace.showSettings',
      context: 'Editor',
    })
    expect(
      rows.find((row) => row.command === 'workspace.showSettings' && row.source === 'custom'),
    ).toMatchObject({ context: 'Editor' })
  })

  it('shows a targeted unbind and can record a replacement for its preset row', () => {
    const rows = shortcutRows(
      defaults,
      [{ keys: 'Mod+B', unbind: 'workspace.saveFile', context: 'Editor' }],
      'linux',
    )
    const removed = rows.find((row) => row.command === 'workspace.saveFile')
    expect(removed).toMatchObject({ source: 'removed', defaultKeys: ['Mod+B'], context: 'Editor' })
    if (!removed) expect.fail('Missing unbound preset row')
    expect(shortcutListWith(removed, { replace: 'F8' })).toEqual(['F8'])
    expect(rows.find((row) => row.command === 'workspace.toggleSidebarVisibility')?.source).toBe(
      'default',
    )
  })

  it('searches authored predicates and groups edits by exact context', () => {
    const rows = shortcutRows(
      defaults,
      [
        { keys: 'F8', command: 'workspace.saveFile', context: 'Workspace' },
        { keys: 'F9', command: 'workspace.saveFile', context: 'Terminal && mode == alternate' },
      ],
      'linux',
    )
    const terminal = rows.find(
      (row) =>
        row.command === 'workspace.saveFile' && row.context === 'Terminal && mode == alternate',
    )
    if (!terminal) expect.fail('Missing terminal contextual row')
    expect(matchingShortcutRows(rows, 'mode == alternate', 'linux')).toContain(terminal)
    expect(shortcutListWith(terminal, { add: 'F10' })).toEqual(['F9', 'F10'])
    expect(terminal.defaultKeys).toEqual([])
  })
})
