import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFoldGutterContribution,
  createLineGutterContribution,
} from '../../gutters/src/index.ts'
import { projectTokensThroughEdit } from '../src/editor/tokenProjection'
import { EditorFoldState } from '../src/editor/foldState'
import { IndentationFoldIndex } from '../src/editor/indentationFoldIndex'
import {
  applyBatchToPieceTable,
  createDocumentTextSnapshot,
  createPieceTableSnapshot,
  createStringTextSnapshot,
  type TextSnapshot,
} from '../src/public/document'
import { treeSitterCapturesToEditorTokens } from '../src/public/syntax'
import type { VirtualizedFoldMarker } from '../src/public/rendering'
import type { EditorGutterRowContext } from '../src/public/extensions'
import { createFoldMap } from '../src/foldMap'
import { createInlineMap } from '../src/inlineMap'
import { EditorTokenStore } from '../src/syntax/tokenStore'
import {
  clearBrowserTextMetricsCache,
  measureBrowserTextMetrics,
} from '../src/virtualization/browserMetrics'
import { type VirtualizedTextHighlightRegistry, VirtualizedTextView } from '../src/virtualization'
import type { VirtualizedTextViewInternal } from '../src/virtualization/virtualizedTextViewInternals'

const highlightsMap = new Map<string, Highlight>()
let registrySets = 0
let registryDeletes = 0
let highlightClears = 0
let highlightAdds = 0
let highlightDeletes = 0
const mockRegistry: VirtualizedTextHighlightRegistry = {
  set: (name, highlight) => {
    registrySets += 1
    highlightsMap.set(name, highlight)
  },
  delete: (name) => {
    registryDeletes += 1
    return highlightsMap.delete(name)
  },
}

class MockHighlight extends Set<Range> {
  add(range: Range): this {
    highlightAdds += 1
    return super.add(range)
  }

  delete(range: Range): boolean {
    highlightDeletes += 1
    return super.delete(range)
  }

  clear(): void {
    highlightClears += 1
    super.clear()
  }
}

function throwingFullTextSnapshot(text: string): TextSnapshot {
  const source = createStringTextSnapshot(text)
  return {
    lineCount: source.lineCount,
    lineStart: (line) => source.lineStart(line),
    lineRange: (line) => source.lineRange(line),
    lineAt: (offset) => source.lineAt(offset),
    length: text.length,
    materializeFullText: () => {
      throw new Error('unexpected full text read')
    },
    readRange: (start, end) => text.slice(start, end),
    forEachTextChunk: (visit) => {
      if (text.length > 0) visit(text, 0, text.length)
    },
  }
}

