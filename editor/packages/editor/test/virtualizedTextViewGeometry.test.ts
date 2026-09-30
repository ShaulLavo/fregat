import { isSimpleRowText } from '../src/textCharacters'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createInlineMap } from '../src/inlineMap'
import { createPieceTableSnapshot } from '../src/public/document'
import { VirtualizedTextView } from '../src/virtualization'
import {
  clearRowGeometryCache,
  knownRowContentWidth,
  measureRowContentWidth,
  offsetToX,
  rangeSegments,
  xToOffset,
} from '../src/virtualization/virtualizedTextViewGeometry'
import type { VirtualizedTextViewInternal } from '../src/virtualization/virtualizedTextViewInternals'
import type { MountedVirtualizedTextRow } from '../src/virtualization/virtualizedTextViewTypes'

const CHARACTER_WIDTH = 7.2266
const ROW_HEIGHT = 20
const WIDE_GLYPH_WIDTH = 15.5
/** Deliberately off the metric the calculated path multiplies, so extrapolation from column zero
 * and a measured advance part company the further along a row they get. */
const MEASURED_ADVANCE = CHARACTER_WIDTH + 0.05

/**
 * Every shape the geometry builders branch on: pure ASCII takes the calculated path, anything else
 * the measured one, and tabs, control characters, an empty row, a row past the anchoring threshold
 * and a row that ends the document all land on boundary cases the two directions have to agree
 * about.
 */
const CORPUS = [
  'z'.repeat(700),
  'const value = 42;',
  'héllo wörld ünïcödé',
  '\ta\tbb\tccc',
  'abc d',
  '',
  '漢字テスト🙂 mixed',
  'tail',
]

function internals(view: VirtualizedTextView): VirtualizedTextViewInternal {
  return Reflect.get(view, 'view') as VirtualizedTextViewInternal
}

function mountView(container: HTMLElement, text: string): VirtualizedTextView {
  const view = new VirtualizedTextView(container, {
    rowHeight: ROW_HEIGHT,
    overscan: 0,
    textMetrics: { characterWidth: CHARACTER_WIDTH, rowHeight: ROW_HEIGHT },
  })
  view.setText(text)
  view.setScrollMetrics(0, ROW_HEIGHT * 40, 4_000)
  return view
}

function textRows(view: VirtualizedTextView): readonly MountedVirtualizedTextRow[] {
  return view.getState().mountedRows.filter((row) => row.kind === 'text')
}

function rowXs(view: VirtualizedTextViewInternal, row: MountedVirtualizedTextRow): number[] {
  const xs: number[] = []
  for (let offset = row.startOffset; offset <= row.endOffset; offset += 1) {
    xs.push(offsetToX(view, row, offset))
  }

  return xs
}

function hitSamples(xs: readonly number[]): number[] {
  const limit = Math.max(...xs, 0) + 24
  const step = Math.max(1.3, limit / 400)
  const samples: number[] = []
  for (let x = -12; x <= limit; x += step) samples.push(x)
  return samples
}

