import { describe, expect, it } from 'vitest'
import {
  clamp8,
  parseCssColor,
  relativeLuminance,
  rgbaEquals,
  rgbaToCss,
  transparent,
  RGBA_BLACK,
  RGBA_EMPTY,
  RGBA_WHITE,
} from '../src/color'

describe('minimap color helpers', () => {
  it('parses hex and rgb color formats with alpha', () => {
    expect(parseCssColor('#0f08')).toEqual({ r: 0, g: 255, b: 0, a: 136 })
    expect(parseCssColor('#11223344')).toEqual({ r: 17, g: 34, b: 51, a: 68 })
    expect(parseCssColor('rgb(10 20 30 / 50%)')).toEqual({ r: 10, g: 20, b: 30, a: 128 })
    expect(parseCssColor('not-a-color', RGBA_WHITE)).toBe(RGBA_WHITE)
  })

  it('formats, compares, clamps, and measures RGBA colors', () => {
    expect(transparent(RGBA_BLACK, 0.25)).toEqual({ r: 0, g: 0, b: 0, a: 64 })
    expect(rgbaToCss({ r: 10, g: 20, b: 30, a: 128 })).toBe('rgba(10, 20, 30, 0.5019607843137255)')
    expect(rgbaEquals(RGBA_EMPTY, { r: 0, g: 0, b: 0, a: 0 })).toBe(true)
    expect(clamp8(999)).toBe(255)
    expect(clamp8(-1)).toBe(0)
    expect(relativeLuminance(RGBA_WHITE)).toBeGreaterThan(relativeLuminance(RGBA_BLACK))
  })
})