describe('VirtualizedTextView', () => {
  let container: HTMLElement
  let view: VirtualizedTextView

  beforeEach(() => {
    clearBrowserTextMetricsCache()
    highlightsMap.clear()
    registrySets = 0
    registryDeletes = 0
    highlightClears = 0
    highlightAdds = 0
    highlightDeletes = 0
    // @ts-expect-error happy-dom does not provide Highlight.
    globalThis.Highlight = MockHighlight
    container = document.createElement('div')
    document.body.appendChild(container)
    view = new VirtualizedTextView(container, {
      rowHeight: 20,
      overscan: 2,
      highlightRegistry: mockRegistry,
      selectionHighlightName: 'test-selection',
    })
  })

  afterEach(() => {
    view.dispose()
    container.remove()
    Reflect.deleteProperty(globalThis, 'Highlight')
  })

  it('mounts only visible and overscanned rows for large documents without default gutters', () => {
    view.setText(createLines(100_000))
    view.setScrollMetrics(0, 100)

    const rows = container.querySelectorAll('[data-editor-virtual-row]')
    const gutterRows = container.querySelectorAll('[data-editor-virtual-gutter-row]')
    expect(rows).toHaveLength(7)
    expect(gutterRows).toHaveLength(0)
    expect(view.scrollElement.style.getPropertyValue('--editor-gutter-width')).toBe('0px')
    expect(view.getState()).toMatchObject({
      lineCount: 100_000,
      totalHeight: 2_000_000,
      visibleRange: { start: 0, end: 5 },
    })
  })

  it('rejects non-monotonic prepared line starts', () => {
    view.setScrollMetrics(0, 40)
    view.setText('before')

    expect(() => view.setText('alpha\nbeta', [0, 6, 3])).toThrow(
      'Prepared line starts do not match the attached document',
    )
    expect(view.getState()).toMatchObject({
      lineCount: 1,
      mountedRows: [{ text: 'before' }],
    })
  })

  it('releases hidden rows and token registrations without changing a sibling', () => {
    const siblingContainer = document.createElement('div')
    container.appendChild(siblingContainer)
    const sibling = new VirtualizedTextView(siblingContainer, {
      rowHeight: 20,
      highlightRegistry: mockRegistry,
    })
    const text = createLines(100)
    const tokens = [{ start: 0, end: text.length, style: { color: '#ff0000' } }]
    try {
      view.setText(text)
      sibling.setText(text)
      view.setScrollMetrics(1_000, 100, 240)
      sibling.setScrollMetrics(0, 40, 240)
      view.setTokens(tokens)
      sibling.setTokens(tokens)
      const contentWidth = view.getState().contentWidth
      const siblingRanges = tokenHighlightRanges().filter((range) =>
        sibling.scrollElement.contains(range.startContainer),
      )
      expect(siblingRanges.length).toBeGreaterThan(0)

      view.setScrollMetrics(1_000, 0, 0)

      expect(view.getState().mountedRows).toEqual([])
      expect(view.getState().totalHeight).toBe(2_000)
      expect(view.getState().contentWidth).toBe(contentWidth)
      expect(view.scrollElement.querySelectorAll('[data-editor-virtual-row]')).toHaveLength(0)
      expect(tokenHighlightRanges()).toEqual(siblingRanges)

      view.setText(text.replace('line 50', 'Updated'))
      view.setTokens(tokens)
      expect(tokenHighlightRanges()).toEqual(siblingRanges)

      view.setScrollMetrics(1_000, 100, 240)
      expect(view.getState().mountedRows.some((row) => row.text === 'Updated')).toBe(true)
      expect(tokenHighlightRanges().length).toBeGreaterThan(siblingRanges.length)
      for (const range of siblingRanges) expect(tokenHighlightRanges()).toContain(range)
    } finally {
      sibling.dispose()
    }
  })

  it('keeps an unmeasured mount empty until a visible viewport arrives', () => {
    view.setText('ready')
    view.setTokens([{ start: 0, end: 5, style: { color: '#ff0000' } }])
    expect(view.getState().mountedRows).toEqual([])
    expect(tokenHighlightRanges()).toEqual([])

    view.setScrollMetrics(0, 0)
    expect(view.getState().mountedRows).toEqual([])
    expect(tokenHighlightNames()).toEqual([])

    view.setScrollMetrics(0, 40, 240)
    expect(view.getState().mountedRows.map((row) => row.text)).toEqual(['ready'])
    expect(tokenHighlightRanges()).toHaveLength(1)

    view.setScrollMetrics(0, 0)
    expect(tokenHighlightNames()).toEqual([])
  })

  it('wraps after reveal using the newly measured gutter width', () => {
    view.dispose()
    let probeVisible = false
    const measurement = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(() => mockRect(0, 0, probeVisible ? 160 : 0, probeVisible ? 20 : 0))
    view = new VirtualizedTextView(container, {
      wrap: true,
      rowHeight: 20,
      gutterWidth: ({ metrics }) => metrics.characterWidth * 4,
    })
    try {
      view.setText('abcdefghij'.repeat(20))
      view.setScrollMetrics(0, 0, 0)
      probeVisible = true
      view.setScrollMetrics(0, 100, 100)
      const state = view.getState()
      expect(state.metrics.characterWidth).toBe(10)
      expect(state.gutterWidth).toBe(40)
      expect(state.mountedRows[0]?.text.length).toBe(6)
    } finally {
      measurement.mockRestore()
    }
  })

  it('keeps the saved wrap layout when hidden content changes', () => {
    view.dispose()
    view = new VirtualizedTextView(container, {
      wrap: true,
      textMetrics: { characterWidth: 8, rowHeight: 20 },
    })
    const text = 'abcdefghij'.repeat(100)
    view.setText(text)
    view.setScrollMetrics(1_000, 100, 80)
    const height = view.getState().totalHeight

    view.setScrollMetrics(1_000, 0, 0)
    view.applyEdit(
      { from: 500, to: 504, text: 'EDIT' },
      `${text.slice(0, 500)}EDIT${text.slice(504)}`,
    )

    expect(view.getState().totalHeight).toBe(height)
    expect(view.getState().scrollTop).toBe(1_000)
    view.setScrollMetrics(1_000, 100, 80)
    expect(
      view
        .getState()
        .mountedRows.some((row) => row.text.slice(0, row.text.length).includes('EDIT')),
    ).toBe(true)
  })

  it('rejects non-integer prepared line starts', () => {
    view.setText('before')
    view.setScrollMetrics(0, 40, 240)

    expect(() => view.setText('alpha\nbeta', [0, Number.NaN, 5])).toThrow(
      'Prepared line starts do not match the attached document',
    )
    expect(() => view.setText('alpha\nbeta', [0, 1.5, 5])).toThrow(
      'Prepared line starts do not match the attached document',
    )
    expect(view.getState()).toMatchObject({
      lineCount: 1,
      mountedRows: [{ text: 'before' }],
    })
  })

  it('validates prepared line starts against snapshot length without rescanning text', () => {
    expect(() => view.setText('alpha\nbeta', [0, 5])).not.toThrow()

    const shortSnapshot = throwingFullTextSnapshot('alpha')
    expect(() => view.setText(shortSnapshot, [0, 6])).toThrow(
      'Prepared line starts do not match the attached document',
    )
    expect(view.getLineStarts()).toEqual([0, 6])
  })

  it.each(['wrapped', 'folded'])('projects fractional scroll through %s display rows', (layout) => {
    view.dispose()
    view = new VirtualizedTextView(container, {
      wrap: layout === 'wrapped',
      textMetrics: { characterWidth: 8, rowHeight: 20 },
      gutterWidth: 0,
    })
    const text = layout === 'wrapped' ? 'abcdefghij'.repeat(20) : 'a\nb\nc\nd'
    view.setText(text)
    if (layout === 'folded') {
      view.setFoldMap(
        createFoldMap(createPieceTableSnapshot(text), [
          { startIndex: 2, endIndex: 4, startLine: 1, endLine: 2, type: 'block' },
        ]),
      )
    }
    view.setScrollMetrics(30, 20, 80)

    expect(view.getViewport()).toMatchObject({ scrollTop: 30, scrollRow: 1.5 })
    expect(view.getState().scrollRow).toBe(1.5)
    expect(view.getState().mountedRows.find((row) => row.index === 1)?.bufferRow).toBe(
      layout === 'wrapped' ? 0 : 1,
    )
  })

  it('mounts all rows without vertical spacer churn in static scroll mode', () => {
    view.dispose()
    view = new VirtualizedTextView(container, {
      rowHeight: 20,
      overscan: 0,
      scrollMode: 'static',
      highlightRegistry: mockRegistry,
      selectionHighlightName: 'test-selection',
    })
    view.setText(createLines(10))
    view.setScrollMetrics(60, 40)

    const spacer = container.querySelector('.editor-virtualized-spacer') as HTMLElement
    expect(view.scrollElement.dataset.editorScrollMode).toBe('static')
    expect(view.getState()).toMatchObject({
      scrollHeight: 200,
      scrollTop: 0,
      totalHeight: 200,
      viewportHeight: 200,
      visibleRange: { start: 0, end: 10 },
    })
    expect(view.getState().mountedRows.map((row) => row.index)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ])
    expect(spacer.style.height).toBe('200px')
    expect(spacer.style.transform).toBe('')

    view.setScrollMetrics(120, 40)

    expect(view.getState().scrollTop).toBe(0)
    expect(spacer.style.height).toBe('200px')
    expect(spacer.style.transform).toBe('')
  })

  it('keeps mounted rows stable across same-range viewport resizes', () => {
    view.setText(createLines(100))
    view.setScrollMetrics(0, 100, 240)

    const mountedBefore = Array.from(container.querySelectorAll('[data-editor-virtual-row]'))
    const stateBefore = view.getState()

    view.setScrollMetrics(0, 99, 320)

    const mountedAfter = Array.from(container.querySelectorAll('[data-editor-virtual-row]'))
    expect(view.getState().visibleRange).toEqual(stateBefore.visibleRange)
    expect(mountedAfter).toEqual(mountedBefore)
  })

  it('reuses cached browser text metrics for matching editor styles', () => {
    clearBrowserTextMetricsCache()
    const first = document.createElement('div')
    const second = document.createElement('div')
    first.className = 'editor-virtualized'
    second.className = 'editor-virtualized'
    document.body.append(first, second)
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue(mockRect(0, 0, 160, 24))

    const firstMetrics = measureBrowserTextMetrics(first)
    const callsAfterFirstMeasure = rectSpy.mock.calls.length
    const secondMetrics = measureBrowserTextMetrics(second)

    expect(secondMetrics).toEqual(firstMetrics)
    expect(rectSpy.mock.calls.length).toBe(callsAfterFirstMeasure)

    rectSpy.mockRestore()
    first.remove()
    second.remove()
  })

  it('uses supplied browser text metrics without measuring a probe', () => {
    view.dispose()
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')

    view = new VirtualizedTextView(container, {
      highlightRegistry: mockRegistry,
      overscan: 0,
      selectionHighlightName: 'test-selection',
      textMetrics: {
        characterWidth: 7,
        rowHeight: 18,
      },
    })

    expect(rectSpy).not.toHaveBeenCalled()
    rectSpy.mockRestore()

    view.setText('alpha\nbeta')
    view.setScrollMetrics(0, 36)

    expect(view.getState()).toMatchObject({
      metrics: {
        characterWidth: 7,
        rowHeight: 18,
      },
      mountedRows: [
        { index: 0, top: 0, height: 18 },
        { index: 1, top: 18, height: 18 },
      ],
    })
  })

  it('adds bottom scroll padding so the final row can align with the viewport top', () => {
    view.setText(createLines(10))
    view.setScrollMetrics(0, 100)

    const spacer = container.querySelector('.editor-virtualized-spacer') as HTMLElement
    expect(view.getState().totalHeight).toBe(200)
    expect(spacer.style.height).toBe('280px')

    view.setScrollMetrics(180, 100)

    expect(view.getState().visibleRange).toEqual({ start: 9, end: 10 })
    expect(view.getState().mountedRows.at(-1)).toMatchObject({
      index: 9,
      top: 180,
    })
  })

  it('updates bottom scroll padding when the rendered row window is unchanged', () => {
    view.setText(createLines(3))
    view.setScrollMetrics(0, 20)

    const spacer = container.querySelector('.editor-virtualized-spacer') as HTMLElement
    expect(spacer.style.height).toBe('60px')

    view.setScrollMetrics(0, 100)

    expect(view.getState().scrollHeight).toBe(140)
    expect(spacer.style.height).toBe('140px')
  })

  it('skips viewport notifications for sub-row scrolls inside the stable window', () => {
    view.dispose()
    const events: number[] = []
    view = new VirtualizedTextView(container, {
      rowHeight: 20,
      overscan: 2,
      highlightRegistry: mockRegistry,
      onViewportChange: () => events.push(view.getState().scrollTop),
      selectionHighlightName: 'test-selection',
    })
    view.setText(createLines(10))
    view.setScrollMetrics(0, 100)
    events.length = 0

    view.setScrollMetrics(1, 100)

    expect(events).toEqual([])

    view.setScrollMetrics(21, 100)

    expect(events).toEqual([21])
  })

  it('publishes fold controls when an atomic scroll leaves the rendered row window unchanged', () => {
    view.dispose()
    const toggled: VirtualizedFoldMarker[] = []
    view = new VirtualizedTextView(container, {
      rowHeight: 20,
      overscan: 2,
      highlightRegistry: mockRegistry,
      gutterContributions: [createFoldGutterContribution()],
      onFoldToggle: (marker) => toggled.push(marker),
    })
    const header = 'heading '.repeat(30)
    const text = `${header}\n  child\n${createLines(20)}`
    view.setText(text)
    view.setScrollMetrics(1, 100, 80, 0)
    const rows = view.getState().mountedRows.map((row) => row.index)
    const marker: VirtualizedFoldMarker = {
      key: `plain:indent:${header.length}:${header.length + 8}`,
      startOffset: header.length,
      endOffset: header.length + 8,
      startRow: 0,
      endRow: 1,
      collapsed: false,
    }

    view.runAtomicRender(() => {
      view.setScrollMetrics(1, 100, 80, 1)
      view.setIndexedFoldState(
        {
          size: 1,
          readRows: (rows) => new Map(rows.includes(0) ? [[0, marker]] : []),
          all: () => [marker],
        },
        null,
      )
    })

    expect(view.getState().mountedRows.map((row) => row.index)).toEqual(rows)
    const button = container.querySelector<HTMLButtonElement>(
      '[data-editor-virtual-gutter-row="0"] .editor-virtualized-fold-toggle',
    )
    expect(button?.hidden).toBe(false)
    expect(button?.dataset.editorFoldKey).toBe(marker.key)
    button?.click()
    expect(toggled).toEqual([marker])
  })

  it('spaces rows with rowGap without adding a trailing gap', () => {
    view.dispose()
    view = new VirtualizedTextView(container, {
      rowHeight: 20,
      rowGap: 4,
      overscan: 0,
      highlightRegistry: mockRegistry,
      selectionHighlightName: 'test-selection',
    })
    view.setText('alpha\nbeta\ngamma')
    view.setScrollMetrics(0, 80)

    expect(view.getState()).toMatchObject({
      totalHeight: 68,
      mountedRows: [
        { index: 0, top: 0, height: 20 },
        { index: 1, top: 24, height: 20 },
        { index: 2, top: 48, height: 20 },
      ],
    })
  })

  it('renders gutter rows with CSS counter line numbers', () => {
    view.dispose()
    view = new VirtualizedTextView(container, {
      rowHeight: 20,
      overscan: 2,
      highlightRegistry: mockRegistry,
      selectionHighlightName: 'test-selection',
      gutterContributions: [createLineGutterContribution()],
    })
    view.setText('alpha\nbeta\ngamma')
    view.setScrollMetrics(0, 80)

    const firstLabel = container.querySelector(
      '[data-editor-virtual-gutter-row="0"] .editor-virtualized-line-number',
    ) as HTMLSpanElement

    expect(firstLabel).not.toBeNull()
    expect(firstLabel.textContent).toBe('')
    expect(firstLabel.style.counterSet).toBe('editor-line 1')
    expect(firstLabel.style.getPropertyValue('--editor-line-gutter-counter-style')).toBe('decimal')
  })

  it('renders custom mounted range highlights and refreshes them on scroll', () => {
    view.setText('alpha\nbeta\ngamma')
    view.setScrollMetrics(0, 20)

    view.setRangeHighlight('test-find', [{ start: 0, end: 5 }], {
      backgroundColor: 'rgba(234, 179, 8, 0.34)',
    })

    expect(highlightsMap.get('test-find')?.size).toBe(1)
    expect(view.scrollElement.textContent).toContain('alpha')

    view.setRangeHighlight('test-find', [{ start: 6, end: 10 }], {
      backgroundColor: 'rgba(234, 179, 8, 0.34)',
    })
    view.setScrollMetrics(20, 20)

    expect(highlightsMap.get('test-find')?.size).toBe(1)
  })

  it('skips unchanged custom range highlight updates', () => {
    view.setText('alpha\nbeta\ngamma')
    view.setScrollMetrics(0, 20)

    view.setRangeHighlight('test-find', [{ start: 0, end: 5 }], {
      backgroundColor: 'rgba(234, 179, 8, 0.34)',
    })

    const firstHighlight = highlightsMap.get('test-find')
    const setCount = registrySets
    const addCount = highlightAdds
    const clearCount = highlightClears
    expect(setCount).toBe(1)
    expect(addCount).toBe(1)

    view.setRangeHighlight('test-find', [{ start: 0, end: 5 }], {
      backgroundColor: 'rgba(234, 179, 8, 0.34)',
    })

    expect(highlightsMap.get('test-find')).toBe(firstHighlight)
    expect(registrySets).toBe(setCount)
    expect(highlightAdds).toBe(addCount)
    expect(highlightClears).toBe(clearCount)
  })

  it('empties custom range highlights and keeps their rule when ranges become empty', () => {
    view.setText('alpha\nbeta\ngamma')
    view.setScrollMetrics(0, 20)
    const style = { backgroundColor: 'rgba(234, 179, 8, 0.34)' }
    const styleElement = (Reflect.get(view, 'view') as VirtualizedTextViewInternal).styleEl

    view.setRangeHighlight('test-find', [{ start: 0, end: 5 }], style)
    const highlight = highlightsMap.get('test-find')
    const rules = styleElement.textContent
    const ruleWrites = vi.spyOn(styleElement, 'textContent', 'set')
    view.setRangeHighlight('test-find', [], style)

    expect(highlightsMap.get('test-find')?.size).toBe(0)
    expect(registryDeletes).toBe(0)

    view.setRangeHighlight('test-find', [{ start: 6, end: 10 }], style)

    expect(highlightsMap.get('test-find')).toBe(highlight)
    expect(highlightsMap.get('test-find')?.size).toBe(1)
    expect(styleElement.textContent).toBe(rules)
    expect(ruleWrites).not.toHaveBeenCalled()
  })

  it('removes custom range highlights when they are cleared', () => {
    view.setText('alpha\nbeta\ngamma')
    view.setScrollMetrics(0, 20)

    view.setRangeHighlight('test-find', [{ start: 0, end: 5 }], {
      backgroundColor: 'rgba(234, 179, 8, 0.34)',
    })
    view.clearRangeHighlight('test-find')

    expect(highlightsMap.has('test-find')).toBe(false)
    expect(registryDeletes).toBe(1)
  })

  it('decorates mounted rows by buffer row and refreshes on scroll', () => {
    view.setText('alpha\nbeta\ngamma')
    view.setScrollMetrics(0, 20)

    view.setRowDecorations(
      new Map([
        [0, { className: 'row-added', gutterClassName: 'gutter-added' }],
        [2, { className: 'row-deleted' }],
      ]),
    )

    expect(container.querySelector('[data-editor-virtual-row="0"]')?.className).toContain(
      'row-added',
    )

    view.setScrollMetrics(40, 20)

    expect(container.querySelector('[data-editor-virtual-row="2"]')?.className).toContain(
      'row-deleted',
    )
  })

  it('keeps custom range highlights registered while all ranges are offscreen', () => {
    view.setText(createLines(20))
    view.setScrollMetrics(0, 20)

    view.setRangeHighlight('test-find', [{ start: 0, end: 5 }], {
      backgroundColor: 'rgba(234, 179, 8, 0.34)',
    })
    view.setRangeHighlight('test-find', [{ start: 70, end: 75 }], {
      backgroundColor: 'rgba(234, 179, 8, 0.34)',
    })

    expect(highlightsMap.get('test-find')?.size).toBe(0)

    view.setScrollMetrics(200, 20)

    expect(highlightsMap.get('test-find')?.size).toBe(1)
  })

  it('passes raw CSS counter styles through the line gutter', () => {
    view.dispose()
    view = new VirtualizedTextView(container, {
      rowHeight: 20,
      overscan: 0,
      highlightRegistry: mockRegistry,
      selectionHighlightName: 'test-selection',
      gutterContributions: [createLineGutterContribution({ counterStyle: 'symbols("*" "+")' })],
    })
    view.setText('alpha')
    view.setScrollMetrics(0, 20)

    const firstLabel = container.querySelector(
      '[data-editor-virtual-gutter-row="0"] .editor-virtualized-line-number',
    ) as HTMLSpanElement

    expect(firstLabel.style.getPropertyValue('--editor-line-gutter-counter-style')).toBe(
      'symbols("*" "+")',
    )
  })

  it('highlights cursor row backgrounds without the gutter number by default', () => {
    view.dispose()
    view = new VirtualizedTextView(container, {
      rowHeight: 20,
      overscan: 0,
      highlightRegistry: mockRegistry,
      selectionHighlightName: 'test-selection',
      gutterContributions: [createLineGutterContribution()],
    })
    view.setText('alpha\nbeta\ngamma')
    view.setScrollMetrics(0, 80)

    const firstLabel = container.querySelector(
      '[data-editor-virtual-gutter-row="0"] .editor-virtualized-line-number',
    ) as HTMLSpanElement
    const secondLabel = container.querySelector(
      '[data-editor-virtual-gutter-row="1"] .editor-virtualized-line-number',
    ) as HTMLSpanElement
    const firstRow = container.querySelector('[data-editor-virtual-row="0"]') as HTMLDivElement
    const secondRow = container.querySelector('[data-editor-virtual-row="1"]') as HTMLDivElement

    view.setSelection(0, 0)
    expect(firstLabel.classList.contains('editor-virtualized-line-number-active')).toBe(false)
    expect(secondLabel.classList.contains('editor-virtualized-line-number-active')).toBe(false)
    expect(firstLabel.classList.contains('editor-virtualized-cursor-line-gutter')).toBe(true)
    expect(secondLabel.classList.contains('editor-virtualized-cursor-line-gutter')).toBe(false)
    expect(firstRow.classList.contains('editor-virtualized-cursor-line-row')).toBe(true)
    expect(secondRow.classList.contains('editor-virtualized-cursor-line-row')).toBe(false)

    view.setSelection(6, 6)
    expect(firstLabel.classList.contains('editor-virtualized-line-number-active')).toBe(false)
    expect(secondLabel.classList.contains('editor-virtualized-line-number-active')).toBe(false)
    expect(firstLabel.classList.contains('editor-virtualized-cursor-line-gutter')).toBe(false)
    expect(secondLabel.classList.contains('editor-virtualized-cursor-line-gutter')).toBe(true)
    expect(firstRow.classList.contains('editor-virtualized-cursor-line-row')).toBe(false)
    expect(secondRow.classList.contains('editor-virtualized-cursor-line-row')).toBe(true)
  })

  it('clears the cursor line highlight while selecting text', () => {
    view.dispose()
    view = new VirtualizedTextView(container, {
      rowHeight: 20,
      overscan: 0,
      highlightRegistry: mockRegistry,
      selectionHighlightName: 'test-selection',
      gutterContributions: [createLineGutterContribution()],
    })
    view.setText('alpha\nbeta\ngamma')
    view.setScrollMetrics(0, 80)

    const firstRow = container.querySelector('[data-editor-virtual-row="0"]') as HTMLDivElement
    const secondRow = container.querySelector('[data-editor-virtual-row="1"]') as HTMLDivElement

    view.setSelection(10, 0)

    expect(firstRow.classList.contains('editor-virtualized-cursor-line-row')).toBe(false)
    expect(secondRow.classList.contains('editor-virtualized-cursor-line-row')).toBe(false)
  })

  it('can customize cursor line gutter and row highlights', () => {
    view.dispose()
    view = new VirtualizedTextView(container, {
      rowHeight: 20,
      overscan: 0,
      highlightRegistry: mockRegistry,
      selectionHighlightName: 'test-selection',
      gutterContributions: [createLineGutterContribution()],
      cursorLineHighlight: {
        gutterNumber: true,
        gutterBackground: true,
        rowBackground: true,
      },
    })
    view.setText('alpha\nbeta\ngamma')
    view.setScrollMetrics(0, 80)

    const firstLabel = container.querySelector(
      '[data-editor-virtual-gutter-row="0"] .editor-virtualized-line-number',
    ) as HTMLSpanElement
    const secondLabel = container.querySelector(
      '[data-editor-virtual-gutter-row="1"] .editor-virtualized-line-number',
    ) as HTMLSpanElement
    const firstRow = container.querySelector('[data-editor-virtual-row="0"]') as HTMLDivElement
    const secondRow = container.querySelector('[data-editor-virtual-row="1"]') as HTMLDivElement

    view.setSelection(0, 0)
    expect(firstLabel.classList.contains('editor-virtualized-line-number-active')).toBe(true)
    expect(secondLabel.classList.contains('editor-virtualized-line-number-active')).toBe(false)
    expect(firstLabel.classList.contains('editor-virtualized-cursor-line-gutter')).toBe(true)
    expect(secondLabel.classList.contains('editor-virtualized-cursor-line-gutter')).toBe(false)
    expect(firstRow.classList.contains('editor-virtualized-cursor-line-row')).toBe(true)
    expect(secondRow.classList.contains('editor-virtualized-cursor-line-row')).toBe(false)

    view.setSelection(6, 6)
    expect(firstLabel.classList.contains('editor-virtualized-line-number-active')).toBe(false)
    expect(secondLabel.classList.contains('editor-virtualized-line-number-active')).toBe(true)
    expect(firstLabel.classList.contains('editor-virtualized-cursor-line-gutter')).toBe(false)
    expect(secondLabel.classList.contains('editor-virtualized-cursor-line-gutter')).toBe(true)
    expect(firstRow.classList.contains('editor-virtualized-cursor-line-row')).toBe(false)
    expect(secondRow.classList.contains('editor-virtualized-cursor-line-row')).toBe(true)
  })

  it('can limit cursor line gutter backgrounds to specific gutter contributions', () => {
    view.dispose()
    view = new VirtualizedTextView(container, {
      rowHeight: 20,
      overscan: 0,
      highlightRegistry: mockRegistry,
      selectionHighlightName: 'test-selection',
      gutterContributions: [createLineGutterContribution(), createFoldGutterContribution()],
      cursorLineHighlight: {
        gutterBackground: ['fold-gutter'],
        rowBackground: false,
      },
    })
    view.setText('alpha\nbeta\ngamma')
    view.setScrollMetrics(0, 80)

    const firstLineGutter = container.querySelector(
      '[data-editor-virtual-gutter-row="0"] [data-editor-gutter-contribution="line-gutter"]',
    ) as HTMLElement
    const firstFoldGutter = container.querySelector(
      '[data-editor-virtual-gutter-row="0"] [data-editor-gutter-contribution="fold-gutter"]',
    ) as HTMLElement
    const firstFoldButton = firstFoldGutter.querySelector<HTMLButtonElement>(
      '.editor-virtualized-fold-toggle',
    )
    const firstRow = container.querySelector('[data-editor-virtual-row="0"]') as HTMLDivElement

    view.setSelection(0, 0)

    expect(firstLineGutter.classList.contains('editor-virtualized-cursor-line-gutter')).toBe(false)
    expect(firstFoldGutter.classList.contains('editor-virtualized-cursor-line-gutter')).toBe(true)
    expect(firstFoldButton?.classList.contains('editor-virtualized-cursor-line-gutter')).toBe(false)
    expect(firstFoldButton?.hidden).toBe(true)
    expect(firstRow.classList.contains('editor-virtualized-cursor-line-row')).toBe(false)
  })

  it('sizes the gutter from deterministic CSS columns', () => {
    view.dispose()
    view = new VirtualizedTextView(container, {
      rowHeight: 20,
      overscan: 0,
      highlightRegistry: mockRegistry,
      selectionHighlightName: 'test-selection',
      gutterContributions: [createLineGutterContribution(), createFoldGutterContribution()],
    })
    view.setText(createLines(1_500))
    view.setScrollMetrics(1_499 * 20, 20)

    const spacer = container.querySelector('.editor-virtualized-spacer') as HTMLElement
    expect(view.scrollElement.style.getPropertyValue('--editor-gutter-width')).toBe('50px')
    // 50px gutter, 72px text, and one 8px cell for the end-of-line caret.
    expect(spacer.style.width).toBe('130px')
  })

  it('keeps the spacer at least as wide as the viewport', () => {
    view.setText('short')
    view.setScrollMetrics(0, 20, 320)

    const spacer = container.querySelector('.editor-virtualized-spacer') as HTMLElement

    expect(view.getState().contentWidth).toBeLessThan(320)
    expect(spacer.style.width).toBe('320px')
  })

  it('uses custom tab size for width, caret, and hidden tab markers', () => {
    view.dispose()
    view = new VirtualizedTextView(container, {
      rowHeight: 20,
      overscan: 0,
      highlightRegistry: mockRegistry,
      selectionHighlightName: 'test-selection',
      hiddenCharacters: 'show',
      tabSize: 2,
    })
    view.setText('\tX')
    view.setScrollMetrics(0, 20)
    view.focusInput()

    const charWidth = view.getState().metrics.characterWidth
    const marker = container.querySelector('[data-editor-hidden-character="tab"]') as HTMLElement

    view.setSelection(1, 1)

    expect(view.scrollElement.style.getPropertyValue('--editor-tab-size')).toBe('2')
    expect(view.getState()).toMatchObject({ contentWidth: 3 * charWidth, tabSize: 2 })
    expect(marker.style.width).toBe(`${2 * charWidth}px`)
    expect(container.querySelector('.editor-virtualized-caret')?.getAttribute('style')).toContain(
      `translate(${2 * charWidth}px, 0px)`,
    )
    expect(view.offsetByDisplayRows(1, 0, 1)).toBe(0)
    expect(view.offsetByDisplayRows(1, 0, 2)).toBe(1)
  })

  it('positions long-line chunks with visual tab columns', () => {
    view.dispose()
    view = new VirtualizedTextView(container, {
      rowHeight: 20,
      overscan: 0,
      highlightRegistry: mockRegistry,
      selectionHighlightName: 'test-selection',
      horizontalOverscanColumns: 0,
      longLineChunkSize: 2,
      longLineChunkThreshold: 2,
      tabSize: 4,
    })
    view.setText('ab\tcdef')
    view.setScrollMetrics(0, 20, 16, 32)

    const charWidth = view.getState().metrics.characterWidth
    const spacer = container.querySelector('.editor-virtualized-row-spacer') as HTMLElement

    expect(spacer.style.width).toBe(`${2 * charWidth}px`)
  })

  it('updates mounted rows when scrolling', () => {
    view.setText(createLines(200))
    view.setScrollMetrics(2_000, 60)

    const indexes = view.getState().mountedRows.map((row) => row.index)
    expect(indexes).toEqual([98, 99, 100, 101, 102, 103, 104])
  })

  it('recycles row elements that leave the mounted window', () => {
    view.setText(createLines(200))
    view.setScrollMetrics(0, 100)

    const firstRowElement = container.querySelector(
      '[data-editor-virtual-row="0"]',
    ) as HTMLDivElement

    view.setScrollMetrics(60, 100)

    expect(firstRowElement.isConnected).toBe(true)
    expect(firstRowElement.dataset.editorVirtualRow).toBe('7')
  })

  it('parks surplus rows outside the active row set for reuse', () => {
    view.setText(createLines(200))
    view.setScrollMetrics(0, 100)
    const initialRows = Array.from(
      container.querySelectorAll<HTMLDivElement>('.editor-virtualized-row'),
    )

    view.setScrollMetrics(0, 20)

    const parkedRow = initialRows.find((row) => row.dataset.editorVirtualRow === undefined)
    expect(parkedRow?.isConnected).toBe(true)
    expect(parkedRow?.hidden).toBe(true)
    expect(container.querySelectorAll('[data-editor-virtual-row]')).toHaveLength(
      view.getState().mountedRows.length,
    )

    view.setScrollMetrics(0, 100)

    expect(parkedRow?.dataset.editorVirtualRow).not.toBeUndefined()
    expect(parkedRow?.hidden).toBe(false)
  })

  it('keeps horizontal content width independent from recycled row text', () => {
    view.setText([`${'x'.repeat(100)}`, ...Array.from({ length: 20 }, () => 'x')].join('\n'))
    view.setScrollMetrics(0, 40)
    const widthAfterLongLine = view.getState().contentWidth

    view.setScrollMetrics(200, 20)

    expect(view.getState().contentWidth).toBe(widthAfterLongLine)
  })

  it('mounts only horizontal chunks around the viewport for very long lines', () => {
    view.dispose()
    view = new VirtualizedTextView(container, {
      rowHeight: 20,
      overscan: 0,
      highlightRegistry: mockRegistry,
      selectionHighlightName: 'test-selection',
      longLineChunkSize: 1_000,
      longLineChunkThreshold: 1_000,
      horizontalOverscanColumns: 0,
    })
    view.setText('x'.repeat(5_000))
    view.setScrollMetrics(0, 20, 80)
    const firstChunk = view.getState().mountedRows[0]?.chunks[0]

    expect(firstChunk?.localStart).toBe(0)
    expect(firstChunk?.text).toHaveLength(1_000)
    expect(container.querySelector('.editor-virtualized-row')?.textContent?.length).toBe(1_000)

    const scrollLeft = 2_400 * view.getState().metrics.characterWidth
    view.setScrollMetrics(0, 20, 80, scrollLeft)
    const scrolledChunk = view.getState().mountedRows[0]?.chunks[0]

    expect(scrolledChunk?.localStart).toBeGreaterThan(0)
    expect(scrolledChunk?.text.length).toBeLessThanOrEqual(1_000)
  })

  it('spreads a mounted chunk over bounded text nodes without moving its offsets', () => {
    view.dispose()
    view = new VirtualizedTextView(container, {
      rowHeight: 20,
      overscan: 0,
      highlightRegistry: mockRegistry,
      selectionHighlightName: 'test-selection',
      longLineChunkSize: 1_000,
      longLineChunkThreshold: 1_000,
      horizontalOverscanColumns: 0,
    })
    view.setText('x'.repeat(5_000))
    view.setScrollMetrics(0, 20, 80)

    const chunk = view.getState().mountedRows[0]!.chunks[0]!
    const caret = view.createRange(chunk.startOffset + 353, chunk.startOffset + 353)
    const nodes = [...chunk.element!.childNodes]

    expect(chunk.element!.textContent).toBe('x'.repeat(1_000))
    expect(chunk.textNode).toBe(nodes[0])
    expect(Math.max(...nodes.map((node) => node.textContent!.length))).toBeLessThanOrEqual(50)
    expect(caret?.startContainer).toBe(nodes[7])
    expect(caret?.startOffset).toBe(3)
    expect(view.textOffsetFromDomBoundary(nodes[7]!, 3)).toBe(chunk.startOffset + 353)
  })

  it('spreads a long sub-threshold row over bounded text nodes without moving its geometry', () => {
    const line = 'abcdefghij'.repeat(120)
    view.setText(`${line}\ntail`)
    view.setScrollMetrics(0, 40)
    mockViewport(view.scrollElement, 4_000, 40)

    const row = view.getState().mountedRows[0]!
    const caret = view.createRange(353, 353)
    const nodes = [...row.element.childNodes]
    const { characterWidth } = view.getState().metrics

    expect(row.chunks).toHaveLength(1)
    expect(row.element.textContent).toBe(line)
    expect(row.textNode).toBe(nodes[0])
    expect(Math.max(...nodes.map((node) => node.textContent!.length))).toBeLessThanOrEqual(50)
    expect(caret?.startContainer).toBe(nodes[7])
    expect(caret?.startOffset).toBe(3)
    expect(view.textOffsetFromDomBoundary(nodes[7]!, 3)).toBe(353)
    expect(view.textOffsetFromPoint(characterWidth * 353.5, 10)).toBe(353)

    view.setSelection(353, 400)
    const selection = selectionRanges(container)[0]!

    expect(selection.style.left).toBe(`${characterWidth * 353}px`)
    expect(selection.style.width).toBe(`${characterWidth * 47}px`)
  })

  /**
   * A single line long enough to be chunked, plus a gutter cell whose updates count render passes:
   * the cell is refreshed for every mounted row on every pass, including rows that stay current.
   */
  function mountLongLineView(onGutterCellUpdate: () => void = () => {}): void {
    view.dispose()
    view = new VirtualizedTextView(container, {
      rowHeight: 20,
      overscan: 0,
      highlightRegistry: mockRegistry,
      selectionHighlightName: 'test-selection',
      longLineChunkSize: 1_000,
      longLineChunkThreshold: 1_000,
      horizontalOverscanColumns: 0,
      gutterContributions: [
        {
          id: 'render-pass-counter',
          createCell: (document) => document.createElement('div'),
          width: () => 10,
          updateCell: onGutterCellUpdate,
        },
      ],
    })
    view.setText('x'.repeat(20_000))
  }

  it('skips the render pass while horizontal scrolling stays inside the chunk window', () => {
    let gutterCellUpdates = 0
    mountLongLineView(() => {
      gutterCellUpdates += 1
    })
    const { characterWidth } = view.getState().metrics
    view.setScrollMetrics(0, 20, 80, 2_400 * characterWidth)
    const chunkLocalStart = view.getState().mountedRows[0]!.chunks[0]!.localStart
    gutterCellUpdates = 0

    view.setScrollMetrics(0, 20, 80, 2_400 * characterWidth + 1)

    expect(gutterCellUpdates).toBe(0)

    view.setScrollMetrics(0, 20, 80, 3_400 * characterWidth)

    expect(gutterCellUpdates).toBeGreaterThan(0)
    expect(view.getState().mountedRows[0]!.chunks[0]!.localStart).toBeGreaterThan(chunkLocalStart)
  })

  it('patches same-window chunks without replacing their spans, text nodes, or unchanged paint', () => {
    mountLongLineView()
    const original = 'x'.repeat(20_000)
    view.setScrollMetrics(0, 20, 2_500 * view.getState().metrics.characterWidth)
    const before = view.getState().mountedRows[0]!.chunks.map((chunk) => ({
      chunk,
      nodes: [...chunk.element!.childNodes],
      paint: chunk.mountedPaint,
    }))
    expect(before).toHaveLength(3)
    const next = `${original.slice(0, 49)}Q\t${original.slice(49)}`

    view.applyEdit({ from: 49, to: 49, text: 'Q\t' }, next)

    const row = view.getState().mountedRows[0]!
    for (const [index, chunk] of row.chunks.entries()) {
      expect(chunk).toBe(before[index]!.chunk)
      const nodes = [...chunk.element!.childNodes]
      expect(nodes).toHaveLength(before[index]!.nodes.length)
      expect(nodes.every((node, nodeIndex) => node === before[index]!.nodes[nodeIndex])).toBe(true)
      expect(chunk.element!.textContent).toBe(next.slice(chunk.localStart, chunk.localEnd))
      expect(chunk.element!.dataset.editorVirtualChunkStart).toBe(String(chunk.localStart))
      expect(chunk.element!.dataset.editorVirtualChunkEnd).toBe(String(chunk.localEnd))
      expect(Math.max(...chunk.parts.map((part) => part.localEnd - part.localStart))).toBe(50)
    }
    expect(row.element.dataset.editorVirtualWindowStart).toBe('0')
    expect(row.element.dataset.editorVirtualWindowEnd).toBe('3000')
    expect(row.chunks[1]!.mountedPaint).toBe(before[1]!.paint)
    expect(row.chunks[2]!.mountedPaint).toBe(before[2]!.paint)
    const oldPaint = before[0]!.paint
    const newPaint = row.chunks[0]!.mountedPaint
    expect(oldPaint.kind).toBe('replayable')
    expect(newPaint.kind).toBe('replayable')
    if (oldPaint.kind !== 'replayable' || newPaint.kind !== 'replayable') return
    expect(oldPaint.parts.map((part) => part.text).join('')).toBe('x'.repeat(1_000))
    expect(newPaint.parts.map((part) => part.text).join('')).toBe(next.slice(0, 1_000))
    expect(newPaint.parts[2]).toBe(oldPaint.parts[2])
    const caret = view.createRange(53, 53)!
    expect(caret.startContainer).toBe(before[0]!.nodes[1])
    expect(caret.startOffset).toBe(3)
    expect(view.textOffsetFromDomBoundary(caret.startContainer, 3)).toBe(53)
  })

  it('retains a chunk span when inserted Unicode and controls need different text parts', () => {
    mountLongLineView()
    view.setScrollMetrics(0, 20, 80)
    const chunk = view.getState().mountedRows[0]!.chunks[0]!
    const element = chunk.element
    const originalPaint = chunk.mountedPaint
    const inserted = '😀e\u0301\u0000\u0085'
    const next = `${'x'.repeat(49)}${inserted}${'x'.repeat(19_951)}`

    view.applyEdit({ from: 49, to: 49, text: inserted }, next)

    const changed = view.getState().mountedRows[0]!.chunks[0]!
    expect(changed.element).toBe(element)
    expect(changed.text).toBe(next.slice(0, 1_000))
    expect(changed.element!.textContent).toContain('😀e\u0301␀[U+0085]')
    expect(
      changed.parts.some((part) => part.kind === 'text' && part.node.data.includes('😀e\u0301')),
    ).toBe(true)
    expect(changed.parts.some((part) => part.kind === 'control')).toBe(true)
    expect(originalPaint.kind).toBe('replayable')
    if (originalPaint.kind === 'replayable') {
      expect(originalPaint.parts.map((part) => part.text).join('')).toBe('x'.repeat(1_000))
    }

    view.applyEdit({ from: 49, to: 49 + inserted.length, text: '' }, 'x'.repeat(20_000))

    const restored = view.getState().mountedRows[0]!.chunks[0]!
    expect(restored.element).toBe(element)
    expect(restored.element!.textContent).toBe('x'.repeat(1_000))
    expect(restored.parts.every((part) => part.kind === 'text')).toBe(true)
    expect(Math.max(...restored.parts.map((part) => part.localEnd - part.localStart))).toBe(50)
  })

  it('keeps same-window DOM and projected highlights through repeated cross-part edits', () => {
    mountLongLineView()
    let text = 'abcdefghij'.repeat(2_000)
    let tokens = EditorTokenStore.fromTokens([
      { start: 45, end: 1_100, style: { color: '#ff0000' } },
    ])
    view.setText(text)
    view.setScrollMetrics(0, 20, 2_500 * view.getState().metrics.characterWidth)
    view.adoptTokens(tokens)
    const chunks = view.getState().mountedRows[0]!.chunks
    const nodes = chunks.flatMap((chunk) => [...chunk.element!.childNodes])

    for (const edit of [
      { from: 49, to: 49, text: 'Q'.repeat(100) },
      { from: 47, to: 1_080, text: 'AB\t' },
      { from: 998, to: 1_003, text: '<>'.repeat(34) },
    ]) {
      const next = `${text.slice(0, edit.from)}${edit.text}${text.slice(edit.to)}`
      view.applyEdit(edit, next)
      tokens = projectTokensThroughEdit(tokens, edit, text)
      view.adoptTokens(tokens)
      text = next
      const row = view.getState().mountedRows[0]!
      expect(row.chunks).toBe(chunks)
      const currentNodes = row.chunks.flatMap((chunk) => [...chunk.element!.childNodes])
      expect(currentNodes).toHaveLength(nodes.length)
      expect(currentNodes.every((node, index) => node === nodes[index])).toBe(true)
      expect(row.chunks.map((chunk) => chunk.element!.textContent).join('')).toBe(
        text.slice(0, 3_000),
      )
      const highlight = highlightsMap.get(tokenHighlightNames()[0]!)!
      expect([...highlight].map((range) => range.toString()).join('')).toBe(
        text.slice(tokens.startAt(0), tokens.endAt(0)),
      )
    }
  })

  it('keeps chunk source offsets current after an edit in an earlier row', () => {
    mountLongLineView()
    const line = 'abcdefghij'.repeat(2_000)
    view.setText(`header\n${line}`)
    view.setScrollMetrics(0, 40, 80)
    const before = view.getState().mountedRows[1]!.chunks[0]!
    const element = before.element
    const paint = before.mountedPaint

    view.applyEdit({ from: 3, to: 3, text: '123' }, `hea123der\n${line}`)

    const chunk = view.getState().mountedRows[1]!.chunks[0]!
    expect(chunk.element).toBe(element)
    expect(chunk.mountedPaint).toBe(paint)
    expect(chunk.startOffset).toBe(10)
    expect(chunk.endOffset).toBe(1_010)
    const caret = view.createRange(63, 63)!
    expect(caret.startContainer).toBe(element!.childNodes[1])
    expect(caret.startOffset).toBe(3)
    expect(view.textOffsetFromDomBoundary(caret.startContainer, 3)).toBe(63)
  })

  it('refreshes unchanged chunk control widths after metrics change', () => {
    view.dispose()
    const metrics = { rowHeight: 20, characterWidth: 8 }
    view = new VirtualizedTextView(container, {
      textMetrics: metrics,
      longLineChunkSize: 1_000,
      longLineChunkThreshold: 1_000,
      horizontalOverscanColumns: 0,
    })
    const original = `\u0085${'x'.repeat(20_000)}`
    view.setText(original)
    view.setScrollMetrics(0, 20, 80)
    const control = container.querySelector<HTMLElement>('[data-editor-control-character]')!
    expect(control.style.width).toBe('64px')

    metrics.characterWidth = 16
    view.refreshMetrics()
    view.applyEdit(
      { from: 1_500, to: 1_500, text: 'Q' },
      `${original.slice(0, 1_500)}Q${original.slice(1_500)}`,
    )

    expect(container.querySelector('[data-editor-control-character]')).toBe(control)
    expect(control.style.width).toBe('128px')
  })

  it('updates chunk coverage and clears metadata when reused rows switch rendering modes', () => {
    mountLongLineView()
    const text = 'x'.repeat(20_000)
    view.setScrollMetrics(0, 20, 80)
    view.applyEdit({ from: 49, to: 50, text: 'Q' }, `${text.slice(0, 49)}Q${text.slice(50)}`)
    const first = view.getState().mountedRows[0]!.chunks[0]!
    view.setScrollMetrics(0, 20, 80, 2_400 * view.getState().metrics.characterWidth)
    const scrolled = view.getState().mountedRows[0]!
    expect(first.element!.isConnected).toBe(false)
    expect(scrolled.element.dataset.editorVirtualWindowStart).toBe('2000')
    expect(scrolled.chunks[0]!.element!.textContent).toBe(text.slice(2_000, 3_000))

    view.setText(text)
    view.setInlineMap(
      createInlineMap(createPieceTableSnapshot(text), [
        {
          id: 'ghost',
          startIndex: 20,
          endIndex: 20,
          text: 'hint',
          insertion: true,
          className: 'ghost',
        },
      ]),
    )
    const inline = view.getState().mountedRows[0]!
    expect(inline.textRenderMode).toBe('widget')
    expect(inline.element.querySelector('.ghost')).toBeNull()
    view.setScrollMetrics(0, 20, 80, 0)
    expect(inline.element.querySelector('.ghost')!.textContent).toBe('hint')
    expect(inline.element.dataset.editorVirtualWindowStart).toBeUndefined()
    expect(inline.element.dataset.editorVirtualWindowEnd).toBeUndefined()

    view.setInlineMap(null)
    view.setWrapEnabled(true)
    view.setScrollMetrics(0, 40, 80, 0)
    const wrapped = view.getState().mountedRows
    expect(wrapped.length).toBeGreaterThan(1)
    expect(
      wrapped.every(
        (row) =>
          row.element.dataset.editorVirtualWindowStart === undefined &&
          row.element.dataset.editorVirtualWindowEnd === undefined,
      ),
    ).toBe(true)
  })

  it('keeps measured row geometry across a sub-chunk horizontal scroll', () => {
    mountLongLineView()
    const { characterWidth } = view.getState().metrics
    view.setScrollMetrics(0, 20, 80, 2_400 * characterWidth)
    // Painting a selection over the row materializes its measured geometry,
    // which is what a scroll-derived chunk key would throw away on the very
    // next pixel of horizontal scroll.
    view.setSelection(2_450, 2_500)
    const geometry = view.getState().mountedRows[0]!.geometryCache

    expect(geometry).not.toBeNull()

    view.setScrollMetrics(0, 20, 80, 2_400 * characterWidth + 1)

    expect(view.getState().mountedRows[0]!.geometryCache).toBe(geometry)
  })

  it('reuses long-line chunks when a forced render lands on a sub-chunk scroll offset', () => {
    mountLongLineView()
    const { characterWidth } = view.getState().metrics
    view.setScrollMetrics(0, 20, 80, 2_400 * characterWidth)
    const chunkTextNode = view.getState().mountedRows[0]!.chunks[0]!.textNode

    view.setScrollMetrics(0, 20, 80, 2_400 * characterWidth + 1)
    // Any decoration update forces a full render pass; the row must still be recognized as current.
    view.setRowDecorations(new Map())

    expect(view.getState().mountedRows[0]!.chunks[0]!.textNode).toBe(chunkTextNode)
  })

  it('mounts wrapped text segments as virtual rows when wrapping is enabled', () => {
    view.dispose()
    view = new VirtualizedTextView(container, {
      rowHeight: 20,
      overscan: 0,
      highlightRegistry: mockRegistry,
      selectionHighlightName: 'test-selection',
      wrap: true,
      gutterContributions: [createLineGutterContribution()],
    })
    mockViewport(view.scrollElement, 72, 80)

    view.setText('abcdefghij')
    view.setScrollMetrics(0, 80, 72)

    expect(view.getState().wrapActive).toBe(true)
    expect(view.getState().totalHeight).toBe(40)
    expect(view.getState().mountedRows.map((row) => row.text)).toEqual(['abcde', 'fghij'])
    const labels = container.querySelectorAll<HTMLSpanElement>('.editor-virtualized-line-number')
    expect(labels[0]?.style.counterSet).toBe('editor-line 1')
    expect(labels[1]?.hidden).toBe(true)
    expect(view.textOffsetFromViewportPoint(64, 25)).toBe(9)
  })

  it('renders injected text rows without changing document offsets', () => {
    view.setText('abc\ndef')
    view.setInjectedTextRows([
      {
        id: 'deleted-line',
        anchorBufferRow: 1,
        placement: 'before',
        text: 'old',
        className: 'row-deleted',
        gutterClassName: 'gutter-deleted',
        metadata: { kind: 'diff-delete' },
      },
    ])
    view.setScrollMetrics(0, 60)
    mockViewport(view.scrollElement, 120, 60)

    expect(view.getLineStarts()).toEqual([0, 4])
    expect(view.getState()).toMatchObject({
      lineCount: 2,
      totalHeight: 60,
      mountedRows: [
        { source: 'document', text: 'abc', startOffset: 0, endOffset: 3 },
        {
          source: 'injected',
          injectedTextRowId: 'deleted-line',
          text: 'old',
          startOffset: 4,
          endOffset: 4,
        },
        { source: 'document', text: 'def', startOffset: 4, endOffset: 7 },
      ],
    })
    expect(container.querySelector('[data-editor-virtual-row="1"]')?.className).toContain(
      'row-deleted',
    )
    expect(view.offsetByDisplayRows(1, 1, 0)).toBe(4)
    expect(view.textOffsetFromViewportPoint(8, 25)).toBeNull()
    expect(view.textOffsetFromDomBoundary(view.getState().mountedRows[1]!.textNode, 1)).toBeNull()
  })

  it('passes injected row source metadata to gutter contributions', () => {
    const metadata = { kind: 'diff-delete' }
    const rows = new Map<
      number,
      Pick<EditorGutterRowContext, 'source' | 'injectedTextRowId' | 'metadata' | 'primaryText'>
    >()
    view.dispose()
    view = new VirtualizedTextView(container, {
      rowHeight: 20,
      overscan: 0,
      highlightRegistry: mockRegistry,
      selectionHighlightName: 'test-selection',
      gutterContributions: [
        {
          id: 'test-gutter',
          createCell: (document) => document.createElement('span'),
          width: () => 24,
          updateCell: (_element, row) => {
            rows.set(row.index, {
              source: row.source,
              injectedTextRowId: row.injectedTextRowId,
              metadata: row.metadata,
              primaryText: row.primaryText,
            })
          },
        },
      ],
    })

    view.setText('abc\ndef')
    view.setInjectedTextRows([
      {
        id: 'deleted-line',
        anchorBufferRow: 1,
        placement: 'before',
        text: 'old',
        metadata,
      },
    ])
    view.setScrollMetrics(0, 60)

    expect(rows.get(1)).toEqual({
      source: 'injected',
      injectedTextRowId: 'deleted-line',
      metadata,
      primaryText: false,
    })
    expect(rows.get(2)).toMatchObject({ source: 'document', primaryText: true })
  })

  it('maps chunked DOM boundaries back to document offsets', () => {
    view.dispose()
    view = new VirtualizedTextView(container, {
      rowHeight: 20,
      overscan: 0,
      highlightRegistry: mockRegistry,
      selectionHighlightName: 'test-selection',
      longLineChunkSize: 1_000,
      longLineChunkThreshold: 1_000,
      horizontalOverscanColumns: 0,
    })
    const scrollLeft = 2_400 * view.getState().metrics.characterWidth
    view.setText('x'.repeat(5_000))
    view.setScrollMetrics(0, 20, 80, scrollLeft)

    const chunk = view.getState().mountedRows[0]?.chunks[0]

    expect(chunk).toBeDefined()
    expect(view.textOffsetFromDomBoundary(chunk!.textNode, 5)).toBe(chunk!.startOffset + 5)
  })

  it('maps mounted DOM text boundaries back to document offsets', () => {
    view.setText('abc\ndef\nxyz')
    view.setScrollMetrics(0, 80)

    const row = view.getState().mountedRows.find((mounted) => mounted.index === 1)
    expect(row).toBeDefined()
    expect(view.textOffsetFromDomBoundary(row!.textNode, 2)).toBe(6)
  })

  it('patches same-line edits without replacing the whole row text node', () => {
    view.setText('abc\ndef')
    view.setScrollMetrics(0, 40)
    const rowZeroBefore = view.getState().mountedRows.find((row) => row.index === 0)!
    const rowOneBefore = view.getState().mountedRows.find((row) => row.index === 1)!
    const replaceData = vi.spyOn(rowZeroBefore.textNode, 'replaceData')

    view.applyEdit({ from: 1, to: 1, text: 'X' }, 'aXbc\ndef')

    const rowZeroAfter = view.getState().mountedRows.find((row) => row.index === 0)!
    const rowOneAfter = view.getState().mountedRows.find((row) => row.index === 1)!
    expect(rowZeroAfter.textNode).toBe(rowZeroBefore.textNode)
    expect(rowZeroAfter.text).toBe('aXbc')
    expect(rowZeroAfter.textNode.data).toBe('aXbc')
    expect(rowOneAfter.textNode).toBe(rowOneBefore.textNode)
    expect(rowOneAfter.startOffset).toBe(5)
    expect(view.textOffsetFromDomBoundary(rowOneAfter.textNode, 1)).toBe(6)
    expect(replaceData).toHaveBeenCalledWith(1, 0, 'X')
  })

  it('patches same-line text and current snapshot folds in one mounted-row pass', () => {
    view.dispose()
    const firstRowFolds: (VirtualizedFoldMarker | null)[] = []
    view = new VirtualizedTextView(container, {
      rowHeight: 20,
      overscan: 2,
      highlightRegistry: mockRegistry,
      gutterContributions: [
        createFoldGutterContribution(),
        {
          id: 'fold-pass-counter',
          width: () => 10,
          createCell: (document) => document.createElement('div'),
          updateCell: (_element, row) => {
            if (row.index === 0) firstRowFolds.push(row.foldMarker)
          },
        },
      ],
    })
    const text = 'root\n  child\ntail'
    const tokens = EditorTokenStore.fromTokens([{ start: 0, end: 4, style: { color: '#ff0000' } }])
    let piece = createPieceTableSnapshot(text)
    const folds = new EditorFoldState(
      view,
      () => piece,
      () => [],
    )
    view.setText(createDocumentTextSnapshot(piece))
    view.setScrollMetrics(0, 60)
    folds.setFoldProjections(
      [],
      new IndentationFoldIndex({
        snapshot: createDocumentTextSnapshot(piece),
        languageId: null,
        tabSize: 2,
      }).complete(),
    )
    view.adoptTokens(tokens)
    const first = view.getState().mountedRows[0]!
    const child = view.getState().mountedRows[1]!
    const replaceData = vi.spyOn(first.textNode, 'replaceData')
    const edit = { from: 1, to: 1, text: 'X' }
    piece = applyBatchToPieceTable(piece, [edit])
    const next = createDocumentTextSnapshot(piece)
    const fullText = vi.spyOn(next, 'materializeFullText')
    const nextIndex = new IndentationFoldIndex({
      snapshot: next,
      languageId: null,
      tabSize: 2,
    }).complete()
    const headerReads = vi.spyOn(nextIndex, 'headers')
    const allFolds = vi.spyOn(nextIndex, 'all')
    firstRowFolds.length = 0

    view.runAtomicRender(() => {
      view.applyEdit(edit, next, () => {
        expect(view['view'].model.textSnapshot).toBe(next)
        expect(first.textNode.data).toBe('root')
        folds.setFoldProjections([], nextIndex)
      })
      view.adoptTokens(projectTokensThroughEdit(tokens, edit, text))
    })

    expect(firstRowFolds).toHaveLength(1)
    expect(firstRowFolds[0]).toMatchObject({ startOffset: 5, endOffset: 13 })
    expect(replaceData).toHaveBeenCalledExactlyOnceWith(1, 0, 'X')
    expect(view.getState().mountedRows[0]!.textNode).toBe(first.textNode)
    expect(first.textNode.data).toBe('rXoot')
    expect(view.getState().mountedRows[1]!.textNode).toBe(child.textNode)
    expect(view.getState().mountedRows[1]!.startOffset).toBe(6)
    expect(tokenHighlightRangeForNode(first.textNode)?.range.endOffset).toBe(5)
    expect(fullText).not.toHaveBeenCalled()
    expect(headerReads).toHaveBeenCalledExactlyOnceWith(0, 2)
    expect(allFolds).not.toHaveBeenCalled()
  })

  it('renders the final projection when the edit callback collapses a fold', () => {
    const text = 'root\n  child\ntail'
    let piece = createPieceTableSnapshot(text)
    const folds = new EditorFoldState(
      view,
      () => piece,
      () => [],
    )
    view.setText(createDocumentTextSnapshot(piece))
    view.setScrollMetrics(0, 60)
    const edit = { from: 1, to: 1, text: 'X' }
    piece = applyBatchToPieceTable(piece, [edit])
    const next = createDocumentTextSnapshot(piece)
    const index = new IndentationFoldIndex({
      snapshot: next,
      languageId: null,
      tabSize: 2,
    }).complete()
    const replaceData = vi.spyOn(view.getState().mountedRows[0]!.textNode, 'replaceData')

    view.runAtomicRender(() => {
      view.applyEdit(edit, next, () => {
        folds.setFoldProjections([], index)
        folds.foldAll()
      })
    })

    expect(replaceData).not.toHaveBeenCalled()
    expect(view.getState().mountedRows.map((row) => row.text)).toEqual(['rXoot', 'tail'])
    expect(view.getState().mountedRows[0]!.foldCollapsed).toBe(true)
    expect(view.getState().mountedRows[1]!.startOffset).toBe(14)
  })

  it('keeps multiple same-line edits correct across a scroll inside an atomic render', () => {
    const text = 'abc\ndef\nghi\njkl\nmno'
    view.setText(text)
    view.setScrollMetrics(0, 40, 80)

    view.runAtomicRender(() => {
      view.applyEdit(
        { from: 1, to: 1, text: 'X' },
        throwingFullTextSnapshot('aXbc\ndef\nghi\njkl\nmno'),
      )
      view.setScrollMetrics(40, 40, 80)
      view.applyEdit(
        { from: 10, to: 10, text: 'Y' },
        throwingFullTextSnapshot('aXbc\ndef\ngYhi\njkl\nmno'),
      )
      view.applyEdit(
        { from: 2, to: 3, text: '' },
        throwingFullTextSnapshot('aXc\ndef\ngYhi\njkl\nmno'),
      )
    })

    expect(view.getState().mountedRows.map((row) => row.text)).toEqual([
      'aXc',
      'def',
      'gYhi',
      'jkl',
      'mno',
    ])
    expect(view.getState().mountedRows.map((row) => row.textNode.data)).toEqual([
      'aXc',
      'def',
      'gYhi',
      'jkl',
      'mno',
    ])
    const third = view.getState().mountedRows[2]!
    expect(view.textOffsetFromDomBoundary(third.textNode, 2)).toBe(10)
  })

  it('keeps the same-line text-node patch for non-RTL Unicode rows', () => {
    view.setText('café')
    view.setScrollMetrics(0, 20)
    const before = view.getState().mountedRows[0]!
    const replaceData = vi.spyOn(before.textNode, 'replaceData')

    view.applyEdit({ from: 4, to: 4, text: '!' }, 'café!')

    const after = view.getState().mountedRows[0]!
    expect(after.textNode).toBe(before.textNode)
    expect(after.textNode.data).toBe('café!')
    expect(replaceData).toHaveBeenCalledWith(4, 0, '!')
  })

  it('does not read horizontal scroll while re-rendering direct rows', () => {
    view.setText('abc\ndef')
    view.setScrollMetrics(0, 40)
    withThrowingScrollLeft(view.scrollElement, () => {
      view.applyEdit({ from: 3, to: 3, text: '\n' }, 'abc\n\ndef')
    })

    expect(view.getState().mountedRows.map((row) => row.text)).toEqual(['abc', '', 'def'])
  })

  it('applies newline edits without materializing the full next snapshot', () => {
    view.setText('abc\ndef')
    view.setScrollMetrics(0, 60)

    view.applyEdit({ from: 3, to: 3, text: '\n' }, throwingFullTextSnapshot('abc\n\ndef'))

    expect(view.getState()).toMatchObject({ lineCount: 3, totalHeight: 60 })
    expect(view.getState().mountedRows.map((row) => row.text)).toEqual(['abc', '', 'def'])
    expect(view.textOffsetFromDomBoundary(view.getState().mountedRows[2]!.textNode, 1)).toBe(6)
  })

  it('rebuilds projected rows on fallback edits without materializing the full next snapshot', () => {
    view.setText('abc\ndef')
    view.setInjectedTextRows([
      { id: 'inline-detail', anchorBufferRow: 0, placement: 'after', text: 'detail' },
    ])
    view.setScrollMetrics(0, 80)

    view.applyEdit({ from: 1, to: 1, text: 'X' }, throwingFullTextSnapshot('aXbc\ndef'))

    expect(view.getState()).toMatchObject({ lineCount: 2 })
    expect(view.getState().mountedRows.map((row) => row.text)).toEqual(['aXbc', 'detail', 'def'])
  })

  it('does not read layout while rendering seeded long-line metrics', () => {
    view.dispose()
    view = new VirtualizedTextView(container, {
      rowHeight: 20,
      overscan: 0,
      highlightRegistry: mockRegistry,
      selectionHighlightName: 'test-selection',
      longLineChunkSize: 1_000,
      longLineChunkThreshold: 1_000,
      horizontalOverscanColumns: 0,
      textMetrics: { characterWidth: 8, rowHeight: 20 },
    })
    view.setText('x'.repeat(5_000))

    withThrowingRenderLayoutReads(view.scrollElement, () => {
      view.setScrollMetrics(0, 20, 80, 0)
      view.setScrollMetrics(0, 20, 80, 2_400 * view.getState().metrics.characterWidth)
    })

    expect(view.getState().mountedRows[0]?.chunks[0]?.localStart).toBeGreaterThan(0)
  })

  it('snaps viewport fallback points outside vertical bounds to visible line edges', () => {
    view.setText('alpha\nbeta\ngamma')
    view.setScrollMetrics(0, 40)
    mockViewport(view.scrollElement, 80, 40)

    expect(view.textOffsetFromViewportPoint(8, -5)).toBe(0)
    expect(view.textOffsetFromViewportPoint(8, 45)).toBe(10)
  })

  it('maps viewport fallback points in the gutter to the line start', () => {
    view.dispose()
    view = new VirtualizedTextView(container, {
      rowHeight: 20,
      overscan: 2,
      highlightRegistry: mockRegistry,
      selectionHighlightName: 'test-selection',
      gutterContributions: [createLineGutterContribution()],
    })
    view.setText('abc\ndef')
    view.setScrollMetrics(0, 40)
    mockViewport(view.scrollElement, 120, 40)

    expect(view.textOffsetFromViewportPoint(8, 25)).toBe(4)
  })

  it('returns null for DOM boundaries outside mounted rows', () => {
    view.setText('abc\ndef')
    view.setScrollMetrics(0, 20)

    expect(view.textOffsetFromDomBoundary(container, 0)).toBeNull()
  })

  it('paints selections only across mounted row ranges', () => {
    view.setText('abc\ndef\nxyz')
    view.setScrollMetrics(0, 80)
    view.setSelection(1, 7)

    expect(selectionRanges(container)).toHaveLength(2)
    expect(highlightsMap.has('test-selection')).toBe(false)
  })

  it('shows hidden characters only for selected whitespace by default', () => {
    view.setText('a b\tc d')
    view.setScrollMetrics(0, 20)

    expect(hiddenCharacterMarkers(container)).toHaveLength(0)

    view.setSelection(1, 5)

    expect(hiddenCharacterMarkerKinds(container)).toEqual(['space', 'tab'])
    expect(textWithoutHiddenCharacterOverlay(view.scrollElement)).toBe('a b\tc d')

    view.setSelection(3, 3)

    expect(hiddenCharacterMarkers(container)).toHaveLength(0)
  })

  it('can hide hidden characters even when whitespace is selected', () => {
    view.dispose()
    view = new VirtualizedTextView(container, {
      rowHeight: 20,
      overscan: 0,
      highlightRegistry: mockRegistry,
      selectionHighlightName: 'test-selection',
      hiddenCharacters: 'hidden',
    })
    view.setText('a b\tc')
    view.setScrollMetrics(0, 20)
    view.setSelection(1, 4)

    expect(hiddenCharacterMarkers(container)).toHaveLength(0)
  })

  it('can show all mounted spaces and tabs', () => {
    view.dispose()
    view = new VirtualizedTextView(container, {
      rowHeight: 20,
      overscan: 0,
      highlightRegistry: mockRegistry,
      selectionHighlightName: 'test-selection',
      hiddenCharacters: 'show',
    })
    view.setText(' a\tb ')
    view.setScrollMetrics(0, 20)

    expect(hiddenCharacterMarkerKinds(container)).toEqual(['space', 'tab', 'space'])
    expect(hiddenCharacterMarkerOffsets(container)).toEqual(['0', '2', '4'])
    expect(textWithoutHiddenCharacterOverlay(view.scrollElement)).toBe(' a\tb ')
  })

  it('updates hidden character markers on mode changes for mounted rows', () => {
    view.setText('a b\tc')
    view.setScrollMetrics(0, 20)

    expect(hiddenCharacterMarkers(container)).toHaveLength(0)

    view.setHiddenCharacters('show')

    expect(hiddenCharacterMarkerKinds(container)).toEqual(['space', 'tab'])

    view.setHiddenCharacters('hidden')

    expect(hiddenCharacterMarkers(container)).toHaveLength(0)

    view.setSelection(1, 2)
    view.setHiddenCharacters('show-on-selection')

    expect(hiddenCharacterMarkerKinds(container)).toEqual(['space'])
  })

  it('sizes tab hidden character markers from tab visual width', () => {
    view.dispose()
    view = new VirtualizedTextView(container, {
      rowHeight: 20,
      overscan: 0,
      highlightRegistry: mockRegistry,
      selectionHighlightName: 'test-selection',
      hiddenCharacters: 'show',
    })
    view.setText('\t ')
    view.setScrollMetrics(0, 20)

    const markers = hiddenCharacterMarkers(container)
    const tabMarker = markers[0]!
    const spaceMarker = markers[1]!
    const characterWidth = view.getState().metrics.characterWidth

    expect(tabMarker.dataset.editorHiddenCharacter).toBe('tab')
    expect(Number.parseFloat(tabMarker.style.left)).toBe(0)
    expect(Number.parseFloat(tabMarker.style.width)).toBeCloseTo(characterWidth * 4)
    expect(Number.parseFloat(spaceMarker.style.left)).toBeCloseTo(characterWidth * 4)
    expect(Number.parseFloat(spaceMarker.style.width)).toBeCloseTo(characterWidth)
  })

  it('paints multiple selections and positions multiple carets', () => {
    view.setText('abc\ndef\nxyz')
    view.setScrollMetrics(0, 80)
    view.focusInput()
    view.setSelections([
      { anchorOffset: 1, headOffset: 2 },
      { anchorOffset: 5, headOffset: 7 },
    ])

    const carets = container.querySelectorAll('.editor-virtualized-caret')

    expect(selectionRanges(container)).toHaveLength(2)
    expect(carets).toHaveLength(2)
    expect((carets[0] as HTMLElement).hidden).toBe(false)
    expect((carets[1] as HTMLElement).hidden).toBe(false)
    expect((carets[0] as HTMLElement).style.transform).toBe('translate(16px, 0px)')
    expect((carets[1] as HTMLElement).style.transform).toBe('translate(24px, 20px)')
  })

  it('animates all carets through one shared blink layer', () => {
    view.setText('abc\ndef\nxyz')
    view.setScrollMetrics(0, 80)
    view.focusInput()
    view.setSelections([
      { anchorOffset: 1, headOffset: 1 },
      { anchorOffset: 5, headOffset: 5 },
    ])

    const layer = container.querySelector('.editor-virtualized-caret-layer') as HTMLElement
    const carets = container.querySelectorAll('.editor-virtualized-caret')

    expect(layer).not.toBeNull()
    expect(carets).toHaveLength(2)
    for (const caret of carets) expect(caret.parentElement).toBe(layer)
  })

  it('does not rebuild unchanged mounted selection ranges', () => {
    view.setText('abc\ndef\nxyz')
    view.setScrollMetrics(0, 80)
    view.setSelection(1, 7)

    const addCount = highlightAdds
    const clearCount = highlightClears
    view.setSelection(1, 7)

    expect(highlightAdds).toBe(addCount)
    expect(highlightClears).toBe(clearCount)
  })

  it('positions a collapsed caret without native range measurement', () => {
    const originalGetClientRects = Range.prototype.getClientRects
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: () => {
        throw new Error('unexpected native range measurement')
      },
    })

    try {
      view.setText('abcd\ndef')
      view.setScrollMetrics(0, 40)
      view.focusInput()
      view.setSelection(2, 2)
    } finally {
      restoreRangeGetClientRects(originalGetClientRects)
    }

    const caret = container.querySelector('.editor-virtualized-caret') as HTMLElement
    expect(caret.hidden).toBe(false)
    expect(caret.style.transform).toBe('translate(16px, 0px)')
  })

  it('positions a caret at the end of a selection', () => {
    view.setText('abcd\ndef')
    view.setScrollMetrics(0, 40)
    view.focusInput()
    view.setSelection(1, 6)

    const caret = container.querySelector('.editor-virtualized-caret') as HTMLElement
    expect(caret.hidden).toBe(false)
    expect(caret.style.transform).toBe('translate(8px, 20px)')
  })

  it('positions a caret at the head of a reversed selection', () => {
    view.setText('abcd\ndef')
    view.setScrollMetrics(0, 40)
    view.focusInput()
    view.setSelection(6, 1)

    const caret = container.querySelector('.editor-virtualized-caret') as HTMLElement
    expect(caret.hidden).toBe(false)
    expect(caret.style.transform).toBe('translate(8px, 0px)')
  })

  it('paints selections only across mounted horizontal chunks', () => {
    view.dispose()
    view = new VirtualizedTextView(container, {
      rowHeight: 20,
      overscan: 0,
      highlightRegistry: mockRegistry,
      selectionHighlightName: 'test-selection',
      longLineChunkSize: 1_000,
      longLineChunkThreshold: 1_000,
      horizontalOverscanColumns: 0,
    })
    view.setText('x'.repeat(5_000))
    view.setScrollMetrics(0, 20, 80)
    view.setSelection(0, 5_000)

    expect(selectionRanges(container)).toHaveLength(1)
    expect(selectionRanges(container)[0]?.dataset.editorSelectionRect).toBeDefined()
    expect(selectionRanges(container)[0]?.dataset.editorSelectionStart).toBeUndefined()
    expect(selectionRanges(container)[0]?.dataset.editorSelectionEnd).toBeUndefined()
  })

  it('repaints stored selections when new rows mount', () => {
    view.setText(createLines(200))
    view.setScrollMetrics(0, 40)
    view.setSelection(900, 930)

    expect(selectionRanges(container)).toHaveLength(0)

    view.setScrollMetrics(2_200, 80)

    expect(selectionRanges(container).length).toBeGreaterThan(0)
  })

  it('creates token highlights for mounted token intersections', () => {
    view.setText('const x = 1;\nconst y = 2;')
    view.setScrollMetrics(0, 40)
    view.setTokens([{ start: 0, end: 5, style: { color: '#ff0000' } }])

    const tokenHighlight = [...highlightsMap.keys()].find((name) => name.includes('-token-'))
    expect(tokenHighlight).toBeDefined()
    expect(highlightsMap.get(tokenHighlight!)?.size).toBe(1)
  })

  it('ignores empty token ranges before registering token highlights', () => {
    view.setText('const x = 1;')
    view.setScrollMetrics(0, 40)
    view.setTokens([
      { start: 0, end: 0, style: { color: '#ff0000' } },
      { start: 0, end: 5, style: { color: '#ff0000' } },
    ])

    const ranges = tokenHighlightRanges()

    expect(ranges).toHaveLength(1)
    expect(ranges[0]?.startOffset).toBe(0)
    expect(ranges[0]?.endOffset).toBe(5)
  })

  it('splits token highlights across intersecting mounted rows', () => {
    view.setText('alpha\nbeta\ngamma')
    view.setScrollMetrics(0, 80)
    view.setTokens([{ start: 2, end: 10, style: { color: '#ff0000' } }])

    const ranges = tokenHighlightRanges()
    const rows = view.getState().mountedRows

    expect(ranges).toHaveLength(2)
    expect(ranges[0]!.startContainer).toBe(rows[0]!.textNode)
    expect(ranges[0]!.startOffset).toBe(2)
    expect(ranges[0]!.endOffset).toBe(5)
    expect(ranges[1]!.startContainer).toBe(rows[1]!.textNode)
    expect(ranges[1]!.startOffset).toBe(0)
    expect(ranges[1]!.endOffset).toBe(4)
  })

  it('renders token highlights from unsorted token input', () => {
    view.setText('first\nsecond')
    view.setScrollMetrics(0, 40)
    view.setTokens([
      { start: 6, end: 12, style: { color: '#00ff00' } },
      { start: 0, end: 5, style: { color: '#ff0000' } },
    ])

    const rows = view.getState().mountedRows
    const first = tokenHighlightRangeForNode(rows[0]!.textNode)
    const second = tokenHighlightRangeForNode(rows[1]!.textNode)

    expect(first?.range.startOffset).toBe(0)
    expect(first?.range.endOffset).toBe(5)
    expect(second?.range.startOffset).toBe(0)
    expect(second?.range.endOffset).toBe(6)
  })

  it('does not visit offscreen Tree-sitter tokens while rendering the viewport', () => {
    const lines = createLines(10_000).split('\n')
    const captures = lineStartOffsets(lines).map((offset) => ({
      captureName: 'variable',
      endIndex: offset + 4,
      startIndex: offset,
    }))
    const tokens = EditorTokenStore.fromTokens(treeSitterCapturesToEditorTokens(captures))
    const walk = vi.spyOn(tokens, 'forEachInRange')

    view.setText(lines.join('\n'))
    view.setScrollMetrics(0, 20)
    view.adoptTokens(tokens)

    const visited = walk.mock.calls.reduce((sum, [from, to]) => sum + Math.max(0, to - from), 0)
    expect(tokenHighlightRanges().length).toBeGreaterThan(0)
    expect(visited).toBeLessThanOrEqual(view.getState().mountedRows.length)
  })

  it('rebuilds token style rules once for indexed viewport styles', () => {
    const lines = ['first', 'second', 'third']
    const offsets = lineStartOffsets(lines)
    const tokens = treeSitterCapturesToEditorTokens([
      { captureName: 'variable', startIndex: offsets[0]!, endIndex: offsets[0]! + 5 },
      { captureName: 'string', startIndex: offsets[1]!, endIndex: offsets[1]! + 6 },
      { captureName: 'keyword', startIndex: offsets[2]!, endIndex: offsets[2]! + 5 },
    ])

    view.setText(lines.join('\n'))
    view.setScrollMetrics(0, 60)

    const styleWrites = countStyleTextContentWrites(() => view.setTokens(tokens))

    expect(styleWrites).toBe(1)
    expect(tokenHighlightNames()).toHaveLength(3)
  })

  it('rebuilds the edited row when a boundary insert expands projected tokens', () => {
    view.setText('world')
    view.setScrollMetrics(0, 20)
    view.setTokens([{ start: 0, end: 5, style: { color: '#ff0000' } }])

    const tokenHighlightName = tokenHighlightNames()[0]!
    const tokenHighlight = highlightsMap.get(tokenHighlightName)!
    const previousRange = [...tokenHighlight][0]!
    const addCount = highlightAdds
    const deleteCount = highlightDeletes
    highlightClears = 0

    view.applyEdit({ from: 5, to: 5, text: 'X' }, 'worldX')
    view.setTokens([{ start: 0, end: 6, style: { color: '#ff0000' } }])

    const ranges = [...tokenHighlight]
    expect(highlightsMap.get(tokenHighlightName)).toBe(tokenHighlight)
    expect(highlightClears).toBe(0)
    expect(highlightAdds).toBe(addCount + 1)
    expect(highlightDeletes).toBe(deleteCount + 1)
    expect(ranges).toHaveLength(1)
    expect(ranges).not.toContain(previousRange)
    expect(ranges[0]!.endOffset).toBe(6)
  })

  it('does not invalidate live token ranges when adopting current projected tokens again', () => {
    const text = 'world'
    const edit = { from: 2, to: 2, text: 'X' }
    const tokens = EditorTokenStore.fromTokens([{ start: 0, end: 5, style: { color: '#ff0000' } }])
    view.setText(text)
    view.setScrollMetrics(0, 20)
    view.adoptTokens(tokens)

    view.applyEdit(edit, 'woXrld')
    const projected = projectTokensThroughEdit(tokens, edit, text)
    view.adoptTokens(projected)
    const tokenHighlightName = tokenHighlightNames()[0]!
    const tokenHighlight = highlightsMap.get(tokenHighlightName)!
    const ranges = [...tokenHighlight]
    const addCount = highlightAdds
    const deleteCount = highlightDeletes
    highlightClears = 0

    view.adoptTokens(projected)

    expect(highlightsMap.get(tokenHighlightName)).toBe(tokenHighlight)
    expect(highlightClears).toBe(0)
    expect(highlightAdds).toBe(addCount)
    expect(highlightDeletes).toBe(deleteCount)
    expect([...tokenHighlight]).toEqual(ranges)
  })

  it('does not rescan token styles when same-line edits keep live token ranges', () => {
    view.setText('world')
    view.setScrollMetrics(0, 20)
    const tokens = EditorTokenStore.fromTokens([{ start: 0, end: 5, style: { color: '#ff0000' } }])
    view.adoptTokens(tokens)
    const stringify = vi.spyOn(JSON, 'stringify')

    try {
      view.applyEdit({ from: 2, to: 2, text: 'X' }, 'woXrld')
      const projected = projectTokensThroughEdit(tokens, { from: 2, to: 2, text: 'X' }, 'world')
      const scans = watchTokenComparisons(tokens, projected)

      view.setTokens(projected)

      const tokenStyleCalls = stringify.mock.calls.filter(([value]) =>
        isTokenStyleSerializationInput(value),
      )
      expect(tokenStyleCalls).toHaveLength(0)
      expect(scans()).toBe(0)
    } finally {
      stringify.mockRestore()
    }
  })

  it('adopts projected tokens without rescanning styles when live ranges survive', () => {
    view.setText('world')
    view.setScrollMetrics(0, 20)
    const tokens = EditorTokenStore.fromTokens([{ start: 0, end: 5, style: { color: '#ff0000' } }])
    view.adoptTokens(tokens)
    const stringify = vi.spyOn(JSON, 'stringify')

    try {
      view.applyEdit({ from: 2, to: 2, text: 'X' }, 'woXrld')
      const projected = projectTokensThroughEdit(tokens, { from: 2, to: 2, text: 'X' }, 'world')
      const scans = watchTokenComparisons(tokens, projected)

      view.adoptTokens(projected)

      const tokenStyleCalls = stringify.mock.calls.filter(([value]) =>
        isTokenStyleSerializationInput(value),
      )
      expect(tokenStyleCalls).toHaveLength(0)
      expect(scans()).toBe(0)
    } finally {
      stringify.mockRestore()
    }
  })

  it('does not equality-scan projected tokens when live ranges cannot be reused', () => {
    view.dispose()
    view = new VirtualizedTextView(container, {
      rowHeight: 20,
      overscan: 2,
      selectionHighlightName: 'test-selection',
    })
    const style = { color: '#ff0000' }
    const tokenCount = 200
    const text = 'a '.repeat(tokenCount)
    const tokens = EditorTokenStore.fromTokens(
      Array.from({ length: tokenCount }, (_, index) => ({
        start: index * 2,
        end: index * 2 + 1,
        style,
      })),
    )
    view.setText(text)
    view.adoptTokens(tokens)

    const projected = projectTokensThroughEdit(tokens, { from: 0, to: 1, text: 'b' }, text)
    const scans = watchTokenComparisons(tokens, projected)

    view.adoptTokens(projected)

    expect(scans()).toBe(0)
    expect(view['view'].tokens).toBe(projected)
  })

  it('keeps token highlights below same-line edits when local segments match', () => {
    view.setText('aa\nbb')
    view.setScrollMetrics(0, 40)
    view.setTokens([
      { start: 0, end: 2, style: { color: '#ff0000' } },
      { start: 3, end: 5, style: { color: '#ff0000' } },
    ])

    const rowOne = view.getState().mountedRows.find((row) => row.index === 1)!
    const previous = tokenHighlightRangeForNode(rowOne.textNode)
    expect(previous).toBeDefined()

    view.applyEdit({ from: 1, to: 1, text: 'X' }, 'aXa\nbb')
    view.setTokens([
      { start: 0, end: 1, style: { color: '#ff0000' } },
      { start: 1, end: 3, style: { color: '#00ff00' } },
      { start: 4, end: 6, style: { color: '#ff0000' } },
    ])

    const next = tokenHighlightRangeForNode(rowOne.textNode)
    expect(next).toBeDefined()
    expect([...previous!.highlight]).toContain(previous!.range)
    expect(next!.range.startContainer).toBe(rowOne.textNode)
    expect(next!.range.startOffset).toBe(0)
    expect(next!.range.endOffset).toBe(2)
  })

  it('rebuilds token highlights below same-line edits when local styles change', () => {
    view.setText('aa\nbb')
    view.setScrollMetrics(0, 40)
    view.setTokens([
      { start: 0, end: 2, style: { color: '#ff0000' } },
      { start: 3, end: 5, style: { color: '#ff0000' } },
    ])

    const rowOne = view.getState().mountedRows.find((row) => row.index === 1)!
    const previous = tokenHighlightRangeForNode(rowOne.textNode)
    expect(previous).toBeDefined()

    view.applyEdit({ from: 1, to: 1, text: 'X' }, 'aXa\nbb')
    view.setTokens([
      { start: 0, end: 1, style: { color: '#ff0000' } },
      { start: 1, end: 3, style: { color: '#00ff00' } },
      { start: 4, end: 6, style: { color: '#0000ff' } },
    ])

    const next = tokenHighlightRangeForNode(rowOne.textNode)
    expect(next).toBeDefined()
    expect([...previous!.highlight]).not.toContain(previous!.range)
    expect(next!.range).not.toBe(previous!.range)
    expect(next!.range.startContainer).toBe(rowOne.textNode)
    expect(next!.range.startOffset).toBe(0)
    expect(next!.range.endOffset).toBe(2)
  })

  it('keeps lower-row token highlights at row-local offsets across repeated typing', () => {
    let text = 'aa\nbb\ncc'
    let tokens = EditorTokenStore.fromTokens([
      { start: 0, end: 2, style: { color: '#ff0000' } },
      { start: 3, end: 5, style: { color: '#ff0000' } },
      { start: 6, end: 8, style: { color: '#ff0000' } },
    ])
    view.setText(text)
    view.setScrollMetrics(0, 60)
    view.setTokens(tokens)

    for (const typed of ['X', 'Y']) {
      const edit = { from: 1, to: 1, text: typed }
      const nextText = `${text.slice(0, edit.from)}${typed}${text.slice(edit.to)}`
      const rowOne = view.getState().mountedRows.find((row) => row.index === 1)!
      const previous = tokenHighlightRangeForNode(rowOne.textNode)

      view.applyEdit(edit, nextText)
      tokens = projectTokensThroughEdit(tokens, edit, text)
      // Object tokens carry no provenance, so this takes the comparison path.
      view.setTokens(tokens.toTokens())
      text = nextText

      const next = tokenHighlightRangeForNode(rowOne.textNode)
      expect(next).toBeDefined()
      if (previous) expect([...previous.highlight]).toContain(previous.range)
      expect(next!.range.startContainer).toBe(rowOne.textNode)
      expect(next!.range.startOffset).toBe(0)
      expect(next!.range.endOffset).toBe(2)
    }
  })

  it('keeps lower-row token highlights static when adopting projected tokens repeatedly', () => {
    let text = 'aa\nbb\ncc'
    let tokens = EditorTokenStore.fromTokens([
      { start: 0, end: 2, style: { color: '#ff0000' } },
      { start: 3, end: 5, style: { color: '#ff0000' } },
      { start: 6, end: 8, style: { color: '#ff0000' } },
    ])
    view.setText(text)
    view.setScrollMetrics(0, 60)
    view.adoptTokens(tokens)

    for (const typed of ['X', 'Y']) {
      const edit = { from: 1, to: 1, text: typed }
      const nextText = `${text.slice(0, edit.from)}${typed}${text.slice(edit.to)}`
      view.applyEdit(edit, nextText)
      const projected = projectTokensThroughEdit(tokens, edit, text)
      view.adoptTokens(projected)
      view.adoptTokens(projected)
      tokens = projected
      text = nextText

      const rowOne = view.getState().mountedRows.find((row) => row.index === 1)!
      const range = tokenHighlightRangeForNode(rowOne.textNode)
      expect(range).toBeDefined()
      expect(range!.range.startContainer).toBe(rowOne.textNode)
      expect(range!.range.startOffset).toBe(0)
      expect(range!.range.endOffset).toBe(2)
    }
  })

  it('keeps projected lower-row highlights static after an intervening viewport render', () => {
    const text = 'aa\nbb\ncc'
    const edit = { from: 1, to: 1, text: 'X' }
    const tokens = EditorTokenStore.fromTokens([
      { start: 0, end: 2, style: { color: '#ff0000' } },
      { start: 3, end: 5, style: { color: '#ff0000' } },
      { start: 6, end: 8, style: { color: '#ff0000' } },
    ])
    view.setText(text)
    view.setScrollMetrics(0, 60, 100)
    view.adoptTokens(tokens)

    view.applyEdit(edit, 'aXa\nbb\ncc')
    view.setScrollMetrics(0, 60, 120)
    const projected = projectTokensThroughEdit(tokens, edit, text)
    view.adoptTokens(projected)

    const rowOne = view.getState().mountedRows.find((row) => row.index === 1)!
    const range = tokenHighlightRangeForNode(rowOne.textNode)
    expect(range).toBeDefined()
    expect(range!.range.startContainer).toBe(rowOne.textNode)
    expect(range!.range.startOffset).toBe(0)
    expect(range!.range.endOffset).toBe(2)
  })

  it('does not render shifted stale tokens below an edit before projection lands', () => {
    const text = 'aa\nbb\ncc\n'
    const edit = { from: 1, to: 1, text: 'X' }
    const tokens = EditorTokenStore.fromTokens([
      { start: 0, end: 2, style: { color: '#ff0000' } },
      { start: 3, end: 5, style: { color: '#ff0000' } },
      { start: 6, end: 8, style: { color: '#ff0000' } },
    ])
    view.setText(text)
    view.setScrollMetrics(0, 60, 100)
    view.adoptTokens(tokens)

    view.applyEdit(edit, 'aXa\nbb\ncc\n')
    view.setScrollMetrics(20, 60, 100)

    const rowOne = view.getState().mountedRows.find((row) => row.index === 1)!
    const staleRange = tokenHighlightRangeForNode(rowOne.textNode)
    expect(staleRange).toBeDefined()
    expect(staleRange!.range.startContainer).toBe(rowOne.textNode)
    expect(staleRange!.range.startOffset).toBe(0)
    expect(staleRange!.range.endOffset).toBe(2)
  })

  it('fills rows mounted during a stale-token render after projected tokens land', () => {
    const text = 'aa\nbb\ncc\ndd\nee\nff'
    const edit = { from: 1, to: 1, text: 'X' }
    const tokens = EditorTokenStore.fromTokens([
      { start: 0, end: 2, style: { color: '#ff0000' } },
      { start: 3, end: 5, style: { color: '#ff0000' } },
      { start: 6, end: 8, style: { color: '#ff0000' } },
      { start: 9, end: 11, style: { color: '#ff0000' } },
      { start: 12, end: 14, style: { color: '#ff0000' } },
      { start: 15, end: 17, style: { color: '#ff0000' } },
    ])
    view.setText(text)
    view.setScrollMetrics(0, 20, 100)
    view.adoptTokens(tokens)

    view.applyEdit(edit, 'aXa\nbb\ncc\ndd\nee\nff')
    view.setScrollMetrics(80, 20, 100)
    const projected = projectTokensThroughEdit(tokens, edit, text)
    view.adoptTokens(projected)

    const rowFive = view.getState().mountedRows.find((row) => row.index === 5)!
    const range = tokenHighlightRangeForNode(rowFive.textNode)
    expect(range).toBeDefined()
    expect(range!.range.startContainer).toBe(rowFive.textNode)
    expect(range!.range.startOffset).toBe(0)
    expect(range!.range.endOffset).toBe(2)
  })

  it('does not render shifted stale tokens below a newline before projection lands', () => {
    const text = 'aa\nbb\ncc'
    const edit = { from: 1, to: 1, text: '\n' }
    const tokens = EditorTokenStore.fromTokens([
      { start: 0, end: 2, style: { color: '#ff0000' } },
      { start: 3, end: 5, style: { color: '#00ff00' } },
      { start: 6, end: 8, style: { color: '#0000ff' } },
    ])
    view.setText(text)
    view.setScrollMetrics(0, 80, 100)
    view.adoptTokens(tokens)

    view.applyEdit(edit, 'a\na\nbb\ncc')

    const rowTwo = view.getState().mountedRows.find((row) => row.index === 2)!
    expect(rowTwo.text).toBe('bb')
    expect(tokenHighlightRangeForNode(rowTwo.textNode)).toBeUndefined()

    const projected = projectTokensThroughEdit(tokens, edit, text)
    view.adoptTokens(projected)

    const range = tokenHighlightRangeForNode(rowTwo.textNode)!
    expect(range.range.startContainer).toBe(rowTwo.textNode)
    expect(range.range.startOffset).toBe(0)
    expect(range.range.endOffset).toBe(2)
    expect(tokenHighlightColorForNode(rowTwo.textNode)).toBe('#00ff00')
  })

  it('keeps lower-row highlights static after a newline followed by rapid typing', () => {
    let text = 'aa\nbb\ncc'
    let tokens = EditorTokenStore.fromTokens([
      { start: 0, end: 2, style: { color: '#ff0000' } },
      { start: 3, end: 5, style: { color: '#00ff00' } },
      { start: 6, end: 8, style: { color: '#0000ff' } },
    ])
    view.setText(text)
    view.setScrollMetrics(0, 80, 100)
    view.adoptTokens(tokens)

    const newlineEdit = { from: 1, to: 1, text: '\n' }
    const textAfterNewline = 'a\na\nbb\ncc'
    view.applyEdit(newlineEdit, textAfterNewline)
    const projectedAfterNewline = projectTokensThroughEdit(tokens, newlineEdit, text)
    view.adoptTokens(projectedAfterNewline)
    tokens = projectedAfterNewline
    text = textAfterNewline
    let previousLowerRange = tokenHighlightRangeForNode(
      view.getState().mountedRows.find((row) => row.text === 'bb')!.textNode,
    )?.range

    for (const typed of ['X', 'Y']) {
      const edit = { from: 2, to: 2, text: typed }
      const nextText = `${text.slice(0, edit.from)}${typed}${text.slice(edit.to)}`
      view.applyEdit(edit, nextText)
      const projected = projectTokensThroughEdit(tokens, edit, text)
      view.adoptTokens(projected)
      view.adoptTokens(projected)
      tokens = projected
      text = nextText

      const rowTwo = view.getState().mountedRows.find((row) => row.index === 2)!
      expect(rowTwo.text).toBe('bb')
      const range = tokenHighlightRangeForNode(rowTwo.textNode)
      expect(range).toBeDefined()
      // Provenance survives the edit, so the row below keeps its live range.
      expect(range!.range).toBe(previousLowerRange)
      expect(range!.range.startContainer).toBe(rowTwo.textNode)
      expect(range!.range.startOffset).toBe(0)
      expect(range!.range.endOffset).toBe(2)
      expect(tokenHighlightColorForNode(rowTwo.textNode)).toBe('#00ff00')
      previousLowerRange = range!.range
    }
  })

  it('rebuilds lower-row highlights in place when typed projections lose their provenance', () => {
    let text = 'aa\nbb\ncc'
    let tokens = EditorTokenStore.fromTokens([
      { start: 0, end: 2, style: { color: '#ff0000' } },
      { start: 3, end: 5, style: { color: '#00ff00' } },
      { start: 6, end: 8, style: { color: '#0000ff' } },
    ])
    view.setText(text)
    view.setScrollMetrics(0, 80, 100)
    view.adoptTokens(tokens)

    const newlineEdit = { from: 1, to: 1, text: '\n' }
    const textAfterNewline = 'a\na\nbb\ncc'
    view.applyEdit(newlineEdit, textAfterNewline)
    const projectedAfterNewline = projectTokensThroughEdit(tokens, newlineEdit, text)
    view.adoptTokens(projectedAfterNewline)
    tokens = EditorTokenStore.fromTokens(projectedAfterNewline.toTokens())
    text = textAfterNewline
    let previousLowerRange = tokenHighlightRangeForNode(
      view.getState().mountedRows.find((row) => row.text === 'bb')!.textNode,
    )?.range

    for (const typed of ['X', 'Y']) {
      const edit = { from: 2, to: 2, text: typed }
      const nextText = `${text.slice(0, edit.from)}${typed}${text.slice(edit.to)}`
      view.applyEdit(edit, nextText)
      const projected = projectTokensThroughEdit(tokens, edit, text)
      view.adoptTokens(projected)
      view.adoptTokens(projected)
      // A store rebuilt from objects is an answer with no claim about the one it replaces.
      tokens = EditorTokenStore.fromTokens(projected.toTokens())
      text = nextText

      const rowTwo = view.getState().mountedRows.find((row) => row.index === 2)!
      expect(rowTwo.text).toBe('bb')
      const range = tokenHighlightRangeForNode(rowTwo.textNode)
      expect(range).toBeDefined()
      if (previousLowerRange) expect([...range!.highlight]).not.toContain(previousLowerRange)
      expect(range!.range.startContainer).toBe(rowTwo.textNode)
      expect(range!.range.startOffset).toBe(0)
      expect(range!.range.endOffset).toBe(2)
      expect(tokenHighlightColorForNode(rowTwo.textNode)).toBe('#00ff00')
      previousLowerRange = range!.range
    }
  })

  it('does not push lower-row highlights after a newline and same-line edit above them', () => {
    let lines = Array.from({ length: 90 }, (_, index) => ` ${index.toString().padStart(2, '0')}`)
    let text = lines.join('\n')
    let offsets = lineStartOffsets(lines)
    const style = { color: '#00ff00' }
    let tokens = EditorTokenStore.fromTokens(
      offsets.map((offset) => ({ start: offset + 1, end: offset + 3, style })),
    )
    view.setText(text)
    view.setScrollMetrics(0, 2000, 100)
    view.adoptTokens(tokens)

    const newlineEdit = { from: offsets[10]! + 1, to: offsets[10]! + 1, text: '\n' }
    text = `${text.slice(0, newlineEdit.from)}\n${text.slice(newlineEdit.to)}`
    view.applyEdit(newlineEdit, text)
    tokens = projectTokensThroughEdit(tokens, newlineEdit, lines.join('\n'))
    view.adoptTokens(tokens)

    lines = text.split('\n')
    offsets = lineStartOffsets(lines)
    const targetRowBefore = view.getState().mountedRows.find((row) => row.text === ' 12')!
    const targetRangeBefore = tokenHighlightRangeForNode(targetRowBefore.textNode)
    expect(targetRangeBefore).toBeDefined()
    expect(targetRangeBefore!.range.startOffset).toBe(1)
    expect(targetRangeBefore!.range.endOffset).toBe(3)

    const sameLineEdit = { from: offsets[11]!, to: offsets[11]!, text: 'X' }
    const previousText = text
    text = `${text.slice(0, sameLineEdit.from)}X${text.slice(sameLineEdit.to)}`
    view.applyEdit(sameLineEdit, text)
    tokens = projectTokensThroughEdit(tokens, sameLineEdit, previousText)
    view.adoptTokens(tokens)

    const targetRowAfter = view.getState().mountedRows.find((row) => row.text === ' 12')!
    const targetRangeAfter = tokenHighlightRangeForNode(targetRowAfter.textNode)
    expect(targetRangeAfter).toBeDefined()
    expect(targetRangeAfter!.range.startContainer).toBe(targetRowAfter.textNode)
    expect(targetRangeAfter!.range.startOffset).toBe(1)
    expect(targetRangeAfter!.range.endOffset).toBe(3)
    expect(tokenHighlightColorForNode(targetRowAfter.textNode)).toBe('#00ff00')
  })

  it('keeps lower-row highlights static while alternating newlines and typing', () => {
    let text = 'aa\nbb\ncc'
    let tokens = EditorTokenStore.fromTokens([
      { start: 0, end: 2, style: { color: '#ff0000' } },
      { start: 3, end: 5, style: { color: '#00ff00' } },
      { start: 6, end: 8, style: { color: '#0000ff' } },
    ])
    view.setText(text)
    view.setScrollMetrics(0, 100, 100)
    view.adoptTokens(tokens)

    for (const edit of [
      { from: 1, to: 1, text: '\n' },
      { from: 2, to: 2, text: 'X' },
      { from: 3, to: 3, text: '\n' },
      { from: 4, to: 4, text: 'Y' },
    ]) {
      const nextText = `${text.slice(0, edit.from)}${edit.text}${text.slice(edit.to)}`
      view.applyEdit(edit, nextText)
      const projected = projectTokensThroughEdit(tokens, edit, text)
      view.adoptTokens(projected)
      view.adoptTokens(projected)
      tokens = projected
      text = nextText
    }

    const targetRow = view.getState().mountedRows.find((row) => row.text === 'bb')!
    const range = tokenHighlightRangeForNode(targetRow.textNode)
    expect(range).toBeDefined()
    expect(range!.range.startContainer).toBe(targetRow.textNode)
    expect(range!.range.startOffset).toBe(0)
    expect(range!.range.endOffset).toBe(2)
    expect(tokenHighlightColorForNode(targetRow.textNode)).toBe('#00ff00')
  })

  it('keeps lower-row highlights static through repeated mixed inserts above them', () => {
    let text = 'aa\nbb\ncc'
    let tokens = EditorTokenStore.fromTokens([
      { start: 0, end: 2, style: { color: '#ff0000' } },
      { start: 3, end: 5, style: { color: '#00ff00' } },
      { start: 6, end: 8, style: { color: '#0000ff' } },
    ])
    view.setText(text)
    view.setScrollMetrics(0, 160, 100)
    view.adoptTokens(tokens)

    for (const inserted of ['X', '\n', 'Y', 'Z', '\n', 'W', '\n', 'Q']) {
      const targetOffset = text.indexOf('bb')
      const editOffset = Math.max(0, targetOffset - 1)
      const edit = { from: editOffset, to: editOffset, text: inserted }
      const nextText = `${text.slice(0, edit.from)}${inserted}${text.slice(edit.to)}`
      view.applyEdit(edit, nextText)
      const projected = projectTokensThroughEdit(tokens, edit, text)
      view.adoptTokens(projected)
      tokens = projected
      text = nextText

      const targetRow = view.getState().mountedRows.find((row) => row.text === 'bb')!
      const range = tokenHighlightRangeForNode(targetRow.textNode)
      expect(range).toBeDefined()
      expect(range!.range.startContainer).toBe(targetRow.textNode)
      expect(range!.range.startOffset).toBe(0)
      expect(range!.range.endOffset).toBe(2)
      expect(tokenHighlightColorForNode(targetRow.textNode)).toBe('#00ff00')
    }
  })

  it('keeps lower-row highlights static through repeated newline-only inserts above them', () => {
    const lines = Array.from({ length: 90 }, (_, index) => ` ${index.toString().padStart(2, '0')}`)
    let text = lines.join('\n')
    const style = { color: '#00ff00' }
    let tokens = EditorTokenStore.fromTokens(
      lineStartOffsets(lines).map((offset) => ({ start: offset + 1, end: offset + 3, style })),
    )
    view.setText(text)
    view.setScrollMetrics(0, 2000, 100)
    view.adoptTokens(tokens)

    for (let count = 0; count < 5; count += 1) {
      const targetOffset = text.indexOf(' 12')
      const edit = { from: targetOffset, to: targetOffset, text: '\n' }
      const previousText = text
      text = `${text.slice(0, edit.from)}\n${text.slice(edit.to)}`
      view.applyEdit(edit, text)
      tokens = projectTokensThroughEdit(tokens, edit, previousText)
      view.adoptTokens(tokens)

      const targetRow = view.getState().mountedRows.find((row) => row.text === ' 12')!
      const range = tokenHighlightRangeForNode(targetRow.textNode)
      expect(range).toBeDefined()
      expect(range!.range.startContainer).toBe(targetRow.textNode)
      expect(range!.range.startOffset).toBe(1)
      expect(range!.range.endOffset).toBe(3)
      expect(tokenHighlightColorForNode(targetRow.textNode)).toBe('#00ff00')
    }
  })

  it('does not render shifted stale tokens below a deleted newline before projection lands', () => {
    const text = 'a\na\nbb\ncc'
    const edit = { from: 1, to: 2, text: '' }
    const tokens = EditorTokenStore.fromTokens([
      { start: 0, end: 1, style: { color: '#ff0000' } },
      { start: 2, end: 3, style: { color: '#ffaa00' } },
      { start: 4, end: 6, style: { color: '#00ff00' } },
      { start: 7, end: 9, style: { color: '#0000ff' } },
    ])
    view.setText(text)
    view.setScrollMetrics(0, 80, 100)
    view.adoptTokens(tokens)

    view.applyEdit(edit, 'aa\nbb\ncc')

    const rowOne = view.getState().mountedRows.find((row) => row.index === 1)!
    expect(rowOne.text).toBe('bb')
    expect(tokenHighlightRangeForNode(rowOne.textNode)).toBeUndefined()

    const projected = projectTokensThroughEdit(tokens, edit, text)
    view.adoptTokens(projected)

    const range = tokenHighlightRangeForNode(rowOne.textNode)!
    expect(range.range.startContainer).toBe(rowOne.textNode)
    expect(range.range.startOffset).toBe(0)
    expect(range.range.endOffset).toBe(2)
    expect(tokenHighlightColorForNode(rowOne.textNode)).toBe('#00ff00')
  })

  it('moves fold controls through newline inserts before syntax returns', () => {
    view.dispose()
    view = new VirtualizedTextView(container, {
      rowHeight: 20,
      overscan: 2,
      highlightRegistry: mockRegistry,
      selectionHighlightName: 'test-selection',
      gutterContributions: [createFoldGutterContribution()],
    })
    const lines = ['a', 'if (x) {', '  y();', '}']
    const offsets = lineStartOffsets(lines)
    view.setText(lines.join('\n'))
    view.setFoldMarkers([
      {
        key: 'fold-if',
        startOffset: offsets[1]!,
        endOffset: offsets[3]!,
        startRow: 1,
        endRow: 2,
        collapsed: false,
      },
    ])
    view.setScrollMetrics(0, 100, 100)

    view.applyEdit({ from: 0, to: 0, text: '\n' }, `\n${lines.join('\n')}`)

    const gutterRow = visibleFoldButton(container).closest('[data-editor-virtual-gutter-row]')
    expect(gutterRow?.getAttribute('data-editor-virtual-gutter-row')).toBe('2')
  })

  it('moves fold controls through deleted newlines before syntax returns', () => {
    view.dispose()
    view = new VirtualizedTextView(container, {
      rowHeight: 20,
      overscan: 2,
      highlightRegistry: mockRegistry,
      selectionHighlightName: 'test-selection',
      gutterContributions: [createFoldGutterContribution()],
    })
    const text = '\na\nif (x) {\n  y();\n}'
    const lines = text.split('\n')
    const offsets = lineStartOffsets(lines)
    view.setText(text)
    view.setFoldMarkers([
      {
        key: 'fold-if',
        startOffset: offsets[2]!,
        endOffset: offsets[4]!,
        startRow: 2,
        endRow: 3,
        collapsed: false,
      },
    ])
    view.setScrollMetrics(0, 100, 100)

    view.applyEdit({ from: 0, to: 1, text: '' }, 'a\nif (x) {\n  y();\n}')

    const gutterRow = visibleFoldButton(container).closest('[data-editor-virtual-gutter-row]')
    expect(gutterRow?.getAttribute('data-editor-virtual-gutter-row')).toBe('1')
  })

  it('moves row decorations through newline inserts and deletes', () => {
    view.setText('aa\nbb\ncc')
    view.setScrollMetrics(0, 100, 100)
    view.setRowDecorations(new Map([[2, { className: 'scope-line' }]]))

    view.applyEdit({ from: 0, to: 0, text: '\n' }, '\naa\nbb\ncc')

    expect(container.querySelector('[data-editor-virtual-row="2"]')?.className ?? '').not.toContain(
      'scope-line',
    )
    expect(container.querySelector('[data-editor-virtual-row="3"]')?.className ?? '').toContain(
      'scope-line',
    )

    view.applyEdit({ from: 0, to: 1, text: '' }, 'aa\nbb\ncc')

    expect(container.querySelector('[data-editor-virtual-row="3"]')?.className ?? '').not.toContain(
      'scope-line',
    )
    expect(container.querySelector('[data-editor-virtual-row="2"]')?.className ?? '').toContain(
      'scope-line',
    )
  })

  it('does not repaint when the token list is unchanged', () => {
    const tokens = [{ start: 0, end: 5, style: { color: '#ff0000' } }]
    view.setText('world')
    view.setScrollMetrics(0, 20)
    view.setTokens(tokens)

    const addCount = highlightAdds
    const deleteCount = highlightDeletes
    highlightClears = 0
    view.setTokens([{ start: 0, end: 5, style: { color: '#ff0000' } }])

    expect(highlightClears).toBe(0)
    expect(highlightAdds).toBe(addCount)
    expect(highlightDeletes).toBe(deleteCount)
  })

  it('treats empty token style fields as unchanged', () => {
    view.setText('world')
    view.setScrollMetrics(0, 20)
    view.setTokens([{ start: 0, end: 5, style: { color: '#ff0000', textDecoration: '' } }])

    const addCount = highlightAdds
    const deleteCount = highlightDeletes
    highlightClears = 0
    view.setTokens([{ start: 0, end: 5, style: { color: '#ff0000' } }])

    expect(highlightClears).toBe(0)
    expect(highlightAdds).toBe(addCount)
    expect(highlightDeletes).toBe(deleteCount)
  })

  it('keeps token highlight registry entries stable while scrolling recycled rows', () => {
    const lines = Array.from({ length: 20 }, (_, index) => `line-${index}`)
    const offsets = lineStartOffsets(lines)
    view.setText(lines.join('\n'))
    view.setScrollMetrics(0, 100)
    view.setTokens([
      { start: offsets[0]!, end: offsets[0]! + 4, style: { color: '#ff0000' } },
      { start: offsets[7]!, end: offsets[7]! + 4, style: { color: '#ff0000' } },
    ])

    const tokenHighlightName = tokenHighlightNames()[0]
    const tokenHighlight = highlightsMap.get(tokenHighlightName!)
    const recycledElement = container.querySelector(
      '[data-editor-virtual-row="0"]',
    ) as HTMLDivElement
    const styleText = document.head.querySelector('style')?.textContent
    const setCount = registrySets
    const deleteCount = registryDeletes

    view.setScrollMetrics(60, 100)

    const rowSeven = view.getState().mountedRows.find((row) => row.index === 7)
    const ranges = [...tokenHighlight!]
    expect(highlightsMap.get(tokenHighlightName!)).toBe(tokenHighlight)
    expect(document.head.querySelector('style')?.textContent).toBe(styleText)
    expect(registrySets).toBe(setCount)
    expect(registryDeletes).toBe(deleteCount)
    expect(rowSeven?.element).toBe(recycledElement)
    expect(ranges).toHaveLength(1)
    expect(ranges[0]!.startContainer).toBe(rowSeven?.textNode)
    expect(ranges[0]!.startOffset).toBe(0)
    expect(ranges[0]!.endOffset).toBe(4)
  })

  it('restores token and range highlight registry entries when the window regains focus', () => {
    view.setText('alpha\nbeta')
    view.setScrollMetrics(0, 40)
    view.setTokens([{ start: 0, end: 5, style: { color: '#ff0000' } }])
    view.setRangeHighlight('test-find', [{ start: 6, end: 10 }], {
      backgroundColor: 'rgba(234, 179, 8, 0.34)',
    })

    const tokenHighlightName = tokenHighlightNames()[0]!
    const tokenHighlight = highlightsMap.get(tokenHighlightName)!
    const rangeHighlight = highlightsMap.get('test-find')!
    const styleTexts = styleElementTexts()
    highlightsMap.delete(tokenHighlightName)
    highlightsMap.delete('test-find')
    document.head.querySelectorAll('style').forEach((element) => element.remove())

    window.dispatchEvent(new Event('focus'))

    expect(highlightsMap.get(tokenHighlightName)).toBe(tokenHighlight)
    expect(highlightsMap.get('test-find')).toBe(rangeHighlight)
    expect(styleElementTexts()).toEqual(styleTexts)
  })

  it('does not create token groups while scrolling to a newly visible style', () => {
    const lines = Array.from({ length: 20 }, (_, index) => `line-${index}`)
    const offsets = lineStartOffsets(lines)
    view.setText(lines.join('\n'))
    view.setScrollMetrics(0, 100)
    view.setTokens([
      { start: offsets[0]!, end: offsets[0]! + 4, style: { color: '#ff0000' } },
      { start: offsets[7]!, end: offsets[7]! + 4, style: { color: '#00ff00' } },
    ])

    const styleText = document.head.querySelector('style')?.textContent
    const setCount = registrySets
    view.setScrollMetrics(60, 100)

    const rowSeven = view.getState().mountedRows.find((row) => row.index === 7)
    const rowSevenRange = tokenHighlightRangeForNode(rowSeven!.textNode)
    expect(rowSevenRange).toBeDefined()
    expect(registrySets).toBe(setCount)
    expect(document.head.querySelector('style')?.textContent).toBe(styleText)
  })

  it('keeps custom selection ranges stable while scrolling offscreen and back', () => {
    view.setText(createLines(40))
    view.setScrollMetrics(0, 100)
    view.setSelection(0, 4)

    const setCount = registrySets
    const deleteCount = registryDeletes
    expect(selectionRanges(container)).toHaveLength(1)

    view.setScrollMetrics(400, 100)

    expect(selectionRanges(container)).toHaveLength(0)
    expect(registrySets).toBe(setCount)
    expect(registryDeletes).toBe(deleteCount)

    view.setScrollMetrics(0, 100)

    expect(selectionRanges(container)).toHaveLength(1)
    expect(registrySets).toBe(setCount)
    expect(registryDeletes).toBe(deleteCount)
  })

  it('fills selected spaces and tabs with custom selection geometry', () => {
    view.setText('a \t b')
    view.setScrollMetrics(0, 20)
    view.setSelection(1, 4)

    const ranges = selectionRanges(container)
    expect(ranges).toHaveLength(1)
    expect(ranges[0]?.dataset.editorSelectionRect).toBeDefined()
    expect(ranges[0]?.dataset.editorSelectionStart).toBeUndefined()
    expect(ranges[0]?.dataset.editorSelectionEnd).toBeUndefined()
    expect(highlightsMap.has('test-selection')).toBe(false)

    view.setSelection(0, 0)

    expect(selectionRanges(container)).toHaveLength(0)
  })

  it('paints selected empty rows as an invisible character', () => {
    view.setText('a\n\nb')
    view.setScrollMetrics(0, 80)
    view.setSelection(0, 3)

    const ranges = selectionRanges(container)
    const emptyRow = view.getState().mountedRows.find((row) => row.index === 1)!
    const emptyRowRange = emptyRow.element.querySelector<HTMLElement>(
      '.editor-virtualized-selection-range',
    )
    const characterWidth = view.getState().metrics.characterWidth

    expect(ranges).toHaveLength(2)
    expect(emptyRowRange).toBeDefined()
    expect(Number.parseFloat(emptyRowRange!.style.left)).toBe(0)
    expect(Number.parseFloat(emptyRowRange!.style.width)).toBeCloseTo(characterWidth)
  })

  it('paints a selected trailing empty row', () => {
    view.setText('a\n')
    view.setScrollMetrics(0, 60)
    view.setSelection(0, 2)

    const ranges = selectionRanges(container)
    const trailingRow = view.getState().mountedRows.find((row) => row.index === 1)!
    const trailingRowRange = trailingRow.element.querySelector<HTMLElement>(
      '.editor-virtualized-selection-range',
    )

    expect(ranges).toHaveLength(2)
    expect(trailingRowRange).toBeDefined()
  })

  it('renders control characters as visible cells with selection geometry', () => {
    view.setText('\u0000PNG\u0000\uFFFD')
    view.setScrollMetrics(0, 20)
    view.focusInput()
    view.setSelection(0, 6)

    const range = selectionRanges(container)[0]!
    const characterWidth = view.getState().metrics.characterWidth

    expect(view.scrollElement.textContent).toContain('\u2400PNG\u2400\uFFFD')
    expect(range.dataset.editorSelectionRect).toBeDefined()
    expect(Number.parseFloat(range.style.width)).toBeGreaterThan(0)

    view.setSelection(1, 1)

    const caret = container.querySelector('.editor-virtualized-caret') as HTMLElement
    expect(caret.style.transform).toBe(`translate(${characterWidth}px, 0px)`)
  })

  it('does not measure complex rows during scroll rendering', () => {
    view.setText('\u0000PNG\u0000\uFFFD\n\u4E2D\uD83D\uDE00')
    view.setScrollMetrics(0, 20, 80)

    withThrowingRenderLayoutReads(view.scrollElement, () => {
      view.setScrollMetrics(0, 20, 80)
      view.setScrollMetrics(20, 20, 80)
    })

    expect(container.querySelectorAll('[data-editor-control-character]')).toHaveLength(0)
  })

  it('uses placeholder spans only for multi-cell C1 controls', () => {
    view.setText('\u0000\u007F\u0081')
    view.setScrollMetrics(0, 20)

    const controls = container.querySelectorAll<HTMLElement>('[data-editor-control-character]')

    expect(view.scrollElement.textContent).toContain('\u2400\u2421[U+0081]')
    expect(controls).toHaveLength(1)
    expect(controls[0]?.dataset.editorControlCharacter).toBe('U+0081')
  })

  it('clears rendered complex row parts when reused for simple text', () => {
    view.setText('\u0000PNG\u0081tail')
    view.setScrollMetrics(0, 20)

    expect(container.querySelectorAll('[data-editor-control-character]')).toHaveLength(1)

    view.setText('{"name":"platform","private":true}')
    view.setScrollMetrics(0, 20)

    const row = container.querySelector('[data-editor-virtual-row="0"]') as HTMLDivElement
    expect(row.childNodes).toHaveLength(1)
    expect(row.textContent).toBe('{"name":"platform","private":true}')
    expect(container.querySelectorAll('[data-editor-control-character]')).toHaveLength(0)
    expect(view.scrollElement.textContent).not.toContain('[U+0081]')
  })

  it('reuses rendered direct row DOM during full repaint when text is unchanged', () => {
    view.setText('\u0000PNG\u0081tail')
    view.setScrollMetrics(0, 20)

    const rowBefore = view.getState().mountedRows[0]!
    const childNodesBefore = [...rowBefore.element.childNodes]
    const textNodeBefore = rowBefore.chunks[0]!.textNode
    const replaceChildren = vi.spyOn(rowBefore.element, 'replaceChildren')

    view.setText('\u0000PNG\u0081tail')

    const rowAfter = view.getState().mountedRows[0]!
    expect(replaceChildren).not.toHaveBeenCalled()
    expect([...rowAfter.element.childNodes]).toEqual(childNodesBefore)
    expect(rowAfter.chunks[0]!.textNode).toBe(textNodeBefore)
  })

  it('hit-tests complex rows without native caret APIs', () => {
    view.setText('\u0000PNG')
    view.setScrollMetrics(0, 20)
    mockViewport(view.scrollElement, 160, 20)

    withThrowingNativeCaretApis(document, () => {
      expect(view.textOffsetFromPoint(12, 10)).toBe(1)
    })
  })

  it('keeps emoji, combining marks, and CJK hit-testing on rendered boundaries', () => {
    view.setText('a\uD83D\uDE00e\u0301\u4E2D')
    view.setScrollMetrics(0, 20)
    mockViewport(view.scrollElement, 200, 20)

    const characterWidth = view.getState().metrics.characterWidth
    const emojiOffset = view.textOffsetFromPoint(characterWidth * 2, 10)
    const combiningOffset = view.textOffsetFromPoint(characterWidth * 3.5, 10)

    expect(emojiOffset).not.toBe(2)
    expect(combiningOffset).not.toBe(4)
    expect(view.getState().contentWidth).toBeGreaterThanOrEqual(characterWidth * 6)
  })

  it('uses FoldMap to mount folded virtual rows without changing buffer offsets', () => {
    view.dispose()
    view = new VirtualizedTextView(container, {
      rowHeight: 20,
      overscan: 2,
      highlightRegistry: mockRegistry,
      selectionHighlightName: 'test-selection',
      gutterContributions: [createLineGutterContribution()],
    })
    const text = 'a\nb\nc\nd'
    const snapshot = createPieceTableSnapshot(text)
    const map = createFoldMap(snapshot, [
      { startIndex: 2, endIndex: 4, startLine: 1, endLine: 2, type: 'block' },
    ])

    view.setText(text)
    view.setFoldMap(map)
    view.setScrollMetrics(0, 80)

    const rows = view.getState().mountedRows
    expect(view.getState().foldMapActive).toBe(true)
    expect(view.getState().totalHeight).toBe(60)
    expect(rows.map((row) => row.index)).toEqual([0, 1, 2])
    expect(rows.map((row) => row.bufferRow)).toEqual([0, 1, 3])
    expect(rows.map((row) => row.text)).toEqual(['a', 'b', 'd'])
    expect(
      [...container.querySelectorAll<HTMLSpanElement>('.editor-virtualized-line-number')].map(
        (label) => label.style.counterSet,
      ),
    ).toEqual(['editor-line 1', 'editor-line 2', 'editor-line 4'])

    const hiddenOffsetRange = view.createRange(4, 4)
    expect(hiddenOffsetRange?.startContainer).toBe(rows[1]!.textNode)
    expect(hiddenOffsetRange?.startOffset).toBe(1)
  })

  it('renders fold controls from a large indexed marker set', () => {
    const lines = Array.from({ length: 2_000 }, (_, index) => `line ${index}`)
    view.setText(lines.join('\n'))
    view.setFoldMarkers(createEveryOtherFoldMarkers(lines, 1_000))
    view.setScrollMetrics(400 * 20, 100)

    expect(container.querySelector('.editor-virtualized-fold-toggle')).toBeNull()

    view.dispose()
    view = new VirtualizedTextView(container, {
      rowHeight: 20,
      overscan: 2,
      highlightRegistry: mockRegistry,
      selectionHighlightName: 'test-selection',
      gutterContributions: [createFoldGutterContribution()],
    })
    view.setText(lines.join('\n'))
    view.setFoldMarkers(createEveryOtherFoldMarkers(lines, 1_000))
    view.setScrollMetrics(400 * 20, 100)

    const gutterRow = container.querySelector<HTMLDivElement>(
      '[data-editor-virtual-gutter-row="400"]',
    )
    const button = gutterRow?.querySelector<HTMLButtonElement>('.editor-virtualized-fold-toggle')

    expect(button).toBeDefined()
    expect(button?.hidden).toBe(false)
    expect(button?.dataset.editorFoldKey).toBe('fold-400')
  })

  it('renders legacy fold indicators inside the fold icon element', () => {
    view.dispose()
    view = createFoldGutterTestView(
      container,
      createFoldGutterContribution({ expandedIndicator: 'open', collapsedIndicator: 'closed' }),
    )

    mountFoldMarker(view, createSingleFoldMarker({ collapsed: false }))

    expect(visibleFoldButton(container).dataset.editorFoldIndicator).toBe('open')
    expect(foldIconElement(container).textContent).toBe('open')

    view.setFoldMarkers([createSingleFoldMarker({ collapsed: true })])

    expect(visibleFoldButton(container).dataset.editorFoldIndicator).toBe('closed')
    expect(foldIconElement(container).textContent).toBe('closed')
  })

  it('keeps shared fold icons mounted across state changes for CSS rotation', () => {
    const iconFactory = vi.fn(({ document }: { readonly document: Document }) => {
      const icon = document.createElement('span')
      icon.dataset.testFoldIcon = 'shared'
      icon.textContent = '>'
      return icon
    })

    view.dispose()
    view = createFoldGutterTestView(container, createFoldGutterContribution({ icon: iconFactory }))
    mountFoldMarker(view, createSingleFoldMarker({ collapsed: false }))

    const firstIcon = foldIconElement(container)
    const firstCustomIcon = firstIcon.querySelector("[data-test-fold-icon='shared']")
    view.setFoldMarkers([createSingleFoldMarker({ collapsed: true })])

    const button = visibleFoldButton(container)
    expect(iconFactory).toHaveBeenCalledTimes(1)
    expect(foldIconElement(container)).toBe(firstIcon)
    expect(firstIcon.querySelector("[data-test-fold-icon='shared']")).toBe(firstCustomIcon)
    expect(button.dataset.editorFoldState).toBe('collapsed')
    expect(button.dataset.editorFoldTransition).toBe('collapse')
  })

  it('lets state-specific fold icons override a shared icon', () => {
    view.dispose()
    view = createFoldGutterTestView(
      container,
      createFoldGutterContribution({
        icon: 'shared',
        expandedIcon: 'expanded',
        collapsedIcon: 'collapsed',
      }),
    )

    mountFoldMarker(view, createSingleFoldMarker({ collapsed: false }))

    expect(foldIconElement(container).textContent).toBe('expanded')

    view.setFoldMarkers([createSingleFoldMarker({ collapsed: true })])

    expect(foldIconElement(container).textContent).toBe('collapsed')
  })

  it('renders DOM factory fold icons without parsing string icons as HTML', () => {
    view.dispose()
    view = createFoldGutterTestView(
      container,
      createFoldGutterContribution({
        icon: ({ document }) => document.createElementNS('http://www.w3.org/2000/svg', 'svg'),
      }),
    )
    mountFoldMarker(view)

    expect(foldIconElement(container).querySelector('svg')).not.toBeNull()

    view.dispose()
    view = createFoldGutterTestView(
      container,
      createFoldGutterContribution({ icon: '<svg><path /></svg>' }),
    )
    mountFoldMarker(view)

    expect(foldIconElement(container).textContent).toBe('<svg><path /></svg>')
    expect(foldIconElement(container).querySelector('svg')).toBeNull()
  })

  it('applies user fold icon class names', () => {
    view.dispose()
    view = createFoldGutterTestView(
      container,
      createFoldGutterContribution({
        icon: '>',
        buttonClassName: 'custom-fold-button custom-fold-trigger',
        iconClassName: 'custom-fold-icon',
      }),
    )
    mountFoldMarker(view)

    const button = visibleFoldButton(container)
    expect(button.classList.contains('custom-fold-button')).toBe(true)
    expect(button.classList.contains('custom-fold-trigger')).toBe(true)
    expect(foldIconElement(container).classList.contains('custom-fold-icon')).toBe(true)
  })

  it('sets fold transition hooks only for same-marker state changes', () => {
    view.dispose()
    view = createFoldGutterTestView(container, createFoldGutterContribution({ icon: '>' }))
    mountFoldMarker(view, createSingleFoldMarker({ key: 'fold-a', collapsed: false }))

    expect(visibleFoldButton(container).dataset.editorFoldTransition).toBeUndefined()

    view.setFoldMarkers([createSingleFoldMarker({ key: 'fold-b', collapsed: false })])

    expect(visibleFoldButton(container).dataset.editorFoldTransition).toBeUndefined()

    view.setFoldMarkers([createSingleFoldMarker({ key: 'fold-b', collapsed: true })])

    const button = visibleFoldButton(container)
    expect(button.dataset.editorFoldTransition).toBe('collapse')

    button.dispatchEvent(new Event('animationend', { bubbles: true }))
    expect(button.dataset.editorFoldTransition).toBeUndefined()

    view.setFoldMarkers([createSingleFoldMarker({ key: 'fold-b', collapsed: false })])

    expect(button.dataset.editorFoldTransition).toBe('expand')

    button.dispatchEvent(new Event('animationcancel', { bubbles: true }))
    expect(button.dataset.editorFoldTransition).toBeUndefined()
  })

  it('validates native geometry ranges over mounted rows', () => {
    view.setText('abc\ndef')
    view.setScrollMetrics(0, 40)

    expect(view.validateMountedNativeGeometry()).toMatchObject({
      caretChecks: 2,
      selectionChecks: 2,
      failures: [],
      ok: true,
    })
  })

  it('measures browser row and character metrics from a DOM probe', () => {
    clearBrowserTextMetricsCache()
    const original = HTMLElement.prototype.getBoundingClientRect
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
      if (this.classList.contains('editor-virtualized-metric-probe')) {
        return mockRect(0, 0, 160, 24)
      }

      return original.call(this)
    }

    const metrics = measureBrowserTextMetrics(container)
    HTMLElement.prototype.getBoundingClientRect = original
    clearBrowserTextMetricsCache()

    expect(metrics.rowHeight).toBe(24)
    expect(metrics.characterWidth).toBe(10)
  })

  it('keeps one measurement waiting however many times the rows are rendered', () => {
    const idle = captureIdleCallbacks()
    try {
      view.setText('漢字テスト\nabc')
      view.setScrollMetrics(0, 40)

      expect(idle.pending.size).toBe(1)

      view.setRowDecorations(new Map())
      view.setRowDecorations(new Map())

      expect(idle.pending.size).toBe(1)
    } finally {
      idle.restore()
    }
  })

  it('leaves nothing waiting to run against a disposed view', () => {
    const idle = captureIdleCallbacks()
    try {
      view.setText('漢字テスト\nabc')
      view.setScrollMetrics(0, 40)

      expect(idle.pending.size).toBe(1)

      view.dispose()

      expect(idle.pending.size).toBe(0)

      view = new VirtualizedTextView(container, { rowHeight: 20, overscan: 2 })
    } finally {
      idle.restore()
    }
  })

  it('cancels row measurements when hidden and resumes them on reveal', () => {
    const idle = captureIdleCallbacks()
    try {
      view.setText('漢字テスト\nabc')
      view.setScrollMetrics(0, 40, 240)
      expect(idle.pending.size).toBe(1)

      view.setScrollMetrics(0, 0)
      expect(idle.pending.size).toBe(0)

      view.setScrollMetrics(0, 40, 240)
      expect(idle.pending.size).toBe(1)
    } finally {
      idle.restore()
    }
  })

  it('reads nothing back out of the virtualizer when a measurement pass finds no wider row', () => {
    const idle = captureIdleCallbacks()
    try {
      view.setText('漢字テスト\nabc')
      view.setScrollMetrics(0, 40)

      const measure = [...idle.pending.values()][0]!
      // Whatever the rows had to give, the first pass already took.
      measure()

      const internal = Reflect.get(view, 'view') as {
        virtualizer: { getSnapshot: () => unknown }
      }
      const snapshots = vi.spyOn(internal.virtualizer, 'getSnapshot')
      measure()

      expect(snapshots).not.toHaveBeenCalled()
    } finally {
      idle.restore()
    }
  })
})

