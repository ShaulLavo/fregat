import { bundledPalette, paletteColorsFor, parseColor, toHex } from '@workspace/contracts'
import { describe, expect, it } from 'vitest'

import {
  contrastFailures,
  deriveFromAccent,
  deriveFromBackground,
  duplicatePalette,
  editableModes,
  paletteIdFromName,
  setPaletteColor,
} from '../palette-editing'

const graphite = bundledPalette('graphite')!
const dark = paletteColorsFor(graphite, 'dark')
const light = paletteColorsFor(graphite, 'light')

describe('palette editing', () => {
  it('derives Graphite from its own background and accent', () => {
    const fromDark = deriveFromBackground(dark, dark.app.background)
    expect(toHex(fromDark.app.card)).toBe(toHex(dark.app.card))
    expect(toHex(fromDark.app.muted)).toBe(toHex(dark.app.muted))
    expect(toHex(fromDark.app.foreground)).toBe(toHex(dark.app.foreground))
    expect(fromDark.app.border.alpha).toBe(0.1)

    const fromLight = deriveFromBackground(light, light.app.background)
    expect(toHex(fromLight.app.card)).toBe(toHex(light.app.card))
    expect(toHex(fromLight.app.border)).toBe(toHex(light.app.border))

    const accent = deriveFromAccent(light, light.app.primary)
    expect(toHex(accent.app['primary-foreground'])).toBe(toHex(light.app['primary-foreground']))
  })

  it('picks a readable primary text for a vivid accent', () => {
    const teal = parseColor('oklch(0.47 0.08 170)')!
    const derived = deriveFromAccent(light, teal)
    expect(derived.app['primary-foreground'].l).toBeCloseTo(0.985, 3)
    const lime = parseColor('oklch(0.9 0.2 130)')!
    expect(deriveFromAccent(light, lime).app['primary-foreground'].l).toBeCloseTo(0.205, 3)
  })

  it('passes Graphite in both modes and flags an unreadable edit', () => {
    expect(contrastFailures(light)).toEqual([])
    expect(contrastFailures(dark)).toEqual([])
    // Graphite's old success fill: its badge text measured 4.38:1, a near miss the readout must catch.
    const oldSuccess = parseColor('oklch(0.55 0.17 165)')!
    const nearMiss = setPaletteColor(graphite, 'light', 'app', 'success', oldSuccess)
    expect(
      contrastFailures(paletteColorsFor(nearMiss, 'light')).map((failure) => failure.foreground),
    ).toEqual(['success-foreground'])
    const broken = setPaletteColor(graphite, 'dark', 'app', 'foreground', dark.app.background)
    const failures = contrastFailures(paletteColorsFor(broken, 'dark'))
    expect(failures.map((failure) => failure.foreground)).toContain('foreground')
    expect(failures[0]?.ratio).toBeLessThan(1.1)
  })

  it('copies without provenance, edits one variant only, and slugs a unique id', () => {
    const copy = duplicatePalette(
      { ...graphite, provenance: { kind: 'omarchy', repository: 'r', commit: 'c', theme: 't' } },
      'mine',
      'Mine',
    )
    expect(copy).toMatchObject({ id: 'mine', name: 'Mine', source: 'user' })
    expect(copy.provenance).toBeUndefined()

    const red = parseColor('#ff0000')!
    const edited = setPaletteColor(copy, 'dark', 'terminal', 'red', red)
    expect(paletteColorsFor(edited, 'dark').terminal.red).toEqual(red)
    expect(paletteColorsFor(edited, 'light').terminal.red).toEqual(light.terminal.red)
    expect(editableModes(edited)).toEqual(['light', 'dark'])

    expect(paletteIdFromName('My Palette!', [])).toBe('my-palette')
    expect(paletteIdFromName('Graphite', ['graphite', 'graphite-2'])).toBe('graphite-3')
    expect(paletteIdFromName('???', [])).toBe('palette')
  })
})
