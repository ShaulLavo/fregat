import type { EditorViewSnapshot } from '@singapore-editor/core'
import { describe, expect, it } from 'vitest'

import { capOverscrollTop } from '@/features/editor/utils/scroll-position'

// Only the geometry the cap reads; the rest of the snapshot never enters the math.
function snapshotWith(geometry: { totalHeight: number; clientHeight: number }): EditorViewSnapshot {
  return {
    totalHeight: geometry.totalHeight,
    viewport: { clientHeight: geometry.clientHeight },
  } as EditorViewSnapshot
}

describe('capOverscrollTop', () => {
  it('caps an overscrolled offset so the bottom row rests on the viewport bottom', () => {
    const snapshot = snapshotWith({ totalHeight: 2000, clientHeight: 600 })

    // Overscroll allows top up to ~totalHeight - lastRowHeight; the persisted
    // value must stop at totalHeight - clientHeight.
    expect(capOverscrollTop(1980, snapshot)).toBe(1400)
  })

  it('keeps offsets at or below the cap untouched', () => {
    const snapshot = snapshotWith({ totalHeight: 2000, clientHeight: 600 })

    expect(capOverscrollTop(0, snapshot)).toBe(0)
    expect(capOverscrollTop(700, snapshot)).toBe(700)
    expect(capOverscrollTop(1400, snapshot)).toBe(1400)
  })

  it('caps to zero when the document fits inside the viewport', () => {
    const snapshot = snapshotWith({ totalHeight: 300, clientHeight: 600 })

    expect(capOverscrollTop(250, snapshot)).toBe(0)
  })

  it('leaves the offset alone when geometry is degenerate or missing', () => {
    expect(capOverscrollTop(500, null)).toBe(500)
    expect(capOverscrollTop(500, snapshotWith({ totalHeight: 0, clientHeight: 600 }))).toBe(500)
    expect(capOverscrollTop(500, snapshotWith({ totalHeight: 2000, clientHeight: 0 }))).toBe(500)
  })
})
