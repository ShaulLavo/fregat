import { bundledPalette, parsePalette, SAGE_PALETTE_DOCUMENT } from '@workspace/contracts'
import { describe, expect, it } from 'vitest'

import { paletteStylesheet, resolvePalette } from '../palette'

const graphite = bundledPalette('graphite')!
const sage = bundledPalette('sage')!

function mustParse(document: unknown) {
  const result = parsePalette(document, 'user')
  if (!result.success) throw new TypeError('expected the palette to parse')

  return result.palette
}

describe('resolvePalette', () => {
  it('emits the variables globals.css used to declare, verbatim', () => {
    const light = resolvePalette(graphite, 'light')
    expect(light.cssVariables['--background-solid']).toBe('oklch(0.97 0.006 70)')
    // L=1 with any chroma sits outside sRGB; the browser would map it to the
    // same white, so the clipped value is what globals.css painted.
    expect(light.cssVariables['--card-solid']).toBe('oklch(1 0 70)')
    expect(light.cssVariables['--primary']).toBe('oklch(0.24 0.014 70)')
    expect(light.cssVariables['--muted-solid']).toBe('oklch(0.94 0.006 70)')
    expect(light.cssVariables['--card-light-solid']).toBe('oklch(1 0 70)')
    expect(light.cssVariables['--card-dark-solid']).toBe('oklch(0.205 0.006 70)')

    const dark = resolvePalette(graphite, 'dark')
    expect(dark.cssVariables['--border']).toBe('oklch(1 0 0 / 0.1)')
    expect(dark.cssVariables['--input']).toBe('oklch(1 0 0 / 0.15)')
    expect(dark.cssVariables['--card-solid']).toBe('oklch(0.205 0.006 70)')

    const sageDark = resolvePalette(sage, 'dark')
    expect(sageDark.cssVariables['--primary']).toBe('oklch(0.72 0.1 175)')
    expect(sageDark.cssVariables['--card-light-solid']).toBe('oklch(1 0 0)')
  })

  it('never emits a variable outside the closed token set', () => {
    const names = Object.keys(resolvePalette(graphite, 'dark').cssVariables)
    expect(names).toHaveLength(33)
    expect(names.every((name) => name.startsWith('--'))).toBe(true)
    expect(names).not.toContain('--row-hover')
    expect(names).not.toContain('--terminal-foreground')
  })

  it('gives the terminal typed sRGB values', () => {
    const { terminal } = resolvePalette(graphite, 'dark')
    expect(terminal.foreground).toEqual({ r: 215, g: 221, b: 229, alpha: 1 })
    expect(terminal.ansi).toHaveLength(16)
    expect(terminal.ansi[1]).toEqual({ r: 255, g: 95, b: 87, alpha: 1 })
    expect(terminal.ansi[15]).toEqual({ r: 255, g: 255, b: 255, alpha: 1 })
  })

  it('hashes by content, so two dark palettes differ and a re-parse does not', () => {
    const graphiteDark = resolvePalette(graphite, 'dark')
    const sageDark = resolvePalette(sage, 'dark')
    expect(graphiteDark.contentHash).not.toBe(sageDark.contentHash)
    const reparsed = mustParse(SAGE_PALETTE_DOCUMENT)
    expect(resolvePalette(reparsed, 'dark').contentHash).toBe(sageDark.contentHash)
    expect(resolvePalette(graphite, 'light').contentHash).not.toBe(graphiteDark.contentHash)
  })

  it('answers the only variant of a single-mode palette for either mode', () => {
    const single = mustParse({
      ...SAGE_PALETTE_DOCUMENT,
      id: 'sage-dark',
      variants: { kind: 'single', mode: 'dark', colors: SAGE_PALETTE_DOCUMENT.variants.dark },
    })
    const asLight = resolvePalette(single, 'light')
    expect(asLight.mode).toBe('light')
    expect(asLight.variantMode).toBe('dark')
    expect(asLight.cssVariables['--background-solid']).toBe('oklch(0.17 0.01 260)')
    expect(asLight.cssVariables['--card-light-solid']).toBe(
      asLight.cssVariables['--card-dark-solid'],
    )
  })
})

describe('paletteStylesheet', () => {
  it('writes both modes under :root and :root.dark', () => {
    const css = paletteStylesheet(sage)
    expect(css.startsWith(':root {\n')).toBe(true)
    expect(css).toContain('\n:root.dark {\n')
    expect(css).toContain('  --background-solid: oklch(0.98 0.003 90);')
    expect(css).toContain('  --background-solid: oklch(0.17 0.01 260);')
    expect(css.endsWith('}\n')).toBe(true)
  })
})
