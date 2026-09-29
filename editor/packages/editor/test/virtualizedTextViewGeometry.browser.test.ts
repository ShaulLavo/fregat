import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import '../src/style.css'

import { createInlineMap, type InlineReplacementSpec } from '../src/inlineMap'
import { createPieceTableSnapshot } from '../src/public/document'
import { VirtualizedTextView } from '../src/virtualization'
import { clearBrowserTextMetricsCache } from '../src/virtualization/browserMetrics'
import {
  beginRowRectMeasurements,
  clearRowGeometryCache,
  endRowRectMeasurements,
  invalidateRowRectMeasurements,
  offsetToX,
  xToOffset,
} from '../src/virtualization/virtualizedTextViewGeometry'
import type { VirtualizedTextViewInternal } from '../src/virtualization/virtualizedTextViewInternals'

const ASCII_LINE = 'const value = 42;'
const SCALE = 2
/** Non-ASCII, so the row is measured through the DOM rather than multiplied out arithmetically. */
const WIDE_LINE = '日本語の段落です。'.repeat(30)

/**
 * Every advance a row reads comes back through a Range, so counting those calls counts exactly the
 * work a column costs — which is the thing under test here, not the number that comes out.
 */
function countRangeReads(run: () => void): number {
  const rects = Range.prototype.getClientRects
  const bounding = Range.prototype.getBoundingClientRect
  let reads = 0
  Range.prototype.getClientRects = function getClientRects(this: Range) {
    reads += 1
    return rects.call(this)
  }
  Range.prototype.getBoundingClientRect = function getBoundingClientRect(this: Range) {
    reads += 1
    return bounding.call(this)
  }
  try {
    run()
  } finally {
    Range.prototype.getClientRects = rects
    Range.prototype.getBoundingClientRect = bounding
  }

  return reads
}

/** The row's other layout read: `offsetWidth`, which recovers a scaled host's transform factor. */
function countOffsetWidthReads(run: () => void): number {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')
  if (!descriptor?.get) throw new Error('offsetWidth is not an accessor on this engine')

  const read = descriptor.get
  let reads = 0
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    ...descriptor,
    get(this: HTMLElement) {
      reads += 1
      return read.call(this)
    },
  })
  try {
    run()
  } finally {
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', descriptor)
  }

  return reads
}

function internals(view: VirtualizedTextView): VirtualizedTextViewInternal {
  return Reflect.get(view, 'view') as VirtualizedTextViewInternal
}

/**
 * A host that scales what it contains is the one case where the space a measurement arrives in and
 * the space the geometry is consumed in come apart, and only a real engine reports the difference:
 * everywhere else the client rects and the layout boxes are the same numbers.
 */
describe.skipIf(typeof globalThis.Highlight === 'undefined')(
  'virtualized text view geometry under a scaled host',
  () => {
    let container: HTMLElement
    let view: VirtualizedTextView | null

    beforeEach(() => {
      container = document.createElement('div')
      container.style.height = '120px'
      container.style.width = '360px'
      container.style.transformOrigin = '0 0'
      container.style.transform = `scale(${SCALE})`
      document.body.appendChild(container)
      // The metrics are probed through the host, so they have to be probed through this one.
      clearBrowserTextMetricsCache()
      view = new VirtualizedTextView(container, { rowHeight: 20, overscan: 0 })
      view.setText(ASCII_LINE)
      view.setScrollMetrics(0, 40)
    })

    afterEach(() => {
      view?.dispose()
      container.remove()
      clearBrowserTextMetricsCache()
      view = null
    })

    it('places a short row’s columns in the row’s own space', () => {
      const row = view!.getState().mountedRows[0]!
      const upToColumn = document.createRange()
      upToColumn.setStart(row.chunks[0]!.textNode, 0)
      upToColumn.setEnd(row.chunks[0]!.textNode, 10)
      const drawn =
        (upToColumn.getBoundingClientRect().right - row.element.getBoundingClientRect().left) /
        SCALE

      expect(drawn).toBeGreaterThan(0)
      expect(offsetToX(internals(view!), row, 10)).toBeCloseTo(drawn, 0)
    })

    it('inverts a short row through the cell width it was placed with', () => {
      const internal = internals(view!)
      const row = view!.getState().mountedRows[0]!

      for (const column of [1, 5, 10, ASCII_LINE.length]) {
        expect(xToOffset(internal, row, offsetToX(internal, row, column))).toBe(column)
      }
    })

    it('recovers the transform once per measurement window, not once per rebuild', () => {
      const internal = internals(view!)
      const row = view!.getState().mountedRows[0]!

      clearRowGeometryCache(row)
      const alone = offsetToX(internal, row, 10)

      beginRowRectMeasurements()
      try {
        const reads = countOffsetWidthReads(() => {
          for (let rebuild = 0; rebuild < 4; rebuild += 1) {
            clearRowGeometryCache(row)
            expect(offsetToX(internal, row, 10)).toBeCloseTo(alone, 5)
          }
        })

        expect(reads).toBe(1)
      } finally {
        endRowRectMeasurements()
      }
    })

    it('reads the transform again once a moved row invalidates the window', () => {
      const internal = internals(view!)
      const row = view!.getState().mountedRows[0]!

      beginRowRectMeasurements()
      try {
        const reads = countOffsetWidthReads(() => {
          clearRowGeometryCache(row)
          offsetToX(internal, row, 10)
          invalidateRowRectMeasurements()
          clearRowGeometryCache(row)
          offsetToX(internal, row, 10)
        })

        expect(reads).toBe(2)
      } finally {
        endRowRectMeasurements()
      }
    })
  },
)