function mockRect(left: number, width: number): DOMRect {
  return {
    bottom: 16,
    height: 16,
    left,
    right: left + width,
    top: 0,
    width,
    x: left,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect
}

function glyphWidth(codePoint: number): number {
  if (codePoint === 9) return MEASURED_ADVANCE * 4
  if (codePoint >= 0x2e80 && codePoint <= 0xa4cf) return WIDE_GLYPH_WIDTH
  if (codePoint >= 0x1f300 && codePoint <= 0x1faff) return WIDE_GLYPH_WIDTH
  return MEASURED_ADVANCE
}

function textWidth(text: string): number {
  let width = 0
  for (const character of text) width += glyphWidth(character.codePointAt(0) ?? 0)
  return width
}

function rowElementFor(node: Node): HTMLElement | null {
  let current: Node | null = node
  while (current) {
    if (current instanceof HTMLElement && current.dataset.editorVirtualRow !== undefined) {
      return current
    }

    current = current.parentNode
  }

  return null
}

/** Width of everything the row renders ahead of a DOM boundary, under the glyph model above. */
function widthBefore(row: HTMLElement, node: Node, offset: number): number {
  let width = 0
  let reached = false

  const visit = (current: Node): void => {
    if (reached) return

    if (current instanceof Text) {
      width += textWidth(current === node ? current.data.slice(0, offset) : current.data)
      if (current === node) reached = true
      return
    }

    const children = [...current.childNodes]
    const limit = current === node ? Math.min(offset, children.length) : children.length
    for (let index = 0; index < limit; index += 1) visit(children[index]!)
    if (current === node) reached = true
  }

  visit(row)
  return width
}

/**
 * happy-dom reports every rect as empty, so nothing would ever take the measured branch. This stands
 * in a deterministic proportional font: wide glyphs advance further than a cell, which is the case
 * the estimate cannot express.
 */
function stubProportionalLayout(): () => void {
  const rangeRects = Range.prototype.getClientRects
  const rangeBounds = Range.prototype.getBoundingClientRect
  const elementBounds = Element.prototype.getBoundingClientRect

  function measureRange(this: Range): DOMRect {
    const row = rowElementFor(this.startContainer)
    if (!row) return mockRect(0, 0)

    const left = widthBefore(row, this.startContainer, this.startOffset)
    const right = widthBefore(row, this.endContainer, this.endOffset)
    return mockRect(left, Math.max(0, right - left))
  }

  Range.prototype.getClientRects = function stubbedClientRects(this: Range) {
    const rect = measureRange.call(this)
    return { item: () => rect, length: 1 } as unknown as DOMRectList
  }
  Range.prototype.getBoundingClientRect = measureRange
  Element.prototype.getBoundingClientRect = function stubbedElementRect(this: Element) {
    if (!(this instanceof HTMLElement)) return elementBounds.call(this)
    if (this.dataset.editorVirtualRow !== undefined) return mockRect(0, 4_000)
    if (this.dataset.editorControlCharacter === undefined) return elementBounds.call(this)

    const row = rowElementFor(this)
    const parent = this.parentNode
    if (!row || !parent) return elementBounds.call(this)

    const index = [...parent.childNodes].indexOf(this)
    return mockRect(widthBefore(row, parent, index), textWidth(this.textContent ?? ''))
  }

  return () => {
    Range.prototype.getClientRects = rangeRects
    Range.prototype.getBoundingClientRect = rangeBounds
    Element.prototype.getBoundingClientRect = elementBounds
  }
}

function widestBoundaryGap(xs: readonly number[]): number {
  let gap = 0
  for (let index = 1; index < xs.length; index += 1)
    gap = Math.max(gap, xs[index]! - xs[index - 1]!)
  return gap
}

/**
 * The two directions have to describe the same row. A hit test on a measured row lands on the
 * nearest boundary; on a calculated row it lands in the cell it was inside, so the strongest shared
 * claim is that no boundary sits closer to the sampled x than the one it answered with, by more
 * than the widest gap between two boundaries in the row.
 */
function expectDirectionsAgree(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
): void {
  const xs = rowXs(view, row)
  for (let index = 1; index < xs.length; index += 1) {
    expect(xs[index]).toBeGreaterThanOrEqual(xs[index - 1]!)
  }

  const calculated = isSimpleRowText(row.text) && !row.inlineMapping
  const tolerance = calculated ? widestBoundaryGap(xs) : 1e-9
  for (const sample of hitSamples(xs)) {
    const offset = xToOffset(view, row, sample)
    expect(offset).toBeGreaterThanOrEqual(row.startOffset)
    expect(offset).toBeLessThanOrEqual(row.endOffset)

    const target = Math.max(0, sample)
    const nearest = Math.min(...xs.map((x) => Math.abs(x - target)))
    const answered = Math.abs(offsetToX(view, row, offset) - target)
    expect(answered).toBeLessThanOrEqual(nearest + tolerance)
  }

  for (let offset = row.startOffset; offset <= row.endOffset; offset += 1) {
    const roundTrip = xToOffset(view, row, offsetToX(view, row, offset))
    expect(offsetToX(view, row, roundTrip)).toBeCloseTo(offsetToX(view, row, offset), 6)
  }
}

describe('virtualized text view geometry', () => {
  let container: HTMLElement
  let view: VirtualizedTextView

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    view.dispose()
    container.remove()
    vi.restoreAllMocks()
  })

  it('maps offsets and x consistently across every row shape without measurement', () => {
    view = mountView(container, CORPUS.join('\n'))
    const rows = textRows(view)

    expect(rows).toHaveLength(CORPUS.length)
    for (const row of rows) expectDirectionsAgree(internals(view), row)
  })

  it('maps offsets and x consistently across every row shape under measurement', () => {
    const restore = stubProportionalLayout()
    try {
      view = mountView(container, CORPUS.join('\n'))
      for (const row of textRows(view)) expectDirectionsAgree(internals(view), row)
    } finally {
      restore()
    }
  })

  it('maps offsets and x consistently on a row carrying an inline mapping', () => {
    const restore = stubProportionalLayout()
    try {
      const text = '# Title\na **bold** b\nplain'
      view = mountView(container, text)
      view.setInlineMap(
        createInlineMap(createPieceTableSnapshot(text), [
          { id: 'heading', startIndex: 0, endIndex: 2, text: '', groupId: 'h1' },
          { id: 'open', startIndex: 10, endIndex: 12, text: '', groupId: 'bold' },
          { id: 'close', startIndex: 16, endIndex: 18, text: '', groupId: 'bold' },
        ]),
      )

      const mapped = textRows(view).filter((row) => row.inlineMapping)
      expect(mapped.length).toBeGreaterThan(0)
      for (const row of textRows(view)) expectDirectionsAgree(internals(view), row)
    } finally {
      restore()
    }
  })

  it('hit tests a row whose measured parts do not advance left to right', () => {
    const text = 'ünïcödé'
    // Advances that run the other way, as a right-to-left run reports them: the boundaries then
    // descend in x while their offsets still ascend, and the x ordering is no longer the offset one.
    vi.spyOn(Range.prototype, 'getClientRects').mockImplementation(function (this: Range) {
      const rect = mockRect((text.length - 1 - this.startOffset) * 9, 9)
      return { item: () => rect, length: 1 } as unknown as DOMRectList
    })

    view = mountView(container, text)
    const internal = internals(view)
    const row = textRows(view)[0]!
    const xs = rowXs(internal, row)

    expect(xs[0]).toBeGreaterThan(xs[1]!)
    for (const sample of [-4, 0, 5, 13.5, 27, 40, 54, 80]) {
      const offset = xToOffset(internal, row, sample)
      const target = Math.max(0, sample)
      const nearest = Math.min(...xs.map((x) => Math.abs(x - target)))
      expect(Math.abs(offsetToX(internal, row, offset) - target)).toBeCloseTo(nearest, 9)
    }
  })

  it('reports range segments through the DOM layout stub', () => {
    const restore = stubProportionalLayout()
    try {
      view = mountView(container, CORPUS.join('\n'))
      const internal = internals(view)
      for (const row of textRows(view)) {
        if (row.endOffset <= row.startOffset) continue

        const segments = rangeSegments(internal, row, row.startOffset, row.endOffset)
        expect(segments).toHaveLength(1)
        const [segment] = segments
        expect(segment!.left).toBeGreaterThanOrEqual(0)
        expect(segment!.width).toBeGreaterThan(0)
      }
    } finally {
      restore()
    }
  })

  it('builds a row whose boundaries already ascend in x without an ordering array', () => {
    const restore = stubProportionalLayout()
    const NativeUint32Array = globalThis.Uint32Array
    let allocated = 0
    try {
      view = mountView(container, CORPUS.join('\n'))
      const internal = internals(view)
      const rows = textRows(view)
      view.setRowDecorations(new Map())
      globalThis.Uint32Array = new Proxy(NativeUint32Array, {
        construct: (target, args, newTarget) => {
          allocated += 1
          return Reflect.construct(target, args, newTarget) as Uint32Array
        },
      })

      for (const row of rows) {
        offsetToX(internal, row, row.startOffset)
        xToOffset(internal, row, 40)
      }

      expect(allocated).toBe(0)
    } finally {
      globalThis.Uint32Array = NativeUint32Array
      restore()
    }
  })

  it('sizes a row boundary buffer once however long the row is', () => {
    const restore = stubProportionalLayout()
    const NativeFloat64Array = globalThis.Float64Array
    let allocated = 0
    try {
      view = mountView(container, ['é'.repeat(40), 'é'.repeat(1_500)].join('\n'))
      const internal = internals(view)
      const rows = textRows(view)
      const short = rows[0]!
      const long = rows[1]!
      globalThis.Float64Array = new Proxy(NativeFloat64Array, {
        construct: (target, args, newTarget) => {
          allocated += 1
          return Reflect.construct(target, args, newTarget) as Float64Array
        },
      })

      offsetToX(internal, short, short.endOffset)
      const shortRowArrays = allocated
      allocated = 0
      offsetToX(internal, long, long.endOffset)

      expect(shortRowArrays).toBeGreaterThan(0)
      expect(allocated).toBe(shortRowArrays)
    } finally {
      globalThis.Float64Array = NativeFloat64Array
      restore()
    }
  })

  it.each(['x', 'é', '\t'])('bounds %s geometry allocation by mounted text', (character) => {
    const restore = stubProportionalLayout()
    const NativeFloat64Array = globalThis.Float64Array
    try {
      view = mountView(container, character.repeat(1_048_576))
      const internal = internals(view)
      const row = textRows(view)[0]!
      const mountedUnits = row.chunks.reduce(
        (total, chunk) => total + chunk.localEnd - chunk.localStart,
        0,
      )
      expect(mountedUnits).toBeLessThan(10_000)
      clearRowGeometryCache(row)
      let allocatedBytes = 0
      globalThis.Float64Array = new Proxy(NativeFloat64Array, {
        construct: (target, args, newTarget) => {
          const array = Reflect.construct(target, args, newTarget) as Float64Array
          allocatedBytes += array.byteLength
          return array
        },
      })

      const start = row.chunks[0]!.startOffset
      const end = row.chunks.at(-1)!.endOffset
      expect(offsetToX(internal, row, end)).toBeGreaterThan(offsetToX(internal, row, start))
      expect(allocatedBytes).toBeGreaterThan(0)
      expect(allocatedBytes).toBeLessThan((mountedUnits + 100) * 64)
      expect(xToOffset(internal, row, offsetToX(internal, row, end))).toBe(end)
    } finally {
      globalThis.Float64Array = NativeFloat64Array
      restore()
    }
  })

  it('leaves the shared measurement range off the row it just measured', async () => {
    const restore = stubProportionalLayout()
    try {
      view = mountView(container, 'ünïcödé rôw wïth mäny gräphemes')
      const internal = internals(view)
      const row = textRows(view)[0]!

      // A fresh module copy has not made its scratch range yet, so the one created below is it.
      vi.resetModules()
      const created: Range[] = []
      const createRange = document.createRange.bind(document)
      vi.spyOn(document, 'createRange').mockImplementation(() => {
        const range = createRange()
        created.push(range)
        return range
      })

      const geometry = await import('../src/virtualization/virtualizedTextViewGeometry')
      geometry.clearRowGeometryCache(row)
      geometry.offsetToX(internal, row, row.endOffset)

      expect(created).toHaveLength(1)
      const scratch = created[0]!
      expect(row.element.contains(scratch.startContainer)).toBe(false)
      expect(row.element.contains(scratch.endContainer)).toBe(false)

      geometry.clearRowGeometryCache(row)
      geometry.measureRowContentWidth(internal, row)

      expect(created).toHaveLength(1)
      expect(row.element.contains(scratch.startContainer)).toBe(false)
      expect(row.element.contains(scratch.endContainer)).toBe(false)
    } finally {
      restore()
    }
  })

  it('takes measured advances back out of a scaled host space', () => {
    const restore = stubProportionalLayout()
    try {
      view = mountView(container, 'ünïcödé')
      const internal = internals(view)
      const row = textRows(view)[0]!
      const unscaled = offsetToX(internal, row, row.endOffset)

      // The stubbed rects report 4000px across the row; a layout box half that wide is what a host
      // scaled by two looks like from here.
      Object.defineProperty(row.element, 'offsetWidth', { configurable: true, value: 2_000 })
      view.setRowDecorations(new Map())

      expect(offsetToX(internal, row, row.endOffset)).toBeCloseTo(unscaled / 2, 6)
    } finally {
      restore()
    }
  })

  it('reads an untransformed host at face value when its layout box rounds', () => {
    const restore = stubProportionalLayout()
    try {
      view = mountView(container, 'ünïcödé')
      const internal = internals(view)
      const row = textRows(view)[0]!
      const unscaled = offsetToX(internal, row, row.endOffset)

      // Nothing scales this row: the layout box is the same box the rect describes, reported to the
      // whole pixel it rounds to.
      row.element.getBoundingClientRect = () => mockRect(0, 100.9)
      Object.defineProperty(row.element, 'offsetWidth', { configurable: true, value: 100 })
      view.setRowDecorations(new Map())

      expect(offsetToX(internal, row, row.endOffset)).toBeCloseTo(unscaled, 6)
    } finally {
      restore()
    }
  })

  it('anchors a long calculated row on measured advances instead of extrapolating from zero', () => {
    const restore = stubProportionalLayout()
    try {
      view = mountView(container, 'x'.repeat(1_200))
      const internal = internals(view)
      const row = textRows(view)[0]!
      const column = 900
      const drifted = column * CHARACTER_WIDTH

      expect(row.chunks).toHaveLength(1)
      expect(offsetToX(internal, row, column)).toBeCloseTo(column * MEASURED_ADVANCE, 1)
      expect(offsetToX(internal, row, column) - drifted).toBeGreaterThan(1)
    } finally {
      restore()
    }
  })

  it('lands a click between two anchors on a column the anchor before it owns', () => {
    const restore = stubProportionalLayout()
    try {
      view = mountView(container, 'x'.repeat(1_200))
      const internal = internals(view)
      const row = textRows(view)[0]!

      // Re-anchoring on a measured advance leaves the extrapolated end of one
      // span short of the next anchor. An x in that gap belongs to the last
      // column of the span it fell in, not to a column past it.
      const lastOfSpan = offsetToX(internal, row, 299)
      const nextAnchor = offsetToX(internal, row, 300)

      expect(nextAnchor).toBeGreaterThan(lastOfSpan)
      for (const x of [lastOfSpan + 1, (lastOfSpan + nextAnchor) / 2, nextAnchor - 0.1]) {
        expect(xToOffset(internal, row, x)).toBe(299)
      }
      // ...and the mapping stays monotone across the seam.
      expect(xToOffset(internal, row, nextAnchor)).toBe(300)
    } finally {
      restore()
    }
  })

  it('keeps an anchored row monotone under a scaled host', () => {
    const restore = stubProportionalLayout()
    try {
      view = mountView(container, 'x'.repeat(1_200))
      const internal = internals(view)
      const row = textRows(view)[0]!
      Object.defineProperty(row.element, 'offsetWidth', { configurable: true, value: 2_000 })
      view.setRowDecorations(new Map())

      // The anchors are read back in the row's own space; extending them with a
      // cell width measured through the scaled host would step backwards at
      // every anchor.
      let previous = -Infinity
      for (let column = 0; column <= 1_200; column += 1) {
        const x = offsetToX(internal, row, column)
        expect(x).toBeGreaterThanOrEqual(previous)
        previous = x
      }
    } finally {
      restore()
    }
  })

  it('inverts an anchored long row through the same anchors', () => {
    const restore = stubProportionalLayout()
    try {
      view = mountView(container, 'x'.repeat(1_200))
      const internal = internals(view)
      const row = textRows(view)[0]!

      for (const column of [0, 299, 300, 601, 900, 1_199]) {
        expect(xToOffset(internal, row, offsetToX(internal, row, column))).toBe(column)
      }
    } finally {
      restore()
    }
  })

  it('carries a measured row width past the columns its glyphs are counted as', () => {
    const restore = stubProportionalLayout()
    try {
      view = mountView(container, '漢字テスト')
      const internal = internals(view)
      const row = textRows(view)[0]!
      const glyphsEnd = offsetToX(internal, row, row.endOffset)

      expect(glyphsEnd).toBeGreaterThan(5 * 2 * CHARACTER_WIDTH)
      // Asking for one column reads one advance, which says nothing about where the row ends — so
      // the width is still only available for the price of a layout read.
      expect(knownRowContentWidth(internal, row)).toBeNull()
      expect(measureRowContentWidth(internal, row)).toBeGreaterThanOrEqual(glyphsEnd)
      expect(knownRowContentWidth(internal, row)).toBeGreaterThanOrEqual(glyphsEnd)
    } finally {
      restore()
    }
  })

  it('measures a row content width once per row key', () => {
    const restore = stubProportionalLayout()
    try {
      view = mountView(container, '漢字テスト')
      const internal = internals(view)
      const row = textRows(view)[0]!
      const width = measureRowContentWidth(internal, row)
      const rects = vi.spyOn(Range.prototype, 'getBoundingClientRect')

      expect(measureRowContentWidth(internal, row)).toBe(width)
      expect(rects).not.toHaveBeenCalled()
    } finally {
      restore()
    }
  })

  it('forgets a measured width when the element is recycled onto another line', () => {
    const restore = stubProportionalLayout()
    try {
      view = mountView(container, '漢字テスト漢字テスト')
      const internal = internals(view)
      const wide = textRows(view)[0]!
      const wideWidth = measureRowContentWidth(internal, wide)

      view.setText('ünïcödé')
      const narrow = textRows(view)[0]!

      expect(narrow.element).toBe(wide.element)
      expect(knownRowContentWidth(internal, narrow)).toBeNull()
      expect(measureRowContentWidth(internal, narrow)).toBeLessThan(wideWidth)
    } finally {
      restore()
    }
  })

  // Scrolling a long document is where an element changes lines without the text changing under it:
  // the revision, the length and the chunking of the line it measured all survive the move, so
  // nothing but where the row starts tells the two lines apart.
  it('forgets a measured width when a scroll recycles the element onto another line', () => {
    const restore = stubProportionalLayout()
    try {
      const lines = ['ééééé', ...Array.from({ length: 79 }, () => '漢字漢字漢')]
      view = mountView(container, lines.join('\n'))
      const internal = internals(view)
      const latin = textRows(view)[0]!
      const latinElement = latin.element
      const latinWidth = measureRowContentWidth(internal, latin)
      expect(latin.text).toBe('ééééé')

      view.setScrollMetrics(ROW_HEIGHT * 40, ROW_HEIGHT * 40, 4_000)
      const recycled = textRows(view).find((row) => row.element === latinElement)

      expect(recycled?.text).toBe('漢字漢字漢')
      expect(knownRowContentWidth(internal, recycled!)).not.toBe(latinWidth)
      expect(measureRowContentWidth(internal, recycled!)).toBeGreaterThan(latinWidth)
    } finally {
      restore()
    }
  })

  it('grows the horizontal content width to a wide row measured width', async () => {
    const restore = stubProportionalLayout()
    try {
      view = mountView(container, '漢字テスト')
      const estimated = view.getState().contentWidth

      await new Promise((resolve) => {
        setTimeout(resolve, 0)
      })

      expect(estimated).toBeLessThan(Math.ceil(5 * WIDE_GLYPH_WIDTH))
      expect(view.getState().contentWidth).toBeGreaterThanOrEqual(Math.ceil(5 * WIDE_GLYPH_WIDTH))
    } finally {
      restore()
    }
  })
})
