import { describe } from 'vitest'
import { expect, test } from '../../../test/fixtures'

import { defaultPlatformKeyBindings } from '@/keymap/default-bindings'
import { resolvedPlatformKeyBindings } from '@/keymap/active-bindings'
import {
  heldModifiersAfter,
  NO_HELD_MODIFIERS,
  type HeldModifiers,
} from '@/keymap/utils/held-modifiers'
import { ariaKeyShortcuts, shortcutHintLabel } from '@/keymap/utils/shortcut-hints'

const ctrl: HeldModifiers = { ...NO_HELD_MODIFIERS, ctrl: true }
const ctrlAlt: HeldModifiers = { ...ctrl, alt: true }
const ctrlShift: HeldModifiers = { ...ctrl, shift: true }

function keyEvent(type: 'keydown' | 'keyup', key: string, flags: Partial<KeyboardEvent> = {}) {
  return { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...flags, key, type }
}

describe('shortcutHintLabel', () => {
  const platform = defaultPlatformKeyBindings('linux')

  test('Mod alone badges items, Mod+Alt badges panels, anything else badges neither', () => {
    const label = (
      held: HeldModifiers,
      command: 'workspace.selectItem3' | 'workspace.sidebarPanel3',
    ) => shortcutHintLabel(platform, command, held, 'linux')

    expect(label(ctrl, 'workspace.selectItem3')).toBe('3')
    expect(label(ctrl, 'workspace.sidebarPanel3')).toBeNull()
    expect(label(ctrlAlt, 'workspace.sidebarPanel3')).toBe('3')
    expect(label(ctrlAlt, 'workspace.selectItem3')).toBeNull()
    expect(label(ctrlShift, 'workspace.selectItem3')).toBeNull()
    expect(label(NO_HELD_MODIFIERS, 'workspace.selectItem3')).toBeNull()
  })

  test('follows an override and hides for an unbound or two-stroke one', () => {
    const rebound = resolvedPlatformKeyBindings(
      platform,
      { 'workspace.selectItem1': ['Alt+Q'] },
      'linux',
    )
    expect(shortcutHintLabel(rebound, 'workspace.selectItem1', ctrl, 'linux')).toBeNull()
    expect(
      shortcutHintLabel(
        rebound,
        'workspace.selectItem1',
        { ...NO_HELD_MODIFIERS, alt: true },
        'linux',
      ),
    ).toBe('Q')

    const unbound = resolvedPlatformKeyBindings(
      platform,
      { 'workspace.selectItem1': null },
      'linux',
    )
    expect(shortcutHintLabel(unbound, 'workspace.selectItem1', ctrl, 'linux')).toBeNull()

    const chord = resolvedPlatformKeyBindings(
      platform,
      { 'workspace.selectItem1': ['Mod+K 1'] },
      'linux',
    )
    expect(shortcutHintLabel(chord, 'workspace.selectItem1', ctrl, 'linux')).toBeNull()
  })

  test('VS Code mode badges items under its own modifiers', () => {
    const vscode = defaultPlatformKeyBindings('mac', 'vscode')
    const meta: HeldModifiers = { ...NO_HELD_MODIFIERS, meta: true }
    expect(
      shortcutHintLabel(
        vscode,
        'workspace.selectItem2',
        { ...NO_HELD_MODIFIERS, ctrl: true },
        'mac',
      ),
    ).toBe('2')
    expect(shortcutHintLabel(vscode, 'workspace.selectItem2', { ...meta, alt: true }, 'mac')).toBe(
      '2',
    )
    expect(shortcutHintLabel(vscode, 'workspace.selectItem2', meta, 'mac')).toBeNull()
  })

  test('names the effective shortcuts for assistive tech', () => {
    expect(ariaKeyShortcuts(platform, 'workspace.selectItem4', 'linux')).toBe('Control+4')
    expect(
      ariaKeyShortcuts(defaultPlatformKeyBindings('mac'), 'workspace.sidebarPanel2', 'mac'),
    ).toBe('Meta+Alt+2')
  })
})

describe('heldModifiersAfter', () => {
  test('a modifier keydown sets its bit and its keyup clears it', () => {
    const down = heldModifiersAfter(
      NO_HELD_MODIFIERS,
      keyEvent('keydown', 'Control', { ctrlKey: true }),
    )
    expect(down).toEqual(ctrl)
    expect(heldModifiersAfter(down, keyEvent('keyup', 'Control'))).toEqual(NO_HELD_MODIFIERS)
  })

  test('a stale flag on an ordinary key never sets a bit, but a missing one clears it', () => {
    expect(
      heldModifiersAfter(NO_HELD_MODIFIERS, keyEvent('keydown', 'Enter', { metaKey: true })),
    ).toBe(NO_HELD_MODIFIERS)
    expect(heldModifiersAfter(ctrl, keyEvent('keydown', 'a'))).toEqual(NO_HELD_MODIFIERS)
    expect(heldModifiersAfter(ctrl, keyEvent('keydown', '1', { ctrlKey: true }))).toBe(ctrl)
  })

  test('AltGr on Windows (Control then AltGraph) holds nothing while it types', () => {
    const control = heldModifiersAfter(
      NO_HELD_MODIFIERS,
      keyEvent('keydown', 'Control', { ctrlKey: true }),
    )
    const altGraph = heldModifiersAfter(
      control,
      keyEvent('keydown', 'AltGraph', { altKey: true, ctrlKey: true }),
    )
    expect(altGraph).toBe(NO_HELD_MODIFIERS)
    expect(
      heldModifiersAfter(altGraph, keyEvent('keydown', '@', { altKey: true, ctrlKey: true })),
    ).toBe(NO_HELD_MODIFIERS)
  })
})