function createLines(count: number): string {
  return Array.from({ length: count }, (_, index) => `line ${index}`).join('\n')
}

type IdleWindow = {
  requestIdleCallback?: unknown
  cancelIdleCallback?: unknown
}

/** The idle queue, held open so what is waiting in it can be counted and run on demand. */
function captureIdleCallbacks(): {
  readonly pending: ReadonlyMap<number, () => void>
  readonly restore: () => void
} {
  const pending = new Map<number, () => void>()
  const win = window as unknown as IdleWindow
  const request = win.requestIdleCallback
  const cancel = win.cancelIdleCallback
  let nextHandle = 1

  win.requestIdleCallback = (callback: () => void) => {
    const handle = nextHandle
    nextHandle += 1
    pending.set(handle, callback)
    return handle
  }
  win.cancelIdleCallback = (handle: number) => {
    pending.delete(handle)
  }

  return {
    pending,
    restore: () => {
      win.requestIdleCallback = request
      // A view disposed after the queue is handed back still reaches for the canceller it was
      // scheduled with, so that half stays until the environment has one of its own.
      if (typeof cancel === 'function') win.cancelIdleCallback = cancel
    },
  }
}

function createFoldGutterTestView(
  container: HTMLElement,
  contribution: ReturnType<typeof createFoldGutterContribution>,
): VirtualizedTextView {
  return new VirtualizedTextView(container, {
    rowHeight: 20,
    overscan: 2,
    highlightRegistry: mockRegistry,
    selectionHighlightName: 'test-selection',
    gutterContributions: [contribution],
  })
}

