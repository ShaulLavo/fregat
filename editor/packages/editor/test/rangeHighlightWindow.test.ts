import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type VirtualizedTextHighlightRegistry, VirtualizedTextView } from '../src/virtualization'
import { renderRangeHighlight } from '../src/virtualization/virtualizedTextViewHighlights'
import type {
  VirtualizedTextHighlightRange,
  VirtualizedTextViewInternal,
} from '../src/virtualization/virtualizedTextViewInternals'

const highlightsMap = new Map<string, Highlight>()
let highlightClears = 0
const mockRegistry: VirtualizedTextHighlightRegistry = {
  set: (name, highlight) => {
    highlightsMap.set(name, highlight)
  },
  delete: (name) => highlightsMap.delete(name),
}

class MockHighlight extends Set<Range> {
  priority = 0

  clear(): void {
    highlightClears += 1
    super.clear()
  }
}

const ROW_HEIGHT = 20
const VIEWPORT_ROWS = 10
const LINE_TEXT_LENGTH = 'line0000'.length
/** With the newline, so a buffer row's start offset is its index times this. */
const LINE_LENGTH = LINE_TEXT_LENGTH + 1
const HIGHLIGHT_STYLE = { backgroundColor: 'rgba(234, 179, 8, 0.34)' }

function createLines(count: number): string {
  return Array.from({ length: count }, (_, index) => `line${String(index).padStart(4, '0')}`).join(
    '\n',
  )
}

function lineRange(line: number): VirtualizedTextHighlightRange {
  return { start: line * LINE_LENGTH, end: line * LINE_LENGTH + LINE_TEXT_LENGTH }
}

function internals(view: VirtualizedTextView): VirtualizedTextViewInternal {
  return Reflect.get(view, 'view') as VirtualizedTextViewInternal
}

function highlightGroupRanges(
  view: VirtualizedTextView,
  name: string,
): VirtualizedTextHighlightRange[] {
  const group = internals(view).rangeHighlightGroups.get(name)
  if (!group) throw new Error(`no highlight group named ${name}`)

  return group.ranges as VirtualizedTextHighlightRange[]
}

/**
 * Replaces the stored ranges with equal ones that report every read, in place so that the array
 * identity painting caches against is untouched. What is counted is the work of deciding which
 * ranges the mounted rows cover — the property the seek exists to bound.
 */
function countRangeReads(view: VirtualizedTextView, name: string): { reads: number } {
  const ranges = highlightGroupRanges(view, name)
  const counter = { reads: 0 }
  for (let index = 0; index < ranges.length; index += 1) {
    const { start, end } = ranges[index]!
    ranges[index] = {
      get start() {
        counter.reads += 1
        return start
      },
      get end() {
        counter.reads += 1
        return end
      },
    }
  }

  return counter
}

function paintedTexts(name: string): string[] {
  const highlight = highlightsMap.get(name)
  if (!highlight) throw new Error(`no highlight named ${name}`)

  return [...highlight].map((range) => range.toString()).sort()
}

describe('range highlight visible window', () => {
  let container: HTMLElement
  let view: VirtualizedTextView

  beforeEach(() => {
    highlightsMap.clear()
    highlightClears = 0
    // @ts-expect-error happy-dom does not provide Highlight.
    globalThis.Highlight = MockHighlight
    container = document.createElement('div')
    document.body.appendChild(container)
    view = new VirtualizedTextView(container, {
      rowHeight: ROW_HEIGHT,
      overscan: 0,
      highlightRegistry: mockRegistry,
      selectionHighlightName: 'test-selection',
    })
  })

  afterEach(() => {
    view.dispose()
    container.remove()
    Reflect.deleteProperty(globalThis, 'Highlight')
  })

  /**
   * Both sets put the same ranges under the same mounted rows; only the number of ranges outside
   * the viewport differs. Painting cost that tracks the larger total is the whole defect.
   */
  it('examines a bounded number of ranges however large the set is', () => {
    const lineCount = 4_000
    const firstRow = 2_000
    const paintReads = (rangeLines: readonly number[]): number => {
      view.setText(createLines(lineCount))
      view.setScrollMetrics(firstRow * ROW_HEIGHT, VIEWPORT_ROWS * ROW_HEIGHT)
      view.setRangeHighlight('test-find', rangeLines.map(lineRange), HIGHLIGHT_STYLE)

      const counter = countRangeReads(view, 'test-find')
      view.setScrollMetrics((firstRow + 1) * ROW_HEIGHT, VIEWPORT_ROWS * ROW_HEIGHT)
      return counter.reads
    }

    const nearby = Array.from({ length: 20 }, (_, index) => firstRow - 5 + index)
    const everywhere = Array.from({ length: lineCount }, (_, index) => index)

    const nearbyReads = paintReads(nearby)
    const everywhereReads = paintReads(everywhere)

    expect(nearbyReads).toBeGreaterThan(0)
    expect(everywhereReads).toBeLessThan(nearbyReads * 3)
    expect(everywhereReads).toBeLessThan(everywhere.length / 4)
  })

  it('paints a range set handed over out of order, including one that nests another', () => {
    view.setText(createLines(6))
    view.setScrollMetrics(0, 6 * ROW_HEIGHT)

    // Bottom row first, and a wide range that nests every other one — which is what stops the raw
    // ends from being ordered even once the starts are.
    const descending = Array.from({ length: 6 }, (_, index) => lineRange(5 - index))
    view.setRangeHighlight(
      'test-find',
      [...descending, { start: 0, end: lineRange(5).end }],
      HIGHLIGHT_STYLE,
    )

    expect(paintedTexts('test-find')).toEqual([
      'line0000',
      'line0000',
      'line0001',
      'line0001',
      'line0002',
      'line0002',
      'line0003',
      'line0003',
      'line0004',
      'line0004',
      'line0005',
      'line0005',
    ])
  })

  /**
   * The two seeks meet at the row's own bounds, so a range one character wide sitting on either
   * bound is the narrowest thing a window off by one can drop while every wider range survives.
   */
  it('paints a one-character range on the first and on the last column of a row', () => {
    view.setText(createLines(6))
    view.setScrollMetrics(0, 6 * ROW_HEIGHT)

    const rowStart = 3 * LINE_LENGTH
    const rowEnd = rowStart + LINE_TEXT_LENGTH
    view.setRangeHighlight('test-first', [{ start: rowStart, end: rowStart + 1 }], HIGHLIGHT_STYLE)
    view.setRangeHighlight('test-last', [{ start: rowEnd - 1, end: rowEnd }], HIGHLIGHT_STYLE)

    expect(paintedTexts('test-first')).toEqual(['l'])
    expect(paintedTexts('test-last')).toEqual(['3'])
  })

  it('repaints when the range set changes without changing what is on screen', () => {
    view.setText(createLines(40))
    view.setScrollMetrics(0, VIEWPORT_ROWS * ROW_HEIGHT)
    view.setRangeHighlight('test-find', [lineRange(30)], HIGHLIGHT_STYLE)

    const clearsAfterPaint = highlightClears
    const group = internals(view).rangeHighlightGroups.get('test-find')!
    group.ranges = [lineRange(32)]
    renderRangeHighlight(internals(view), 'test-find')

    expect(highlightClears).toBe(clearsAfterPaint + 1)
  })
})
