import { describe } from 'vitest'

import { expect, test as it } from '../../../../test/fixtures'

import {
  EXCERPT_EDITOR_LINE_HEIGHT,
  FILE_RESULTS_ROW_VERTICAL_PADDING,
  SEARCH_RESULT_FILE_EDITOR_FULL_RENDER_LINE_LIMIT,
  SEARCH_RESULT_FILE_EDITOR_LINE_OVERSCAN,
  SEARCH_RESULT_FILE_EDITOR_ROW_GAP,
  SEARCH_RESULT_STATIC_EDITOR_LINE_LIMIT,
  SEARCH_RESULT_VIRTUAL_ROW_OFFSET,
} from '@/features/search/utils/result-editor-constants'
import {
  searchResultFileDocumentWindow,
  searchResultFileDocumentRevision,
  searchResultFileEditorLineWindow,
  searchResultFileEditorHeight,
  searchResultFileEditorRowHeight,
  searchResultFileEditorScrollMode,
  searchResultFileEditorStyle,
  searchResultFileEditorVisibleLineCount,
  searchResultFileDocumentVisibleLines,
  searchResultVirtualRowInputs,
  searchResultVirtualRowScrollTarget,
} from '@/features/search/utils/result-editor'
import { createSearchResultVirtualListMetrics } from '@/features/search/utils/result-virtual-list'
import type {
  SearchResultFileBlock,
  SearchResultFileDocument,
  SearchResultVirtualRow,
} from '@/features/search/utils/result-view-model'