function mountFoldMarker(
  view: VirtualizedTextView,
  marker: VirtualizedFoldMarker = createSingleFoldMarker(),
): void {
  view.setText('line 0\nline 1\nline 2')
  view.setFoldMarkers([marker])
  view.setScrollMetrics(0, 80)
}

function createSingleFoldMarker(
  options: { readonly key?: string; readonly collapsed?: boolean } = {},
): VirtualizedFoldMarker {
  return {
    key: options.key ?? 'fold-0',
    startOffset: 0,
    endOffset: 13,
    startRow: 0,
    endRow: 1,
    collapsed: options.collapsed ?? false,
  }
}

function visibleFoldButton(container: HTMLElement): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(
    '.editor-virtualized-fold-toggle:not([hidden])',
  )
  expect(button).not.toBeNull()
  return button!
}

function foldIconElement(container: HTMLElement): HTMLSpanElement {
  const icon = visibleFoldButton(container).querySelector<HTMLSpanElement>(
    '.editor-virtualized-fold-icon',
  )
  expect(icon).not.toBeNull()
  return icon!
}

function lineStartOffsets(lines: readonly string[]): number[] {
  const offsets: number[] = []
  let offset = 0
  for (const line of lines) {
    offsets.push(offset)
    offset += line.length + 1
  }

  return offsets
}

