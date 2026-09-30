import { describe, expect, it } from 'vitest'
import { runRasterPixelOracle } from './raster-pixel-oracle'

describe.skipIf(
  typeof OffscreenCanvas === 'undefined' || !new OffscreenCanvas(1, 1).getContext('2d'),
)('minimap raster reuse', () => {
  it('matches complete repaints through scrolling and invalidation', () => {
    const result = runRasterPixelOracle()
    expect(result.cases).toBe(24)
    expect(result.frames).toBe(594)
    expect(result.comparedBytes).toBeGreaterThan(0)
  })
})
