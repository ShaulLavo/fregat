import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDocumentTextSnapshot } from '../src/documentTextSnapshot'
import { createPieceTableSnapshot, insertIntoPieceTable } from '@singapore-editor/textbuffer'
import type { FixedRowVirtualizerSnapshot } from '../src/virtualization/fixedRowVirtualizer'
import { VirtualizedTextView } from '../src/virtualization/virtualizedTextView'
import {
  createRowHeightIndex,
  rowHeightIndexStart,
  updateRowHeightIndex,
} from '../src/virtualization/rowHeightIndex'
import type { VirtualizedTextViewInternal } from '../src/virtualization/virtualizedTextViewInternals'
import {
  applyTextLayoutTransition,
  bufferLineStartOffset,
  getRowHeight,
  rowForCaretPosition,
  rowForOffset,
  rowTop,
  scrollableHeight,
  virtualRowForBufferRow,
} from '../src/virtualization/virtualizedTextViewLayout'

const views: VirtualizedTextView[] = []

afterEach(() => {
  for (const view of views) view.dispose()
  views.length = 0
})

describe('virtualized text view layout', () => {
  it('maps distant plain offsets without materializing display rows', () => {
    const view = layoutView('x\n'.repeat(99_999) + 'x')
    const reads = vi.spyOn(view.model.textSnapshot, 'readRange')

    expect(rowForOffset(view, 199_998)).toBe(99_999)
    expect(virtualRowForBufferRow(view, 99_999)).toBe(99_999)
    expect(reads).not.toHaveBeenCalled()
  })

  it('keeps wrapped row boundary offsets on the preceding segment', () => {
    const view = layoutView('abcdefghij', 5)

    expect(rowForOffset(view, 5)).toBe(0)
    expect(rowForOffset(view, 6)).toBe(1)
    expect(rowForCaretPosition(view, 5, 'before')).toBe(0)
    expect(rowForCaretPosition(view, 5, 'after')).toBe(1)
  })

  it('positions fixed rows with row gaps', () => {
    const view = layoutView('a\nb\nc')
    view.rowGap = 4

    expect(getRowHeight(view)).toBe(20)
    expect(rowTop(view, 2)).toBe(48)
  })

  it('uses measured row metrics without re-entering the virtualizer', () => {
    const view = layoutView('x')
    const read = vi.spyOn(view.virtualizer, 'getSnapshot')

    expect(getRowHeight(view)).toBe(20)
    expect(scrollableHeight(view, fixedSnapshot({ totalSize: 20, viewportHeight: 60 }))).toBe(60)
    expect(read).not.toHaveBeenCalled()
  })

  it('updates same-line source offsets from the new immutable snapshot', () => {
    const before = createPieceTableSnapshot('a\nb\nc\nd')
    const view = layoutView('a\nb\nc\nd')
    const after = createDocumentTextSnapshot(insertIntoPieceTable(before, 1, 'X'))

    applyTextLayoutTransition(view, {
      before: view.model.textSnapshot,
      after,
      edits: [{ from: 1, to: 1, text: 'X' }],
    })

    expect(view.model.projection.getRow(0)).toMatchObject({ text: 'aX' })
    expect(bufferLineStartOffset(view, 1)).toBe(3)
    expect(rowForOffset(view, 3)).toBe(1)
    expect(view.model.textSnapshot).toBe(after)
  })

  it('publishes the final source coordinates across consecutive edits', () => {
    const before = createPieceTableSnapshot('a\nb\nc')
    const middle = insertIntoPieceTable(before, 1, 'X')
    const after = insertIntoPieceTable(middle, 4, 'Y')
    const view = layoutView('a\nb\nc')

    applyTextLayoutTransition(view, {
      before: view.model.textSnapshot,
      after: createDocumentTextSnapshot(middle),
      edits: [{ from: 1, to: 1, text: 'X' }],
    })
    applyTextLayoutTransition(view, {
      before: view.model.textSnapshot,
      after: createDocumentTextSnapshot(after),
      edits: [{ from: 4, to: 4, text: 'Y' }],
    })

    expect(view.model.projection.getRow(1)).toMatchObject({ text: 'bY' })
    expect(bufferLineStartOffset(view, 1)).toBe(3)
    expect(bufferLineStartOffset(view, 2)).toBe(6)
    expect(rowForOffset(view, 6)).toBe(2)
    expect(view.displayProjectionRevision).toBe(3)
  })

  it('adds a top newline without reading the unchanged suffix text', () => {
    const before = createPieceTableSnapshot('x\n'.repeat(99_999) + 'x')
    const after = createDocumentTextSnapshot(insertIntoPieceTable(before, 0, 'new\n'))
    const view = layoutView('x\n'.repeat(99_999) + 'x')
    const reads = vi.spyOn(after, 'readRange')

    applyTextLayoutTransition(view, {
      before: view.model.textSnapshot,
      after,
      edits: [{ from: 0, to: 0, text: 'new\n' }],
    })

    expect(view.model.lineCount).toBe(100_001)
    expect(view.model.visibleLineCount).toBe(100_001)
    expect(bufferLineStartOffset(view, 100_000)).toBe(200_002)
    expect(rowForOffset(view, 200_002)).toBe(100_000)
    expect(reads).not.toHaveBeenCalled()
  })
})