function createEveryOtherFoldMarkers(
  lines: readonly string[],
  count: number,
): VirtualizedFoldMarker[] {
  const offsets = lineStartOffsets(lines)
  const markers: VirtualizedFoldMarker[] = []
  for (let index = 0; index < count; index += 1) {
    const startRow = index * 2
    const endRow = startRow + 1
    markers.push({
      key: `fold-${startRow}`,
      startOffset: offsets[startRow]!,
      endOffset: offsets[endRow]!,
      startRow,
      endRow,
      collapsed: false,
    })
  }

  return markers
}

function tokenHighlightNames(): string[] {
  return [...highlightsMap.keys()].filter((name) => name.includes('-token-'))
}

function styleElementTexts(): string[] {
  return [...document.head.querySelectorAll('style')].map((element) => element.textContent ?? '')
}

function tokenHighlightRanges(): AbstractRange[] {
  return tokenHighlightNames().flatMap((name) => [...highlightsMap.get(name)!])
}

function tokenHighlightRangeForNode(
  node: Text,
): { readonly highlight: Highlight; readonly range: AbstractRange } | undefined {
  for (const name of tokenHighlightNames()) {
    const highlight = highlightsMap.get(name)!
    const range = [...highlight].find((candidate) => candidate.startContainer === node)
    if (range) return { highlight, range }
  }

  return undefined
}

