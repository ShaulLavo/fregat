import { describe, expect, it } from 'vitest'

import {
  COARSE_POINTER_QUERY,
  PHONE_ENTER_QUERY,
  PHONE_EXIT_QUERY,
  initialShellKind,
  nextShellKind,
} from '@/lib/shell/utils/kind'

/** A window `width` wide with a fine or coarse pointer, as the three queries see it. */
function viewport(width: number, pointer: 'fine' | 'coarse' = 'fine') {
  return (query: string) => {
    if (query === COARSE_POINTER_QUERY) return pointer === 'coarse'
    if (query === PHONE_ENTER_QUERY) return width <= 719
    if (query === PHONE_EXIT_QUERY) return width >= 800
    throw new Error(`unexpected query ${query}`)
  }
}

describe('shell kind', () => {
  it('boots a touch screen or a narrow window into the phone shell', () => {
    expect(initialShellKind(viewport(390, 'coarse'))).toBe('phone')
    expect(initialShellKind(viewport(1024, 'coarse'))).toBe('phone')
    expect(initialShellKind(viewport(600))).toBe('phone')
    expect(initialShellKind(viewport(760))).toBe('workbench')
  })

  it('keeps each shell inside the gap between the two widths, so the edge never flaps', () => {
    expect(nextShellKind('workbench', viewport(760))).toBe('workbench')
    expect(nextShellKind('phone', viewport(760))).toBe('phone')
    expect(nextShellKind('workbench', viewport(700))).toBe('phone')
    expect(nextShellKind('phone', viewport(820))).toBe('workbench')
  })

  it('keeps a rotated phone on the phone shell', () => {
    expect(nextShellKind('phone', viewport(844, 'coarse'))).toBe('phone')
  })
})
