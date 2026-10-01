import { describe, expect, it, vi } from 'vitest'
import { snapshotText } from './factories/snapshotText'
import type { EditorViewSnapshot } from '@singapore-editor/core/extensions'
import {
  TEST_DOCUMENT_SYNC_POINT,
  unchangedChangesSinceDocumentSyncPoint,
} from './factories/documentSync'
import {
  createEditorSecondaryTextView,
  createEditorSecondaryViewProjection,
} from '@singapore-editor/core/secondary-views'
import { EditorWorkScheduler } from '@singapore-editor/core/scheduling'
import { EditorTokenStore } from '@singapore-editor/core/syntax'

describe('secondary view projections', () => {
  it('reads fold summaries only when a consumer requests them and reuses the result', () => {
    const snapshot = editorViewSnapshot('alpha\nbeta')
    const markers = snapshot.foldMarkers
    const readMarkers = vi.fn(() => markers)
    Object.defineProperty(snapshot, 'foldMarkers', { get: readMarkers })

    const projection = createEditorSecondaryViewProjection(snapshot)
    expect(projection.text.length).toBe(10)
    expect(projection.selections).toBe(snapshot.selections)
    expect(readMarkers).not.toHaveBeenCalled()

    const summaries = projection.foldSummaries
    expect(summaries).toHaveLength(1)
    expect(projection.foldSummaries).toBe(summaries)
    expect(readMarkers).toHaveBeenCalledTimes(1)
  })

  it('projects snapshot-owned view data without reading any text', () => {
    const sourceText = 'alpha\nbeta'
    const snapshot = editorViewSnapshot(sourceText)
    const readRange = vi.spyOn(snapshot.textSnapshot, 'readRange')

    const projection = createEditorSecondaryViewProjection(snapshot)

    expect(projection.documentId).toBe('secondary-test')
    expect(projection.textVersion).toBe(7)
    expect(projection.text.length).toBe(sourceText.length)
    expect(projection.text.lineStarts).toEqual([0, 6])
    expect(projection.text.snapshot).toBe(snapshot.textSnapshot)
    expect(readRange).not.toHaveBeenCalled()
    expect(projection.syntaxColors.tokens.toTokens()).toEqual([
      { start: 0, end: 5, style: { color: '#ff0000' } },
    ])
    expect(projection.selections).toEqual([
      { anchorOffset: 1, headOffset: 3, startOffset: 1, endOffset: 3, affinity: 'after' },
    ])
    expect(projection.foldSummaries).toEqual([
      {
        key: 'fold:1',
        startOffset: 0,
        endOffset: sourceText.length,
        startLineNumber: 1,
        endLineNumber: 2,
        collapsed: true,
      },
    ])
    expect(projection.visibleLineModel.rows.map((row) => row.text)).toEqual(['alpha'])
  })

  it('creates a read-only text view outside the tab order that sizes itself', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const view = createEditorSecondaryTextView(host, { scrollMode: 'static', overscan: 0 })

    view.setText('alpha')
    view.setHeight(40)

    const scrollElement = host.querySelector<HTMLElement>('.editor-virtualized')
    const inputElement = host.querySelector('textarea')
    expect(scrollElement?.style.height).toBe('40px')
    expect(scrollElement?.tabIndex).toBe(-1)
    expect(inputElement?.tabIndex).toBe(-1)
    expect(inputElement?.readOnly).toBe(true)
    expect(EditorWorkScheduler).toBeTypeOf('function')
    view.dispose()
    host.remove()
  })
})

function editorViewSnapshot(text: string): EditorViewSnapshot {
  return {
    changesSinceDocumentSyncPoint: unchangedChangesSinceDocumentSyncPoint,
    documentId: 'secondary-test',
    documentSyncPoint: TEST_DOCUMENT_SYNC_POINT,
    languageId: 'typescript',
    ...snapshotText(text),
    textVersion: 7,
    initialHighlightStatus: 'painted',
    syntaxStatus: 'ready',
    paintLayers: [],
    lineStarts: [0, 6],
    tokens: EditorTokenStore.fromTokens([{ start: 0, end: 5, style: { color: '#ff0000' } }]),
    // 'alpha\nbeta' carries no bracket pairs, so the parse this stands in for published none.
    brackets: [],
    selections: [
      { anchorOffset: 1, headOffset: 3, startOffset: 1, endOffset: 3, affinity: 'after' },
    ],
    metrics: { rowHeight: 20, characterWidth: 8 },
    lineCount: 2,
    contentWidth: 80,
    totalHeight: 40,
    gutterWidth: 0,
    gutterLayout: { leadingInset: 0, fixedWidth: 0, lanes: [] },
    tabSize: 4,
    foldMarkers: [
      {
        key: 'fold:1',
        startOffset: 0,
        endOffset: text.length,
        startRow: 0,
        endRow: 1,
        collapsed: true,
      },
    ],
    visibleRows: [
      {
        index: 0,
        bufferRow: 0,
        source: 'document',
        startOffset: 0,
        endOffset: 5,
        text: 'alpha',
        kind: 'text',
        primaryText: true,
        firstWrapSegment: true,
        top: 0,
        height: 20,
        leftSpacerWidth: 0,
        contentCursorLine: false,
        gutterNumberCursorLine: false,
        gutterCursorLineBackgroundLaneIds: [],
        mountedPaintSupport: 'replayable',
        chunks: [],
        foldMarker: null,
      },
    ],
    viewport: {
      scrollRow: 0,
      scrollTop: 0,
      scrollLeft: 0,
      scrollHeight: 40,
      scrollWidth: 80,
      clientHeight: 20,
      clientWidth: 80,
      borderBoxHeight: 20,
      borderBoxWidth: 80,
      visibleRange: { start: 0, end: 1 },
    },
    toVisibleSnapshot() {
      return null
    },
  }
}