function tokenHighlightColorForNode(node: Text): string | undefined {
  for (const name of tokenHighlightNames()) {
    const highlight = highlightsMap.get(name)!
    const range = [...highlight].find((candidate) => candidate.startContainer === node)
    if (!range) continue

    return tokenHighlightColor(name)
  }

  return undefined
}

function tokenHighlightColor(name: string): string | undefined {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = document.head.textContent.match(
    new RegExp(`::highlight\\(${escapedName}\\) \\{[^}]*color: ([^;]+);`),
  )
  return match?.[1]
}

function countStyleTextContentWrites(callback: () => void): number {
  const target = textContentDescriptorTarget()
  const descriptor = target ? Object.getOwnPropertyDescriptor(target, 'textContent') : undefined
  if (!descriptor?.set || !descriptor.get) {
    callback()
    return 0
  }

  let writes = 0
  Object.defineProperty(target, 'textContent', {
    configurable: true,
    get: descriptor.get,
    set(value) {
      if (this instanceof HTMLStyleElement) writes += 1
      descriptor.set!.call(this, value)
    },
  })

  try {
    callback()
    return writes
  } finally {
    Object.defineProperty(target, 'textContent', descriptor)
  }
}

function textContentDescriptorTarget(): object | null {
  let target: object | null = HTMLStyleElement.prototype
  while (target) {
    if (Object.getOwnPropertyDescriptor(target, 'textContent')) return target

    target = Object.getPrototypeOf(target)
  }

  return null
}

