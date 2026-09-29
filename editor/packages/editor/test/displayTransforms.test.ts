import { describe, expect, it } from 'vitest'

import {
  bufferColumnToVisualColumn,
  bufferPointToTabPoint,
  createInlineRow,
  createWrapMap,
  type InjectedTextRow,
  type InlineCursorStops,
  type InlineReplacement,
  inlineColumnToSourceColumn,
  sourceColumnToInlineColumn,
  sourceRangeToInlineRanges,
  tabPointToBufferPoint,
  tabPointToWrapPoint,
  visualColumnToBufferColumn,
  wrapPointToTabPoint,
} from '../src/displayTransforms'
import { createDisplayRows, isDocumentTextDisplayRow } from './oracles/displayTransforms'
import { computeLineStarts } from '../src/virtualization/virtualizedTextViewHelpers'

describe('display transform core', () => {
  it('round-trips tab-expanded columns', () => {
    const text = '\tab\tc'

    expect(bufferColumnToVisualColumn(text, 0)).toBe(0)
    expect(bufferColumnToVisualColumn(text, 1)).toBe(4)
    expect(bufferColumnToVisualColumn(text, 3)).toBe(6)
    expect(visualColumnToBufferColumn(text, 5)).toBe(2)

    const tabPoint = bufferPointToTabPoint(text, { row: 2, column: 3 })
    expect(tabPoint).toEqual({ row: 2, column: 6 })
    expect(tabPointToBufferPoint(text, tabPoint)).toEqual({ row: 2, column: 3 })
  })

  it('uses custom tab sizes in visual column conversion and wrapping', () => {
    const text = '\tab\tc'

    expect(bufferColumnToVisualColumn(text, 1, 2)).toBe(2)
    expect(bufferColumnToVisualColumn(text, 3, 2)).toBe(4)
    expect(visualColumnToBufferColumn(text, 3, 'nearest', 2)).toBe(2)

    const rows = createDisplayRows({
      text: '\tabcd',
      lineStarts: [0],
      visibleLineCount: 1,
      bufferRowForVisibleRow: (row) => row,
      wrapColumn: 3,
      tabSize: 2,
    })

    expect(rows.filter((row) => row.kind === 'text').map((row) => row.text)).toEqual(['\ta', 'bcd'])
  })

  it('maps wrapped rows between tab and wrap coordinates', () => {
    const map = createWrapMap([{ row: 0, text: 'abcdefghij' }], 4)

    expect(map.segments).toMatchObject([
      { inputRow: 0, outputRow: 0, startColumn: 0, endColumn: 4 },
      { inputRow: 0, outputRow: 1, startColumn: 4, endColumn: 8 },
      { inputRow: 0, outputRow: 2, startColumn: 8, endColumn: 10 },
    ])
    expect(tabPointToWrapPoint(map, { row: 0, column: 6 } as never)).toEqual({
      row: 1,
      column: 2,
    })
    expect(wrapPointToTabPoint(map, { row: 1, column: 2 } as never)).toEqual({
      row: 0,
      column: 6,
    })
  })

  it('creates display rows for wrapped text', () => {
    const text = 'abcdefghij\nxy'
    const rows = createDisplayRows({
      text,
      lineStarts: computeLineStarts(text),
      visibleLineCount: 2,
      bufferRowForVisibleRow: (row) => row,
      wrapColumn: 4,
    })

    expect(rows.map((row) => row.text)).toEqual(['abcd', 'efgh', 'ij', 'xy'])
  })

  it('interleaves injected text rows before and after anchored document rows', () => {
    const text = 'alpha\nbeta'
    const injectedTextRows: InjectedTextRow[] = [
      { id: 'before-z', anchorBufferRow: 1, placement: 'before', order: 2, text: 'before z' },
      { id: 'after-a', anchorBufferRow: 0, placement: 'after', text: 'after a' },
      { id: 'before-a', anchorBufferRow: 1, placement: 'before', order: 1, text: 'before a' },
      { id: 'before-b', anchorBufferRow: 1, placement: 'before', order: 1, text: 'before b' },
    ]

    const rows = createDisplayRows({
      text,
      lineStarts: computeLineStarts(text),
      visibleLineCount: 2,
      bufferRowForVisibleRow: (row) => row,
      injectedTextRows,
    })

    expect(
      rows.map((row) => ({
        id: row.kind === 'text' && row.source === 'injected' ? row.id : undefined,
        source: row.source,
        text: row.text,
      })),
    ).toEqual([
      { id: undefined, source: 'document', text: 'alpha' },
      { id: 'after-a', source: 'injected', text: 'after a' },
      { id: 'before-a', source: 'injected', text: 'before a' },
      { id: 'before-b', source: 'injected', text: 'before b' },
      { id: 'before-z', source: 'injected', text: 'before z' },
      { id: undefined, source: 'document', text: 'beta' },
    ])
    expect(rows.filter((row) => row.kind === 'text' && row.source === 'document')).toMatchObject([
      { bufferRow: 0, startOffset: 0, endOffset: 5 },
      { bufferRow: 1, startOffset: 6, endOffset: 10 },
    ])
  })
})

