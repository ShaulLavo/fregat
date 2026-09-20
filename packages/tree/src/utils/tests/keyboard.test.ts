import { describe, expect, it } from 'vitest'

import {
  BLOCKED_CONTEXT_MENU_NAV_KEYS,
  canKeyUseStickyKeyboardState,
  isSearchOpenSeedKey,
  isSpaceSelectionKey,
  type FileTreeKeyboardEventLike,
} from '../render/keyboard'
import { isContextMenuKey as isContextMenuOpenKey } from '@workspace/utils/keyboard'

describe('file tree keyboard classification', () => {
  it.each([
    { code: 'Space', key: ' ' },
    { code: '', key: ' ' },
    { code: '', key: 'Spacebar' },
  ])('recognizes the $key space variant', ({ code, key }) => {
    expect(isSpaceSelectionKey(keyEvent({ code, key }))).toBe(true)
  })

  it.each(['a', 'Z', '7', 'é'])('accepts %s as a printable search seed', (key) => {
    expect(isSearchOpenSeedKey(keyEvent({ key }))).toBe(true)
  })

  it.each([{ altKey: true }, { ctrlKey: true }, { metaKey: true }])(
    'rejects modified search seeds',
    (modifiers) => {
      expect(isSearchOpenSeedKey(keyEvent({ key: 'a', ...modifiers }))).toBe(false)
    },
  )

  it('recognizes keyboard context-menu requests', () => {
    expect(isContextMenuOpenKey(keyEvent({ key: 'ContextMenu' }))).toBe(true)
    expect(isContextMenuOpenKey(keyEvent({ key: 'F10', shiftKey: true }))).toBe(true)
    expect(isContextMenuOpenKey(keyEvent({ key: 'F10' }))).toBe(false)
  })

  it.each(['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp'])(
    'allows sticky inspection for %s',
    (key) => {
      expect(canKeyUseStickyKeyboardState(keyEvent({ key }), false)).toBe(true)
    },
  )

  it('allows sticky inspection for menu and modified-space keys', () => {
    expect(canKeyUseStickyKeyboardState(keyEvent({ key: 'F10', shiftKey: true }), true)).toBe(true)
    expect(canKeyUseStickyKeyboardState(keyEvent({ code: 'Space', ctrlKey: true }), false)).toBe(
      true,
    )
  })

  it.each(['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'End', 'Home', 'PageDown', 'PageUp'])(
    'blocks %s while a context menu is open',
    (key) => {
      expect(BLOCKED_CONTEXT_MENU_NAV_KEYS.has(key)).toBe(true)
    },
  )
})

function keyEvent(overrides: Partial<FileTreeKeyboardEventLike>): FileTreeKeyboardEventLike {
  return {
    altKey: false,
    ctrlKey: false,
    key: '',
    metaKey: false,
    shiftKey: false,
    ...overrides,
  }
}
