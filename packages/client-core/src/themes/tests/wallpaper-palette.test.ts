import { bundledPalette, oklch, paletteColorsFor, type WallpaperColors } from '@workspace/contracts'
import { describe, expect, it } from 'vitest'

import { contrastFailures } from '../palette-editing'
import { paletteFromWallpaperColors, wallpaperMatchScore } from '../wallpaper-palette'

const graphite = bundledPalette('graphite')!

function clusters(...entries: readonly [number, number, number, number][]): WallpaperColors {
  return { clusters: entries.map(([l, c, h, weight]) => ({ color: oklch(l, c, h), weight })) }
}

const forest = clusters([0.3, 0.05, 150, 0.5], [0.55, 0.12, 140, 0.3], [0.85, 0.18, 90, 0.2])
const dusk = clusters([0.2, 0.08, 280, 0.6], [0.7, 0.2, 20, 0.25], [0.95, 0.01, 0, 0.15])
const snow = clusters([0.97, 0.005, 230, 0.8], [0.4, 0.02, 230, 0.2])

describe('colors from a wallpaper', () => {
  it.each([
    ['forest', forest],
    ['dusk', dusk],
    ['snow', snow],
  ])('%s yields readable app colors in both modes', (_name, colors) => {
    for (const mode of ['light', 'dark'] as const) {
      const palette = paletteFromWallpaperColors(colors, mode, paletteColorsFor(graphite, mode))
      expect(contrastFailures(palette)).toEqual([])
      expect(palette.app.background.l < 0.5).toBe(mode === 'dark')
    }
  })

  it('takes the accent hue from the most colorful cluster', () => {
    const palette = paletteFromWallpaperColors(dusk, 'dark', paletteColorsFor(graphite, 'dark'))
    expect(Math.abs(palette.app.primary.h - 20)).toBeLessThan(5)
  })

  it('ranks a wallpaper by how near its colors are to the palette', () => {
    const palette = paletteFromWallpaperColors(forest, 'dark', paletteColorsFor(graphite, 'dark'))
    const own = wallpaperMatchScore(forest, palette.app.background, palette.app.primary)
    const other = wallpaperMatchScore(dusk, palette.app.background, palette.app.primary)
    expect(own).toBeLessThan(other)
  })
})
