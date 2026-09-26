import { describe } from 'vitest'
import { expect, test } from '../../../../../test/fixtures'
import { formatChord } from '@/keymap/utils/format-keys'

import { commandKeyBindings } from '@/keymap/active-bindings'
import { defaultPlatformKeyBindings } from '@/keymap/default-bindings'
import {
  commandsShadowedBy,
  matchingKeybindingRows,
} from '@/features/settings/utils/keybinding-rows'

// Real resolver output, not a fixture, so the helpers are tested against the
// data they actually see. The platform is pinned so the assertions do not
// depend on the machine running them.
const rows = commandKeyBindings(defaultPlatformKeyBindings('linux'), {}, 'linux')

describe('matchingKeybindingRows', () => {
  test('treats an empty query as no filter', () => {
    expect(matchingKeybindingRows(rows, '')).toBe(rows)
    expect(matchingKeybindingRows(rows, '   ')).toBe(rows)
  })

  test('matches on the command id', () => {
    const matched = matchingKeybindingRows(rows, 'workspace.saveFile')

    expect(matched).toHaveLength(1)
    expect(matched[0]?.command).toBe('workspace.saveFile')
  })

  // The case an id-only search would miss, and the whole reason the title is in
  // the haystack: neither word appears in the command id.
  test('matches on the title alone', () => {
    const matched = matchingKeybindingRows(rows, 'next tab or chat')

    expect(matched).toHaveLength(1)
    expect(matched[0]?.command).toBe('workspace.nextItem')
  })

  test('matches on a single shortcut', () => {
    const matched = matchingKeybindingRows(rows, 'Mod+S')

    expect(matched.map((row) => row.command)).toContain('workspace.saveFile')
  })

  test('returns nothing when the query matches nothing', () => {
    expect(matchingKeybindingRows(rows, 'zzznope')).toEqual([])
  })
})

describe('commandsShadowedBy', () => {
  // Reading `shadowedBy` rather than comparing chords is what keeps a global
  // and a pane-scoped copy of one chord from being reported as a conflict.
  test('counts the commands that lost their chord, and only those', () => {
    const shadowed = commandKeyBindings(
      defaultPlatformKeyBindings('linux'),
      { 'workspace.saveFile': 'Mod+B' },
      'linux',
    )

    expect(commandsShadowedBy(shadowed, 'workspace.saveFile')).toBe(1)
    expect(commandsShadowedBy(shadowed, 'workspace.togglePanel')).toBe(0)
  })
})

test('finds a chord by its notation prefix and displayed glyphs', () => {
  const overridden = commandKeyBindings(defaultPlatformKeyBindings(), {
    'workspace.showSettings': 'Mod+K Mod+S',
  })
  expect(matchingKeybindingRows(overridden, 'Mod+K').map((row) => row.command)).toContain(
    'workspace.showSettings',
  )
  expect(
    matchingKeybindingRows(overridden, formatChord('Mod+K')).map((row) => row.command),
  ).toContain('workspace.showSettings')
})

test('finds the second default shortcut while keeping the first as its primary hint', () => {
  const defaults = commandKeyBindings(defaultPlatformKeyBindings(), {})
  const settings = defaults.find((row) => row.command === 'workspace.showSettings')

  expect(settings?.keys).toBe('Mod+,')
  expect(matchingKeybindingRows(defaults, 'Mod+K').map((row) => row.command)).toContain(
    'workspace.showSettings',
  )
  expect(
    matchingKeybindingRows(defaults, formatChord('Mod+K')).map((row) => row.command),
  ).toContain('workspace.showSettings')
})

test('does not find replaced defaults after the user changes a shortcut', () => {
  const overridden = commandKeyBindings(defaultPlatformKeyBindings(), {
    'workspace.showSettings': 'Mod+Alt+J',
  })

  expect(matchingKeybindingRows(overridden, 'Mod+K').map((row) => row.command)).not.toContain(
    'workspace.showSettings',
  )
})

test('does not find a stolen secondary shortcut when another default survives', () => {
  const overridden = commandKeyBindings(defaultPlatformKeyBindings(), {
    'workspace.saveFile': 'Mod+K Mod+S',
  })
  const settings = overridden.find((row) => row.command === 'workspace.showSettings')

  expect(settings?.keys).toBe('Mod+,')
  for (const query of ['Mod+K', formatChord('Mod+K')]) {
    const matches = matchingKeybindingRows(overridden, query).map((row) => row.command)
    expect(matches).toContain('workspace.saveFile')
    expect(matches).not.toContain('workspace.showSettings')
  }
})
