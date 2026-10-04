import { describe, expect, it, vi } from 'vitest'
import { StampCache } from './stamp-cache.js'
import { StampStorageFixture } from './tests/stamp-storage.js'
import type { GlyphBitmap } from '../atlas/types.js'

function bitmap(kind: 'color' | 'grayscale' = 'grayscale'): GlyphBitmap {
  return {
    width: 2,
    height: 2,
    kind,
    offsetX: -1,
    offsetY: 3,
    pixels: Uint8Array.from(
      kind === 'grayscale'
        ? [0, 64, 128, 255]
        : [255, 3, 21, 128, 11, 39, 220, 255, 91, 0, 30, 1, 0, 0, 0, 0],
    ),
  }
}

describe('resident GPU-model stamps', () => {
  it.each(['color', 'grayscale'] as const)(
    'retains model-classified %s bytes verbatim, and warm hits do zero source work',
    (kind) => {
      const storage = new StampStorageFixture()
      const cache = new StampCache(storage)
      cache.resize(10, 10)
      const source = bitmap(kind)
      const raster = vi.fn(() => source)
      const stamp = cache.get('owner', raster)!
      expect(new Uint8Array(storage.memory.buffer, stamp.offset, stamp.bytes)).toEqual(
        source.pixels,
      )
      expect(stamp.encoding).toBe(kind === 'color' ? 'rgba' : 'a8')
      const before = { ...cache.metrics }
      const next = cache.get('owner', raster)
      expect(next).toBe(stamp)
      expect(raster).toHaveBeenCalledTimes(1)
      expect(cache.metrics).toEqual({ ...before, hits: before.hits + 1 })
      cache.dispose()
    },
  )

  it('retains offsets across growth and bounds payload and empty-entry residency', () => {
    const storage = new StampStorageFixture()
    const cache = new StampCache(storage)
    cache.resize(2, 2)
    const first = cache.get('first', () => bitmap())!
    storage.memory.grow(1)
    expect(cache.get('first', () => bitmap())).toBe(first)
    expect([...new Uint8Array(storage.memory.buffer, first.offset, first.bytes)]).toEqual([
      0, 64, 128, 255,
    ])
    for (let i = 0; i < 50; i++) cache.get(`${i}`, () => undefined)
    expect(cache.metrics.residentEntries).toBe(1)
    expect(cache.metrics.residentBytes).toBe(0)
    cache.clear()
    expect(cache.metrics.residentEntries).toBe(0)
  })

  it('keeps failed misses retryable and rejects malformed model bytes', () => {
    const storage = new StampStorageFixture()
    const cache = new StampCache(storage)
    cache.resize(8, 8)
    expect(() => cache.get('bad', () => ({ ...bitmap(), pixels: new Uint8Array(3) }))).toThrow()
    expect(cache.metrics.residentEntries).toBe(0)
    expect(cache.get('bad', () => bitmap())).toBeDefined()
    const failure = new TypeError('external raster failure')
    expect(() =>
      cache.get('failed', () => {
        throw failure
      }),
    ).toThrow(failure)
    expect(cache.get('failed', () => bitmap())).toBeDefined()
    cache.dispose()
  })
})
