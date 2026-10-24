import { describe, expect, it } from 'vitest'
import { resolveMinimapOptions } from '../src/options'

describe('resolveMinimapOptions', () => {
  it('uses VS Code-compatible defaults', () => {
    expect(resolveMinimapOptions()).toMatchObject({
      enabled: true,
      size: 'proportional',
      side: 'right',
      showSlider: 'mouseover',
      autohide: 'none',
      renderCharacters: true,
      maxColumn: 120,
      scale: 1,
    })
  })

  it('clamps numeric options and rejects invalid enum values', () => {
    expect(
      resolveMinimapOptions({
        maxColumn: -1,
        scale: 99,
        // @ts-expect-error validating runtime input
        side: 'center',
      }),
    ).toMatchObject({ maxColumn: 1, scale: 3, side: 'right' })
  })
})