const hidden = (id: string, startColumn: number, endColumn: number): InlineReplacement => ({
  id,
  startColumn,
  endColumn,
  text: '',
  kind: 'marker',
})

describe('inline display transform', () => {
  it('is the identity when a line carries no replacements', () => {
    const row = createInlineRow('plain text')

    expect(row.text).toBe('plain text')
    expect(row.segments).toEqual([
      {
        kind: 'source',
        sourceStartColumn: 0,
        sourceEndColumn: 10,
        displayStartColumn: 0,
        displayEndColumn: 10,
      },
    ])
  })

  it('hides emphasis and heading markers', () => {
    expect(createInlineRow('a **bold** b', [hidden('o', 2, 4), hidden('c', 8, 10)]).text).toBe(
      'a bold b',
    )
    expect(createInlineRow('an _em_ word', [hidden('o', 3, 4), hidden('c', 6, 7)]).text).toBe(
      'an em word',
    )
    expect(createInlineRow('# Title', [hidden('h', 0, 2)]).text).toBe('Title')
  })

  it('collapses a link down to its label', () => {
    const row = createInlineRow('see [docs](https://x.dev) now', [
      hidden('open', 4, 5),
      hidden('target', 9, 25),
    ])

    expect(row.text).toBe('see docs now')
  })

  it('stands a widget in for its source span', () => {
    const row = createInlineRow('![alt](img.png)', [
      { id: 'image', startColumn: 0, endColumn: 15, text: '🖼', kind: 'widget' },
    ])

    expect(row.text).toBe('🖼')
    expect(row.segments).toHaveLength(1)
  })

  it('never resolves a display column into the middle of a widget', () => {
    const row = createInlineRow('x ![alt](img.png) y', [
      { id: 'image', startColumn: 2, endColumn: 17, text: '[image]', kind: 'widget' },
    ])

    for (let column = 2; column <= 9; column += 1) {
      expect([2, 17]).toContain(inlineColumnToSourceColumn(row, column))
    }
  })

  it('drops replacements that overlap an earlier one', () => {
    const row = createInlineRow('abcdef', [hidden('outer', 0, 4), hidden('inner', 2, 6)])

    expect(row.text).toBe('ef')
  })

  it('rejects replacement text that would add a row', () => {
    const row = createInlineRow('abc', [{ id: 'bad', startColumn: 0, endColumn: 1, text: 'x\ny' }])

    expect(row.text).toBe('abc')
  })

  it('splits a source range around the spans it hides', () => {
    const row = createInlineRow('a **bold** b', [hidden('o', 2, 4), hidden('c', 8, 10)])

    expect(sourceRangeToInlineRanges(row, 0, 12)).toEqual([{ startColumn: 0, endColumn: 8 }])
    expect(sourceRangeToInlineRanges(row, 4, 8)).toEqual([{ startColumn: 2, endColumn: 6 }])
    expect(sourceRangeToInlineRanges(row, 2, 4)).toEqual([])
  })

  it('paints a whole widget when a range overlaps any of it', () => {
    const row = createInlineRow('x ![alt](img.png) y', [
      { id: 'image', startColumn: 2, endColumn: 17, text: '[image]', kind: 'widget' },
    ])

    expect(sourceRangeToInlineRanges(row, 3, 5)).toEqual([{ startColumn: 2, endColumn: 9 }])
  })

  it('maps source columns forward across hidden spans', () => {
    const row = createInlineRow('# Title', [hidden('h', 0, 2)])

    expect(sourceColumnToInlineColumn(row, 0)).toBe(0)
    expect(sourceColumnToInlineColumn(row, 2)).toBe(0)
    expect(sourceColumnToInlineColumn(row, 7)).toBe(5)
  })
})

const injected = (
  id: string,
  column: number,
  text: string,
  cursorStops?: InlineCursorStops,
): InlineReplacement => ({
  id,
  startColumn: column,
  endColumn: column,
  text,
  insertion: true,
  ...(cursorStops === undefined ? {} : { cursorStops }),
})