describe('search result editor utils', () => {
  it('uses static editor mode for normal file result groups', () => {
    expect(searchResultFileEditorScrollMode(SEARCH_RESULT_STATIC_EDITOR_LINE_LIMIT)).toBe('static')
  })

  it('uses capped virtualized editor mode for long file result groups', () => {
    const cappedHeight = editorHeightForLineCount(SEARCH_RESULT_STATIC_EDITOR_LINE_LIMIT)
    const longLineCount = SEARCH_RESULT_STATIC_EDITOR_LINE_LIMIT + 1

    expect(searchResultFileEditorScrollMode(longLineCount)).toBe('virtualized')
    expect(searchResultFileEditorVisibleLineCount(longLineCount)).toBe(
      SEARCH_RESULT_STATIC_EDITOR_LINE_LIMIT,
    )
    expect(searchResultFileEditorHeight(longLineCount)).toBe(cappedHeight)
    expect(searchResultFileEditorRowHeight(fileWithExcerptCount(longLineCount))).toBe(
      cappedHeight + FILE_RESULTS_ROW_VERTICAL_PADDING,
    )
  })

  it('keeps normal row estimates aligned with rendered editor height', () => {
    const document = documentWithLineCount(3)
    const file = fileWithExcerptCount(3)
    const style = searchResultFileEditorStyle(document)

    expect(style.height).toBe(editorHeightForLineCount(3))
    expect(searchResultFileEditorRowHeight(file)).toBe(
      Number(style.height) + FILE_RESULTS_ROW_VERTICAL_PADDING,
    )
  })

  it.each([20, 24])('aligns result blocks with measured %ipx headers', (headerHeight) => {
    const file = fileWithExcerptCount(3)
    const rows: SearchResultVirtualRow[] = [
      { type: 'file', file },
      { type: 'file-results', file },
      { type: 'file', file: { ...file, id: 'file:next' } },
    ]
    const metrics = createSearchResultVirtualListMetrics(
      searchResultVirtualRowInputs(rows, headerHeight),
    )
    const bodyHeight = editorHeightForLineCount(3) + FILE_RESULTS_ROW_VERTICAL_PADDING

    expect(metrics.items.map(({ size, start }) => ({ size, start }))).toEqual([
      { size: headerHeight, start: 0 },
      { size: bodyHeight, start: headerHeight },
      { size: headerHeight, start: headerHeight + bodyHeight },
    ])
  })

  it('uses the measured list item height when revealing a file header', () => {
    const file = fileWithExcerptCount(3)

    expect(searchResultVirtualRowScrollTarget({ type: 'file', file }, file.id)).toBeNull()
  })

  it('caps sidecar rows to the same visible line count as the editor body', () => {
    const lineCount = SEARCH_RESULT_STATIC_EDITOR_LINE_LIMIT + 10

    expect(searchResultFileDocumentVisibleLines(documentWithLineCount(lineCount))).toHaveLength(
      SEARCH_RESULT_STATIC_EDITOR_LINE_LIMIT,
    )
  })

  it('computes the visible line window from the outer virtual viewport', () => {
    const rowStride = EXCERPT_EDITOR_LINE_HEIGHT + SEARCH_RESULT_FILE_EDITOR_ROW_GAP
    const contentTop = SEARCH_RESULT_VIRTUAL_ROW_OFFSET + FILE_RESULTS_ROW_VERTICAL_PADDING / 2
    const window = searchResultFileEditorLineWindow({
      lineCount: 100,
      viewport: {
        height: rowStride * 2,
        top: contentTop + rowStride * 20,
      },
      virtualItem: {
        index: 0,
        key: 'file-results',
        size: 3_000,
        start: 0,
      },
    })

    expect(window).toEqual({
      end: Math.ceil((rowStride * 22 + SEARCH_RESULT_FILE_EDITOR_LINE_OVERSCAN) / rowStride),
      offsetY:
        Math.floor((rowStride * 20 - SEARCH_RESULT_FILE_EDITOR_LINE_OVERSCAN) / rowStride) *
        rowStride,
      start: Math.floor((rowStride * 20 - SEARCH_RESULT_FILE_EDITOR_LINE_OVERSCAN) / rowStride),
    })
  })

  it.each([
    { start: 2_000, top: 0 },
    { start: 0, top: 3_000 },
  ])('does not mount small editors outside the excerpt region: %j', ({ start, top }) => {
    const window = searchResultFileEditorLineWindow({
      lineCount: 2,
      viewport: { height: 600, top },
      virtualItem: { index: 0, key: 'file-results', size: 100, start },
    })

    expect(window).toEqual({ end: 0, offsetY: 0, start: 0 })
  })

  it('keeps the full small document when it intersects the excerpt region', () => {
    const window = searchResultFileEditorLineWindow({
      lineCount: SEARCH_RESULT_FILE_EDITOR_FULL_RENDER_LINE_LIMIT,
      viewport: {
        height: 600,
        top: 0,
      },
      virtualItem: {
        index: 0,
        key: 'file-results',
        size: 100,
        start: 1_000,
      },
    })

    expect(window).toEqual({
      end: SEARCH_RESULT_FILE_EDITOR_FULL_RENDER_LINE_LIMIT,
      offsetY: 0,
      start: 0,
    })
  })

  it('does not mount a small editor until its first line enters the excerpt region', () => {
    const viewportHeight = 600
    const contentOffset = SEARCH_RESULT_VIRTUAL_ROW_OFFSET + FILE_RESULTS_ROW_VERTICAL_PADDING / 2
    const virtualItem = {
      index: 0,
      key: 'file-results',
      size: 100,
      start: viewportHeight + SEARCH_RESULT_FILE_EDITOR_LINE_OVERSCAN - contentOffset,
    }
    const options = { lineCount: 2, viewport: { height: viewportHeight, top: 0 }, virtualItem }

    expect(searchResultFileEditorLineWindow(options)).toEqual({ end: 0, offsetY: 0, start: 0 })
    expect(
      searchResultFileEditorLineWindow({
        ...options,
        virtualItem: { ...virtualItem, start: virtualItem.start - 1 },
      }),
    ).toEqual({ end: 2, offsetY: 0, start: 0 })
  })

  it('keeps line windows inside the static preview line cap', () => {
    const rowStride = EXCERPT_EDITOR_LINE_HEIGHT + SEARCH_RESULT_FILE_EDITOR_ROW_GAP
    const contentTop = SEARCH_RESULT_VIRTUAL_ROW_OFFSET + FILE_RESULTS_ROW_VERTICAL_PADDING / 2
    const window = searchResultFileEditorLineWindow({
      lineCount: SEARCH_RESULT_STATIC_EDITOR_LINE_LIMIT + 50,
      viewport: {
        height: rowStride * 4,
        top: contentTop + rowStride * (SEARCH_RESULT_STATIC_EDITOR_LINE_LIMIT - 2),
      },
      virtualItem: {
        index: 0,
        key: 'file-results',
        size: 10_000,
        start: 0,
      },
    })

    expect(window.end).toBe(SEARCH_RESULT_STATIC_EDITOR_LINE_LIMIT)
  })

  it('slices file documents and remaps editor offsets for the visible window', () => {
    const document = textDocument()
    const window = searchResultFileDocumentWindow(document, {
      end: 3,
      offsetY: 0,
      start: 1,
    })

    expect(window.text).toBe('beta\ngamma')
    expect(window.lines.map((line) => line.row)).toEqual([0, 1])
    expect(window.lines.map((line) => [line.start, line.end])).toEqual([
      [0, 4],
      [5, 10],
    ])
    expect(window.lines[0]?.matchRanges).toEqual([{ end: 3, start: 1 }])
  })

  it('changes the controlled editor revision when the visible window changes', () => {
    const document = textDocument()
    const firstWindow = lineWindow(0, 2)
    const secondWindow = lineWindow(1, 3)
    const firstRevision = searchResultFileDocumentRevision(
      searchResultFileDocumentWindow(document, firstWindow),
      firstWindow,
    )
    const secondRevision = searchResultFileDocumentRevision(
      searchResultFileDocumentWindow(document, secondWindow),
      secondWindow,
    )

    expect(firstRevision).not.toBe(secondRevision)
  })
})

