import { describe, expect, it } from 'vitest'

import {
  getStickyKeyboardFocusPath,
  getStickyKeyboardScrollTopEntry,
  getStickyKeyboardViewportOffsetEntry,
  NO_STICKY_KEYBOARD_FOCUS,
  preserveStickyKeyboardFocusAtScrollTop,
  restoreStickyKeyboardViewportOffset,
  settleStickyKeyboardFocus,
} from '@/features/workspace/utils/tree-sticky-focus-mode'

describe('stickyFocusMode', () => {
  // The ref this replaces set the focus path unconditionally and only the
  // scroll-top conditionally. Collapsing the two silently breaks sticky
  // Shift+F10, which has no automated coverage above this layer.
  it('keeps the focus path when there is no scroll-top to preserve', () => {
    const mode = preserveStickyKeyboardFocusAtScrollTop('a/b', null)

    expect(getStickyKeyboardFocusPath(mode)).toBe('a/b')
    expect(getStickyKeyboardScrollTopEntry(mode)).toBeNull()
  })

  it('carries the scroll-top alongside the focus path when one is given', () => {
    const mode = preserveStickyKeyboardFocusAtScrollTop('a/b', 120)

    expect(getStickyKeyboardFocusPath(mode)).toBe('a/b')
    expect(getStickyKeyboardScrollTopEntry(mode)).toEqual({ path: 'a/b', scrollTop: 120 })
  })

  // A scroll-top of 0 is a real position, not "absent".
  it('treats a zero scroll-top as a preserved position', () => {
    const mode = preserveStickyKeyboardFocusAtScrollTop('a/b', 0)

    expect(getStickyKeyboardScrollTopEntry(mode)).toEqual({ path: 'a/b', scrollTop: 0 })
  })

  // Viewport-offset restoration nulled the focus-path ref, so exactly one
  // preservation mode is ever readable.
  it('reports only the viewport offset while restoring one', () => {
    const mode = restoreStickyKeyboardViewportOffset('a/b', 42)

    expect(getStickyKeyboardViewportOffsetEntry(mode)).toEqual({ path: 'a/b', viewportOffset: 42 })
    expect(getStickyKeyboardFocusPath(mode)).toBeNull()
    expect(getStickyKeyboardScrollTopEntry(mode)).toBeNull()
  })

  it('reports no viewport offset while preserving a focus path', () => {
    const mode = preserveStickyKeyboardFocusAtScrollTop('a/b', 120)

    expect(getStickyKeyboardViewportOffsetEntry(mode)).toBeNull()
  })

  it('settles the mode once focus lands on the path it was holding', () => {
    const focus = settleStickyKeyboardFocus(
      preserveStickyKeyboardFocusAtScrollTop('a/b', 120),
      'a/b',
    )
    const viewport = settleStickyKeyboardFocus(
      restoreStickyKeyboardViewportOffset('a/b', 42),
      'a/b',
    )

    expect(focus).toEqual(NO_STICKY_KEYBOARD_FOCUS)
    expect(viewport).toEqual(NO_STICKY_KEYBOARD_FOCUS)
  })

  it('holds the mode while focus is elsewhere, absent, or already settled', () => {
    const mode = preserveStickyKeyboardFocusAtScrollTop('a/b', 120)

    expect(settleStickyKeyboardFocus(mode, 'c/d')).toBe(mode)
    expect(settleStickyKeyboardFocus(mode, null)).toBe(mode)
    expect(settleStickyKeyboardFocus(NO_STICKY_KEYBOARD_FOCUS, 'a/b')).toBe(
      NO_STICKY_KEYBOARD_FOCUS,
    )
  })
})
