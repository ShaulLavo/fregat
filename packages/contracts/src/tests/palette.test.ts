import { describe, expect, it } from 'vitest'

import {
  BUNDLED_PALETTES,
  GRAPHITE_PALETTE_DOCUMENT,
  SAGE_PALETTE_DOCUMENT,
} from '../themes/bundled'
import { contrastRatio, flatten, parseColor, toCss, toHex, toRgb } from '../themes/color'
import {
  APP_COLOR_ROLES,
  TERMINAL_COLOR_ROLES,
  paletteColorsFor,
  parsePalette,
  serializePalette,
} from '../themes/palette'

function mustParse(document: unknown) {
  const result = parsePalette(document, 'user')
  if (!result.success) throw new TypeError('expected the palette to parse')

  return result.palette
}

describe('parseColor', () => {
  it('reads hex in every length and writes it back exactly', () => {
    expect(toHex(parseColor('#fff')!)).toBe('#ffffff')
    expect(toHex(parseColor('#1a1b26')!)).toBe('#1a1b26')
    expect(toHex(parseColor('#7aa2f7')!)).toBe('#7aa2f7')
    expect(toHex(parseColor('#d9775780')!)).toBe('#d9775780')
    expect(toHex(parseColor('#abcd')!)).toBe('#aabbccdd')
  })

  it('reads rgb(), hsl() and oklch() with and without alpha', () => {
    expect(toHex(parseColor('rgb(217, 119, 87)')!)).toBe('#d97757')
    expect(toHex(parseColor('rgba(217 119 87 / 50%)')!)).toBe('#d9775780')
    expect(toHex(parseColor('rgba(217, 119, 87, 0.5)')!)).toBe('#d9775780')
    expect(toHex(parseColor('hsl(0 100% 50%)')!)).toBe('#ff0000')
    expect(toHex(parseColor('hsl(120deg, 100%, 25%)')!)).toBe('#008000')
    expect(parseColor('oklch(1 0 0 / 10%)')).toEqual({ l: 1, c: 0, h: 0, alpha: 0.1 })
    expect(parseColor('transparent')?.alpha).toBe(0)
  })

  it('rejects anything that is not a literal color', () => {
    expect(parseColor('var(--foreground)')).toBeNull()
    expect(parseColor('color-mix(in oklch, red, blue)')).toBeNull()
    expect(parseColor('red')).toBeNull()
    expect(parseColor('#12345')).toBeNull()
    expect(parseColor('oklch(0.5 0.1)')).toBeNull()
  })

  it('keeps an authored oklch value exact through css output', () => {
    const color = parseColor('oklch(0.97 0.006 70)')!
    expect(toCss(color)).toBe('oklch(0.97 0.006 70)')
    expect(toCss(parseColor('oklch(0.74 0.145 18)')!)).toBe('oklch(0.74 0.145 18)')
  })

  it('round-trips an sRGB color through oklch without drift', () => {
    for (const hex of ['#000000', '#ffffff', '#808080', '#ff5f57', '#0e0e14', '#c0caf5']) {
      expect(toHex(parseColor(hex)!)).toBe(hex)
    }
  })

  it('clips an out-of-gamut chroma toward sRGB while keeping hue and lightness', () => {
    const vivid = parseColor('oklch(0.7 0.4 145)')!
    expect(vivid.c).toBeLessThan(0.4)
    expect(vivid.l).toBeCloseTo(0.7, 3)
    expect(vivid.h).toBe(145)
    const rgb = toRgb(vivid)
    for (const channel of [rgb.r, rgb.g, rgb.b]) {
      expect(channel).toBeGreaterThanOrEqual(0)
      expect(channel).toBeLessThanOrEqual(255)
    }
  })

  it('flattens alpha over a background and measures contrast on the result', () => {
    const white = parseColor('#ffffff')!
    const black = parseColor('#000000')!
    expect(contrastRatio(black, white)).toBeCloseTo(21, 1)
    const tenPercentWhite = parseColor('oklch(1 0 0 / 10%)')!
    const flat = toRgb(flatten(tenPercentWhite, black))
    // 25.5 in 8-bit sRGB; either neighbour is the browser's answer.
    expect(Math.abs(flat.r - 25.5)).toBeLessThanOrEqual(0.5)
    expect(flat.r).toBe(flat.g)
    expect(flat.alpha).toBe(1)
    expect(contrastRatio(tenPercentWhite, black)).toBeLessThan(2)
  })
})

describe('palette documents', () => {
  it('parses both bundled palettes', () => {
    expect(BUNDLED_PALETTES.map((palette) => palette.id)).toEqual(['graphite', 'sage'])
    for (const palette of BUNDLED_PALETTES) {
      expect(palette.source).toBe('bundled')
      const colors = paletteColorsFor(palette, 'dark')
      expect(Object.keys(colors.app).sort()).toEqual(APP_COLOR_ROLES.toSorted())
      expect(Object.keys(colors.terminal).sort()).toEqual(TERMINAL_COLOR_ROLES.toSorted())
    }
  })

  it('serializes to exact oklch and parses back to the same colors', () => {
    for (const document of [GRAPHITE_PALETTE_DOCUMENT, SAGE_PALETTE_DOCUMENT]) {
      const first = mustParse(document)
      const serialized = serializePalette(first)
      const second = mustParse(serialized)
      expect(second.variants).toEqual(first.variants)
    }
    const graphite = serializePalette(mustParse(GRAPHITE_PALETTE_DOCUMENT))
    expect(graphite.variants.kind === 'paired' && graphite.variants.dark.app.border).toBe(
      'oklch(1 0 0 / 0.1)',
    )
  })

  it('rejects a missing role, a bad color and a bad id', () => {
    const { variants, ...rest } = GRAPHITE_PALETTE_DOCUMENT
    expect(variants.kind).toBe('paired')
    const { border: _border, ...withoutBorder } = variants.light.app
    const missing = {
      ...rest,
      variants: { ...variants, light: { ...variants.light, app: withoutBorder } },
    }
    expect(parsePalette(missing, 'user').success).toBe(false)

    const bad = {
      ...rest,
      variants: {
        ...variants,
        light: { ...variants.light, app: { ...variants.light.app, border: 'var(--x)' } },
      },
    }
    expect(parsePalette(bad, 'user').success).toBe(false)
    expect(parsePalette({ ...GRAPHITE_PALETTE_DOCUMENT, id: 'Not Valid' }, 'user').success).toBe(
      false,
    )
  })

  it('accepts hex authoring and a single-mode variant', () => {
    const colors = paletteColorsFor(mustParse(GRAPHITE_PALETTE_DOCUMENT), 'dark')
    const hexApp = Object.fromEntries(
      Object.entries(colors.app).map(([role, color]) => [role, toHex(color)]),
    )
    const hexTerminal = Object.fromEntries(
      Object.entries(colors.terminal).map(([role, color]) => [role, toHex(color)]),
    )
    const palette = mustParse({
      schemaVersion: 1,
      id: 'night-only',
      name: 'Night only',
      variants: { kind: 'single', mode: 'dark', colors: { app: hexApp, terminal: hexTerminal } },
    })
    expect(paletteColorsFor(palette, 'light')).toBe(paletteColorsFor(palette, 'dark'))
    expect(toHex(paletteColorsFor(palette, 'light').app.foreground)).toBe(hexApp.foreground)
  })
})