function hiddenCharacterMarkers(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('.editor-virtualized-hidden-character-marker')]
}

function selectionRanges(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('.editor-virtualized-selection-range')]
}

// The whitespace glyphs live in the marker overlay, so the rendered document text is what is left
// once the overlay is taken away.
function textWithoutHiddenCharacterOverlay(root: HTMLElement): string {
  const copy = root.cloneNode(true) as HTMLElement
  for (const layer of copy.querySelectorAll('.editor-virtualized-hidden-character-layer')) {
    layer.remove()
  }

  return copy.textContent ?? ''
}

function hiddenCharacterMarkerKinds(container: HTMLElement): string[] {
  return hiddenCharacterMarkers(container).map((marker) => marker.dataset.editorHiddenCharacter!)
}

function hiddenCharacterMarkerOffsets(container: HTMLElement): string[] {
  return hiddenCharacterMarkers(container).map(
    (marker) => marker.dataset.editorHiddenCharacterOffset!,
  )
}

// Provenance travels by revision, so adopting a projection never compares two stores.
function watchTokenComparisons(...stores: readonly EditorTokenStore[]): () => number {
  const spies = stores.flatMap((store) => [
    vi.spyOn(store, 'equals'),
    vi.spyOn(store, 'stylesEqual'),
    vi.spyOn(store, 'changedRangeTo'),
  ])
  return () => spies.reduce((sum, spy) => sum + spy.mock.calls.length, 0)
}