describe('injected inline runs', () => {
  it('paints phantom text at a point without spending a source column', () => {
    const row = createInlineRow('foo(1)', [injected('hint', 4, 'arg:')])

    expect(row.text).toBe('foo(arg:1)')
    for (let column = 4; column <= 8; column += 1) {
      expect(inlineColumnToSourceColumn(row, column)).toBe(4)
    }
    expect(inlineColumnToSourceColumn(row, 9)).toBe(5)
  })

  it('drops a zero-width replacement that did not ask to be one', () => {
    const row = createInlineRow('foo(1)', [{ id: 'hint', startColumn: 4, endColumn: 4, text: 'x' }])

    expect(row.text).toBe('foo(1)')
  })

  it('carries a per-run class onto its own segment', () => {
    const row = createInlineRow('foo(1)', [
      { ...injected('hint', 4, 'arg:'), className: 'editor-inlay-hint' },
    ])

    expect(row.segments.map((segment) => segment.className)).toEqual([
      undefined,
      'editor-inlay-hint',
      undefined,
    ])
  })

  it('leaves the run outside a source range that meets it at its point', () => {
    const row = createInlineRow('foo(1)', [injected('hint', 4, 'arg:')])
    const painted = (start: number, end: number): readonly number[] => [
      sourceColumnToInlineColumn(row, start, 'before'),
      sourceColumnToInlineColumn(row, end, 'after'),
    ]

    expect(painted(0, 4)).toEqual([0, 4])
    expect(painted(4, 6)).toEqual([8, 10])
  })

  it('keeps a run offered at the opening edge of a hidden span', () => {
    const row = createInlineRow('**bold** tail', [
      hidden('open', 0, 2),
      hidden('close', 6, 8),
      injected('ghost', 6, 'SUGGEST'),
    ])

    expect(row.text).toBe('boldSUGGEST tail')
  })

  it('drops a run offered inside a hidden span', () => {
    const row = createInlineRow('**bold** tail', [hidden('open', 0, 2), injected('ghost', 1, 'X')])

    expect(row.text).toBe('bold** tail')
  })

  it('parks a standing caret on the side the run stops', () => {
    const stopsAt = (cursorStops: InlineCursorStops | undefined): number =>
      sourceColumnToInlineColumn(
        createInlineRow('foo(1)', [injected('h', 4, 'arg:', cursorStops)]),
        4,
      )

    expect(stopsAt(undefined)).toBe(4)
    expect(stopsAt('both')).toBe(4)
    expect(stopsAt('left')).toBe(4)
    expect(stopsAt('right')).toBe(8)
    expect(stopsAt('none')).toBe(4)
  })

  it('walks a standing caret past a run that stops on neither side', () => {
    const row = createInlineRow('foo(1)', [
      injected('a-pad', 4, ' ', 'none'),
      injected('b-hint', 4, 'arg:', 'right'),
    ])

    expect(row.text).toBe('foo( arg:1)')
    expect(sourceColumnToInlineColumn(row, 4)).toBe(9)
  })
})

describe('inline display rows', () => {
  it('leaves rows untouched when no replacements are supplied', () => {
    const text = 'abcd\nefgh'
    const rows = createDisplayRows({
      text,
      lineStarts: computeLineStarts(text),
      visibleLineCount: 2,
      bufferRowForVisibleRow: (row) => row,
      inlineReplacements: () => [],
    })

    expect(rows.map((row) => isDocumentTextDisplayRow(row) && row.inlineRow)).toEqual([
      undefined,
      undefined,
    ])
    expect(
      rows.map((row) =>
        row.kind === 'text' ? [row.text, row.sourceStartColumn, row.displayStartColumn] : null,
      ),
    ).toEqual([
      ['abcd', 0, 0],
      ['efgh', 0, 0],
    ])
  })

  it('renders display text while keeping offsets in source space', () => {
    const text = '# Title\na **b** c'
    const replacements: Record<number, InlineReplacement[]> = {
      0: [hidden('heading', 0, 2)],
      1: [hidden('open', 2, 4), hidden('close', 5, 7)],
    }
    const rows = createDisplayRows({
      text,
      lineStarts: computeLineStarts(text),
      visibleLineCount: 2,
      bufferRowForVisibleRow: (row) => row,
      inlineReplacements: (row) => replacements[row] ?? [],
    })

    expect(
      rows.map((row) => (row.kind === 'text' ? [row.text, row.startOffset, row.endOffset] : null)),
    ).toEqual([
      ['Title', 0, 7],
      ['a b c', 8, 17],
    ])
  })

  it('wraps the display text rather than the source text', () => {
    const text = '# aaaa bbbb'
    const rows = createDisplayRows({
      text,
      lineStarts: computeLineStarts(text),
      visibleLineCount: 1,
      bufferRowForVisibleRow: (row) => row,
      wrapColumn: 4,
      inlineReplacements: () => [hidden('heading', 0, 2)],
    })

    expect(rows.map((row) => row.text)).toEqual(['aaaa', ' bbb', 'b'])
  })
})
