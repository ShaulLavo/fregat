import { afterEach, describe, expect, it } from 'vitest'

import { applyBackdrop, backdropFor, documentBackdrop, resolveBackdrop } from '../platform/backdrop'

afterEach(() => {
  delete window.platformBridge
  document.documentElement.removeAttribute('data-backdrop')
})

describe('backdropFor', () => {
  // The regression this guards: the desktop shell used to be assumed
  // transparent, so the web layer skipped its wallpaper while the opaque window
  // hid the NSVisualEffectView — leaving no backdrop at all. Only the shell
  // knows which window it built, so its answer outranks the host guess.
  it('leaves a transparent window to the shell alone to declare', () => {
    expect(backdropFor('transparent', false)).toBe('transparent')
    expect(backdropFor(null, true)).not.toBe('transparent')
  })

  it('treats either source claiming a compositor as enough', () => {
    expect(backdropFor('compositor', false)).toBe('compositor')
    expect(backdropFor(null, true)).toBe('compositor')
    // A shell that reports an opaque window on a desktop that composites it —
    // the Linux browser's case, and the safe reading of a stale handoff.
    expect(backdropFor('app', true)).toBe('compositor')
  })

  it('draws its own wallpaper only when nothing else is behind the window', () => {
    expect(backdropFor(null, false)).toBe('app')
    expect(backdropFor('app', false)).toBe('app')
  })
})

describe('resolveBackdrop', () => {
  it('reads the shell bridge when there is one', () => {
    window.platformBridge = {
      backdrop: 'transparent',
      pickEntry: async () => [],
    }

    expect(resolveBackdrop()).toBe('transparent')
  })
})

describe('documentBackdrop', () => {
  it('round-trips every mode through the document', () => {
    expect(documentBackdrop()).toBe('app')

    applyBackdrop('compositor')
    expect(documentBackdrop()).toBe('compositor')

    applyBackdrop('transparent')
    expect(documentBackdrop()).toBe('transparent')

    applyBackdrop('app')
    expect(documentBackdrop()).toBe('app')
  })
})