function layoutView(text: string, wrapColumn: number | null = null): VirtualizedTextViewInternal {
  const view = new VirtualizedTextView(document.createElement('div'), {
    rowHeight: 20,
    textMetrics: { rowHeight: 20, characterWidth: 8 },
  })
  views.push(view)
  view.setText(createDocumentTextSnapshot(createPieceTableSnapshot(text)))
  if (wrapColumn !== null) {
    view.setScrollMetrics(0, 0, wrapColumn * 8)
    view.setWrapEnabled(true)
  }
  return view['view']
}

describe('row height index', () => {
  it('re-sums only the rows after a settled row height', () => {
    const rowSizes = Array.from({ length: 500 }, () => 20)
    const index = createRowHeightIndex(rowSizes, 0)
    const resummed = countArrayIndexWrites(index.rowStarts)

    const settled = rowSizes.slice()
    settled[496] = 120

    const next = updateRowHeightIndex(index, settled, 0)

    expect(resummed.count).toBe(4)
    expect(next.totalSize).toBe(500 * 20 + 100)
    expect(rowHeightIndexStart(next, 400)).toBe(8_000)
    expect(rowHeightIndexStart(next, 499)).toBe(499 * 20 + 100)
  })

  it('carries settled offsets forward across repeated measurements', () => {
    const rowSizes = Array.from({ length: 500 }, () => 20)
    const grown = updateRowHeightIndex(createRowHeightIndex(rowSizes, 4), settled(10, 200), 4)
    const resummed = countArrayIndexWrites(grown.rowStarts)

    const regrown = updateRowHeightIndex(grown, settled(10, 300), 4)
    const unchanged = updateRowHeightIndex(regrown, settled(10, 300), 4)

    // Rows 11 to 500 once, and nothing at all for the measurement that repeated
    // the height it had already reported.
    expect(resummed.count).toBe(490)
    expect(unchanged.totalSize).toBe(12_276)
    expect(rowHeightIndexStart(unchanged, 499)).toBe(12_256)
    expect(rowHeightIndexStart(unchanged, 10)).toBe(240)

    function settled(row: number, height: number): number[] {
      const sizes = rowSizes.slice()
      sizes[row] = height
      return sizes
    }
  })

  // A measurement that reports the heights it reported last time is the common case, and every
  // caller that skips work on an unchanged index does so by comparing references.
  it('hands back the index itself, sizes included, when no row moved', () => {
    const rowSizes = Array.from({ length: 500 }, () => 20)
    const index = createRowHeightIndex(rowSizes, 4)

    const unchanged = updateRowHeightIndex(index, rowSizes.slice(), 4)

    expect(unchanged).toBe(index)
    expect(unchanged.rowSizes).toBe(index.rowSizes)
  })

  it('re-spaces the rows a gap change moved, at unchanged row heights', () => {
    const index = createRowHeightIndex([20, 20, 20], 0)

    const spaced = updateRowHeightIndex(index, [20, 20, 20], 6)

    expect(rowHeightIndexStart(spaced, 2)).toBe(52)
    expect(spaced.totalSize).toBe(72)
  })

  it('rebuilds from scratch when the row count changes', () => {
    const index = createRowHeightIndex([20, 60, 20], 4)

    const next = updateRowHeightIndex(index, [20, 60, 20, 20], 4)

    expect(next.totalSize).toBe(132)
    expect(rowHeightIndexStart(next, 3)).toBe(112)
  })
})

function fixedSnapshot(
  fields: Pick<FixedRowVirtualizerSnapshot, 'totalSize' | 'viewportHeight'>,
): FixedRowVirtualizerSnapshot {
  const scrollHeight = Math.max(fields.totalSize, fields.viewportHeight)
  return {
    scrollRow: 0,
    scrollTop: 0,
    scrollLeft: 0,
    viewportWidth: 0,
    viewportHeight: fields.viewportHeight,
    borderBoxWidth: 0,
    borderBoxHeight: 0,
    totalSize: fields.totalSize,
    scrollHeight,
    nativeScrollHeight: scrollHeight,
    nativeScrollTop: 0,
    visibleRange: { start: 0, end: 1 },
    virtualItems: [],
  }
}

function countArrayIndexWrites(values: readonly number[]): { count: number } {
  const counter = { count: 0 }
  const items = values as number[]
  for (let index = 0; index < items.length; index += 1) {
    let value = items[index]!
    Object.defineProperty(items, index, {
      configurable: true,
      get: () => value,
      set: (next: number) => {
        counter.count += 1
        value = next
      },
    })
  }

  return counter
}