function isTokenStyleSerializationInput(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false

  const keys = new Set(Object.keys(value))
  if (!keys.has('color')) return false
  if (!keys.has('backgroundColor')) return false
  if (!keys.has('fontStyle')) return false
  if (!keys.has('fontWeight')) return false
  return keys.has('textDecoration')
}

function mockViewport(element: HTMLElement, width: number, height: number): void {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      bottom: height,
      height,
      left: 0,
      right: width,
      top: 0,
      width,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  })
}

function withThrowingScrollLeft(element: HTMLElement, callback: () => void): void {
  const descriptor = Object.getOwnPropertyDescriptor(element, 'scrollLeft')
  Object.defineProperty(element, 'scrollLeft', {
    configurable: true,
    get: () => {
      throw new Error('unexpected horizontal scroll read')
    },
  })

  try {
    callback()
  } finally {
    restoreScrollLeft(element, descriptor)
  }
}

function withThrowingRenderLayoutReads(element: HTMLElement, callback: () => void): void {
  const clientWidth = Object.getOwnPropertyDescriptor(element, 'clientWidth')
  const clientHeight = Object.getOwnPropertyDescriptor(element, 'clientHeight')
  const getBoundingClientRect = HTMLElement.prototype.getBoundingClientRect
  Object.defineProperty(element, 'clientWidth', {
    configurable: true,
    get: () => {
      throw new Error('unexpected clientWidth read')
    },
  })
  Object.defineProperty(element, 'clientHeight', {
    configurable: true,
    get: () => {
      throw new Error('unexpected clientHeight read')
    },
  })
  HTMLElement.prototype.getBoundingClientRect = function throwingGetBoundingClientRect() {
    throw new Error('unexpected layout read')
  }

  try {
    callback()
  } finally {
    restorePropertyDescriptor(element, 'clientWidth', clientWidth)
    restorePropertyDescriptor(element, 'clientHeight', clientHeight)
    HTMLElement.prototype.getBoundingClientRect = getBoundingClientRect
  }
}

function withThrowingNativeCaretApis(document: Document, callback: () => void): void {
  const caretPosition = Object.getOwnPropertyDescriptor(document, 'caretPositionFromPoint')
  const caretRange = Object.getOwnPropertyDescriptor(document, 'caretRangeFromPoint')
  Object.defineProperty(document, 'caretPositionFromPoint', {
    configurable: true,
    value: () => {
      throw new Error('unexpected native caretPositionFromPoint')
    },
  })
  Object.defineProperty(document, 'caretRangeFromPoint', {
    configurable: true,
    value: () => {
      throw new Error('unexpected native caretRangeFromPoint')
    },
  })

  try {
    callback()
  } finally {
    restoreDocumentProperty(document, 'caretPositionFromPoint', caretPosition)
    restoreDocumentProperty(document, 'caretRangeFromPoint', caretRange)
  }
}

function restoreDocumentProperty(
  document: Document,
  property: 'caretPositionFromPoint' | 'caretRangeFromPoint',
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(document, property, descriptor)
    return
  }

  Reflect.deleteProperty(document, property)
}

function restoreScrollLeft(element: HTMLElement, descriptor: PropertyDescriptor | undefined): void {
  restorePropertyDescriptor(element, 'scrollLeft', descriptor)
}

function restorePropertyDescriptor(
  element: HTMLElement,
  property: 'clientHeight' | 'clientWidth' | 'scrollLeft',
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(element, property, descriptor)
    return
  }

  Reflect.deleteProperty(element, property)
}

function mockRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    top,
    width,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect
}

function restoreRangeGetClientRects(original: Range['getClientRects']): void {
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: original,
  })
}

describe('VirtualizedTextView inline map', () => {
  let container: HTMLElement
  let view: VirtualizedTextView

  const MARKDOWN = '# Title\na **bold** b\nplain'

  const markdownInlineMap = (text = MARKDOWN) =>
    createInlineMap(createPieceTableSnapshot(text), [
      { id: 'heading', startIndex: 0, endIndex: 2, text: '', groupId: 'h1' },
      { id: 'open', startIndex: 10, endIndex: 12, text: '', groupId: 'bold' },
      { id: 'close', startIndex: 16, endIndex: 18, text: '', groupId: 'bold' },
    ])

  beforeEach(() => {
    highlightsMap.clear()
    // @ts-expect-error happy-dom does not provide Highlight.
    globalThis.Highlight = MockHighlight
    container = document.createElement('div')
    document.body.appendChild(container)
    view = new VirtualizedTextView(container, {
      rowHeight: 20,
      overscan: 2,
      highlightRegistry: mockRegistry,
      selectionHighlightName: 'test-selection',
    })
  })

  afterEach(() => {
    view.dispose()
    container.remove()
    Reflect.deleteProperty(globalThis, 'Highlight')
  })

  it('renders display text with markdown markers hidden', () => {
    view.setText(MARKDOWN)
    view.setInlineMap(markdownInlineMap())
    view.setScrollMetrics(0, 100)

    expect(view.getState().mountedRows.map((row) => row.text)).toEqual([
      'Title',
      'a bold b',
      'plain',
    ])
  })

  it('keeps row offsets in buffer space while text is in display space', () => {
    view.setText(MARKDOWN)
    view.setInlineMap(markdownInlineMap())
    view.setScrollMetrics(0, 100)

    expect(view.getState().mountedRows.map((row) => [row.startOffset, row.endOffset])).toEqual([
      [0, 7],
      [8, 20],
      [21, 26],
    ])
  })

  it('restores source text under the caret and hides it again when the caret leaves', () => {
    view.setText(MARKDOWN)
    view.setInlineMap(markdownInlineMap())
    view.setScrollMetrics(0, 100)

    view.setSelection(14, 14)
    expect(view.getState().mountedRows[1]?.text).toBe('a **bold** b')

    view.setSelection(21, 21)
    expect(view.getState().mountedRows[1]?.text).toBe('a bold b')
  })

  it('reveals only the construct the caret is in', () => {
    view.setText(MARKDOWN)
    view.setInlineMap(markdownInlineMap())
    view.setScrollMetrics(0, 100)

    view.setSelection(14, 14)
    expect(view.getState().mountedRows.map((row) => row.text)).toEqual([
      'Title',
      'a **bold** b',
      'plain',
    ])
  })

  it('drops back to buffer text when the inline map is removed', () => {
    view.setText(MARKDOWN)
    view.setInlineMap(markdownInlineMap())
    view.setScrollMetrics(0, 100)
    view.setInlineMap(null)

    expect(view.getState().mountedRows.map((row) => row.text)).toEqual([
      '# Title',
      'a **bold** b',
      'plain',
    ])
  })

  it('maps caret columns through hidden markers', () => {
    view.setText(MARKDOWN)
    view.setInlineMap(markdownInlineMap())
    view.setScrollMetrics(0, 100)

    // 'a **bold** b' renders as 'a bold b'; the line starts at offset 8.
    expect(view.visualColumnForOffset(8)).toBe(0)
    expect(view.visualColumnForOffset(12)).toBe(2)
    expect(view.visualColumnForOffset(16)).toBe(6)
    expect(view.visualColumnForOffset(20)).toBe(8)
  })

  it('collapses both edges of a hidden marker onto one caret column', () => {
    view.setText(MARKDOWN)
    view.setInlineMap(markdownInlineMap())
    view.setScrollMetrics(0, 100)

    expect(view.visualColumnForOffset(10)).toBe(view.visualColumnForOffset(12))
    expect(view.visualColumnForOffset(16)).toBe(view.visualColumnForOffset(18))
  })

  it('resolves an ambiguous caret column to the offset before the hidden run', () => {
    view.setText(MARKDOWN)
    view.setInlineMap(markdownInlineMap())
    view.setScrollMetrics(0, 100)

    expect(view.offsetByDisplayRows(12, 0, 2)).toBe(10)
    expect(view.offsetByDisplayRows(12, 0, 6)).toBe(16)
    expect(view.offsetByDisplayRows(12, 0, 0)).toBe(8)
  })

  it('keeps line boundaries in buffer space', () => {
    view.setText(MARKDOWN)
    view.setInlineMap(markdownInlineMap())
    view.setScrollMetrics(0, 100)

    expect(view.offsetAtLineBoundary(12, 'start')).toBe(8)
    expect(view.offsetAtLineBoundary(12, 'end')).toBe(20)
  })

  it('paints a tab as a tab on a row an inline replacement made complex', () => {
    const indented = '\t\tconst answer = 42'
    view.setText(indented)
    view.setScrollMetrics(0, 100)
    const plain = view.getState().mountedRows[0]!.element.textContent

    view.setInlineMap(
      createInlineMap(createPieceTableSnapshot(indented), [
        {
          id: 'ghost',
          startIndex: indented.length,
          endIndex: indented.length,
          text: ' // 42',
          insertion: true,
          className: 'editor-ghost-text',
        },
      ]),
    )

    const rendered = view.getState().mountedRows[0]!.element.textContent

    expect(plain).toContain('\t\t')
    // The indent is laid out by `tab-size`, so a `␉` in its place would pull the line left by a
    // whole tab stop per level the instant the ghost text appeared.
    expect(rendered).not.toContain('\u2409')
    expect(rendered).toContain('\t\tconst answer = 42')
  })

  it('ignores an inline map built against different text', () => {
    view.setText(MARKDOWN)
    view.setInlineMap(markdownInlineMap('totally different text'))
    view.setScrollMetrics(0, 100)

    expect(view.getState().mountedRows[0]?.text).toBe('# Title')
  })
})