describe.skipIf(typeof globalThis.Highlight === 'undefined')(
  'virtualized text view geometry reads advances on demand',
  () => {
    let container: HTMLElement
    let view: VirtualizedTextView | null

    beforeEach(() => {
      container = document.createElement('div')
      container.style.height = '120px'
      container.style.width = '360px'
      document.body.appendChild(container)
      view = new VirtualizedTextView(container, { rowHeight: 20, overscan: 0 })
      view.setText(WIDE_LINE)
      view.setScrollMetrics(0, 40)
    })

    afterEach(() => {
      view?.dispose()
      container.remove()
      view = null
    })

    it('costs one advance for one column, not one per grapheme in the row', () => {
      const internal = internals(view!)
      const row = view!.getState().mountedRows[0]!

      expect(row.text.length).toBeGreaterThan(200)
      const reads = countRangeReads(() => {
        offsetToX(internal, row, row.startOffset + 120)
      })

      expect(reads).toBeLessThanOrEqual(2)
    })

    it('keeps what it read, so the same column is free the second time', () => {
      const internal = internals(view!)
      const row = view!.getState().mountedRows[0]!
      offsetToX(internal, row, row.startOffset + 120)

      const reads = countRangeReads(() => {
        offsetToX(internal, row, row.startOffset + 120)
      })

      expect(reads).toBe(0)
    })

    it('spends a read per column asked and no more across a scattered walk', () => {
      const internal = internals(view!)
      const row = view!.getState().mountedRows[0]!
      const columns = [10, 40, 90, 150, 210]

      const reads = countRangeReads(() => {
        for (const column of columns) offsetToX(internal, row, row.startOffset + column)
      })

      expect(reads).toBeLessThanOrEqual(columns.length * 2)
      expect(reads).toBeLessThan(row.text.length / 4)
    })

    it('answers with the advance the engine reports, one column at a time', () => {
      const internal = internals(view!)
      const row = view!.getState().mountedRows[0]!
      const node = row.chunks[0]!.textNode
      const rowLeft = row.element.getBoundingClientRect().left

      for (const column of [3, 17, 64, 121]) {
        const upTo = document.createRange()
        upTo.setStart(node, 0)
        upTo.setEnd(node, column)
        expect(offsetToX(internal, row, row.startOffset + column)).toBeCloseTo(
          upTo.getBoundingClientRect().right - rowLeft,
          0,
        )
      }
    })

    /**
     * A boundary two advances meet at belongs to the later of them. Reading columns one at a time
     * has to land on the same value as reading the row through, or a caret placed by one path and a
     * selection edge drawn by the other disagree about the same column.
     */
    it('places a column the same whether it is read alone or with the whole row', () => {
      const internal = internals(view!)
      const row = view!.getState().mountedRows[0]!
      const columns = [0, 1, 8, 33, 100, 209, row.text.length]

      const alone = columns.map((column) => {
        clearRowGeometryCache(row)
        return offsetToX(internal, row, row.startOffset + column)
      })

      clearRowGeometryCache(row)
      // An x→offset question cannot be bounded to one column, so it reads the row through first.
      xToOffset(internal, row, 40)
      expect(columns.map((column) => offsetToX(internal, row, row.startOffset + column))).toEqual(
        alone,
      )
    })

    it('reads the row through only for the question that needs the whole row', () => {
      const internal = internals(view!)
      const row = view!.getState().mountedRows[0]!

      const reads = countRangeReads(() => {
        xToOffset(internal, row, 40)
      })

      expect(reads).toBeGreaterThan(row.text.length / 2)
    })
  },
)