function editorHeightForLineCount(lineCount: number) {
  const rowGaps = Math.max(0, lineCount - 1) * SEARCH_RESULT_FILE_EDITOR_ROW_GAP

  return lineCount * EXCERPT_EDITOR_LINE_HEIGHT + rowGaps
}

function fileWithExcerptCount(lineCount: number): SearchResultFileBlock {
  return {
    collapsed: false,
    excerpts: Array.from({ length: lineCount }, (_, index) => ({ id: `line:${index}` })),
    id: 'file:test',
    languageId: null,
    matchCount: lineCount,
    path: 'test.ts',
    pathLabel: 'test.ts',
    pending: false,
  } as unknown as SearchResultFileBlock
}

function documentWithLineCount(lineCount: number): SearchResultFileDocument {
  return {
    languageId: null,
    lines: Array.from({ length: lineCount }, (_, index) => ({ id: `line:${index}` })),
    path: 'test.ts',
    text: '',
  } as unknown as SearchResultFileDocument
}

function textDocument(): SearchResultFileDocument {
  const sourceMatch = { column: 1, line: 1, path: 'test.ts' }

  return {
    languageId: null,
    lines: [
      {
        end: 5,
        id: 'line:0',
        matchRanges: [{ end: 3, start: 1 }],
        pending: false,
        row: 0,
        sourceLine: 1,
        sourceMatch,
        start: 0,
      },
      {
        end: 10,
        id: 'line:1',
        matchRanges: [{ end: 9, start: 7 }],
        pending: false,
        row: 1,
        sourceLine: 2,
        sourceMatch,
        start: 6,
      },
      {
        end: 16,
        id: 'line:2',
        matchRanges: [],
        pending: false,
        row: 2,
        sourceLine: 3,
        sourceMatch,
        start: 11,
      },
    ],
    path: 'test.ts',
    text: 'alpha\nbeta\ngamma',
  } as unknown as SearchResultFileDocument
}

function lineWindow(start: number, end: number) {
  return {
    end,
    offsetY: 0,
    start,
  }
}
