import { describe, expect, it } from 'vitest'
import {
  buildHighlightOverlayMask,
  overlayColorStyle,
  splitHighlightOverlay,
} from './highlightOverlay'

const codeUnit = (offset: number) => 'ab😀cdefgh'.charCodeAt(offset)
describe('highlight overlay mask', () => {
  it('combines overlaps using the strongest fade and both decorations', () => {
    const mask = buildHighlightOverlayMask(
      [
        { start: 0, end: 6, overlay: { dim: 0.7, textDecoration: 'underline' } },
        { start: 4, end: 8, overlay: { dim: 0.4, textDecoration: 'line-through' } },
      ],
      10,
      codeUnit,
    )
    expect(mask).toEqual([
      { start: 0, end: 4, overlay: { dim: 0.7, textDecoration: 'underline' } },
      { start: 4, end: 6, overlay: { dim: 0.4, textDecoration: 'underline line-through' } },
      { start: 6, end: 8, overlay: { dim: 0.4, textDecoration: 'line-through' } },
    ])
  })
  it('moves mask edges outside surrogate pairs', () => {
    expect(
      buildHighlightOverlayMask([{ start: 3, end: 4, overlay: { dim: 0.5 } }], 10, codeUnit),
    ).toEqual([{ start: 2, end: 4, overlay: { dim: 0.5 } }])
    expect(
      buildHighlightOverlayMask(
        [{ start: 2, end: 3, overlay: { textDecoration: 'line-through' } }],
        10,
        codeUnit,
      ),
    ).toEqual([{ start: 2, end: 4, overlay: { textDecoration: 'line-through' } }])
  })
  it('merges adjacent identical masks and ignores empty ranges', () => {
    expect(
      buildHighlightOverlayMask(
        [
          { start: 0, end: 2, overlay: { dim: 0.5 } },
          { start: 2, end: 4, overlay: { dim: 0.5 } },
          { start: 6, end: 6, overlay: { dim: 0 } },
        ],
        10,
        codeUnit,
      ),
    ).toEqual([{ start: 0, end: 4, overlay: { dim: 0.5 } }])
  })
  it('splits a color producer only at intersecting mask edges', () => {
    const overlay = { dim: 0.5 }
    expect(
      splitHighlightOverlay(1, 9, [
        { start: 2, end: 4, overlay },
        { start: 6, end: 10, overlay },
      ]),
    ).toEqual([
      { start: 1, end: 2 },
      { start: 2, end: 4, overlay },
      { start: 4, end: 6 },
      { start: 6, end: 9, overlay },
    ])
  })
  it('rejects invalid opacity at the overlay boundary', () => {
    for (const dim of [-1, 2, Number.NaN, Infinity]) {
      expect(() =>
        buildHighlightOverlayMask([{ start: 0, end: 1, overlay: { dim } }], 10, codeUnit),
      ).toThrow()
    }
  })
  it('keeps line keywords contiguous when a decoration carries a style or color', () => {
    const style = overlayColorStyle(
      { color: '#ff0000', textDecoration: 'underline wavy rgb(0 0 0)' },
      { textDecoration: 'line-through' },
    )
    expect(style.textDecoration).toBe('underline line-through wavy rgb(0 0 0)')
    const mask = buildHighlightOverlayMask(
      [
        { start: 0, end: 4, overlay: { textDecoration: 'underline dotted red' } },
        { start: 0, end: 4, overlay: { textDecoration: 'line-through' } },
      ],
      10,
      codeUnit,
    )
    expect(mask[0]?.overlay.textDecoration).toBe('underline line-through dotted red')
  })
})