const WIDGET_LINE = 'a ![img](x.png) b'
const WIDGET_START = 2
const WIDGET_END = 15
/** What the node is worth when it mounts, and what it settles on once its content arrives. */
const MOUNTED_WIDTH = 61.5
const SETTLED_WIDTH = 261.5

/**
 * A replacement that grows after it is painted is every image, chart and colour swatch a provider
 * hands over: the node mounts at whatever its placeholder is worth and reaches its real size a
 * frame or a network round trip later. Only a real engine lays the row out around it, so only here
 * can the extent and the caret be checked against the pixels the row actually occupies.
 */
describe.skipIf(typeof globalThis.Highlight === 'undefined')(
  'virtualized text view geometry after an inline replacement settles on its size',
  () => {
    let container: HTMLElement
    let view: VirtualizedTextView | null
    let boxes: HTMLElement[]

    const text = `${WIDGET_LINE}\nplain`

    const imageSpec = (): InlineReplacementSpec => ({
      id: 'image',
      startIndex: WIDGET_START,
      endIndex: WIDGET_END,
      text: 'IMG',
      render: (host: HTMLElement) => {
        const box = host.ownerDocument.createElement('span')
        box.style.display = 'inline-block'
        box.style.height = '16px'
        box.style.width = `${MOUNTED_WIDTH}px`
        host.append(box)
        boxes.push(box)
        return { dispose: () => {} }
      },
    })

    beforeEach(() => {
      boxes = []
      container = document.createElement('div')
      container.style.height = '120px'
      container.style.width = '600px'
      document.body.appendChild(container)
      clearBrowserTextMetricsCache()
      view = new VirtualizedTextView(container, { rowHeight: 20, overscan: 0 })
      view.setText(text)
      view.setScrollMetrics(0, 120, 600)
      view.setInlineMap(createInlineMap(createPieceTableSnapshot(text), [imageSpec()]))
    })

    afterEach(() => {
      view?.dispose()
      container.remove()
      clearBrowserTextMetricsCache()
      view = null
    })

    it('grows the horizontal extent with the node', async () => {
      await settleContentWidth(view!)
      const mounted = paintedRowWidth(view!)

      boxes[0]!.style.width = `${SETTLED_WIDTH}px`
      await settleContentWidth(view!)

      // Everything past the replacement is unreachable without this: a row is `contain: layout
      // paint size`, so the extent is what the reader can scroll to, not just what fits.
      expect(paintedRowWidth(view!)).toBeCloseTo(mounted + (SETTLED_WIDTH - MOUNTED_WIDTH), 0)
      expect(view!.getState().contentWidth).toBeCloseTo(paintedRowWidth(view!), 0)
    })

    it('moves the caret with the columns the node pushed along', async () => {
      view!.focusInput()
      view!.setSelection(WIDGET_LINE.length, WIDGET_LINE.length)
      const before = caretX(container)

      boxes[0]!.style.width = `${SETTLED_WIDTH}px`

      await expect
        .poll(() => caretX(container))
        .toBeCloseTo(before + (SETTLED_WIDTH - MOUNTED_WIDTH), 0)
    })
  },
)

/** Measuring the extent is deferred work, so it arrives at the painted width a frame or two late. */
async function settleContentWidth(view: VirtualizedTextView): Promise<void> {
  await expect
    .poll(() => Math.abs(view.getState().contentWidth - paintedRowWidth(view)))
    .toBeLessThan(1)
}

/** What the row paints, read off the engine rather than counted in columns. */
function paintedRowWidth(view: VirtualizedTextView): number {
  const row = view.getState().mountedRows[0]!.element
  const painted = row.ownerDocument.createRange()
  painted.selectNodeContents(row)
  return painted.getBoundingClientRect().right - row.getBoundingClientRect().left
}

function caretX(container: HTMLElement): number {
  const caret = container.querySelector('.editor-virtualized-caret')
  if (!(caret instanceof HTMLElement)) throw new Error('no caret painted')
  return caret.getBoundingClientRect().left - container.getBoundingClientRect().left
}
