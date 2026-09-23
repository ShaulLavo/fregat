import { createEditorTextBuffer } from '@singapore-editor/core/document'
import { EditorTokenStore } from '@singapore-editor/core'
import type { EditorViewSnapshot } from '@singapore-editor/core/extensions'

export function languageServerSnapshot(
  documentId: string,
  languageId: EditorViewSnapshot['languageId'] = 'typescript',
  text = 'const value = 1',
): EditorViewSnapshot {
  const buffer = createEditorTextBuffer(text)
  const lineStarts = lineStartsOf(text)
  const view = {
    documentId,
    languageId,
    textVersion: 0,
    initialHighlightStatus: 'plain' as const,
    lineStarts,
    lineStartsView: {
      length: lineStarts.length,
      at: (index: number) => lineStarts[index],
      indexForOffset: (offset: number) => buffer.getTextSnapshot().lineAt(offset),
      firstIndexAtOrAfter: (offset: number) => {
        const index = lineStarts.findIndex((start) => start >= offset)
        return index === -1 ? lineStarts.length : index
      },
      toArray: () => lineStarts,
    },
    lineCount: lineStarts.length,
    tokens: EditorTokenStore.empty(),
    brackets: [],
    selections: [],
    metrics: { rowHeight: 20, characterWidth: 8 },
    contentWidth: 120,
    totalHeight: 20,
    gutterWidth: 0,
    gutterLayout: { fixedWidth: 0, lanes: [] },
    tabSize: 4,
    foldMarkers: [],
    visibleRows: [],
    viewport: {
      scrollTop: 0,
      scrollRow: 0,
      scrollLeft: 0,
      scrollHeight: 20,
      scrollWidth: 120,
      clientHeight: 20,
      clientWidth: 120,
      borderBoxHeight: 20,
      borderBoxWidth: 120,
      visibleRange: { start: 0, end: 1 },
    },
  }
  return {
    ...view,
    textSnapshot: buffer.getTextSnapshot(),
    syntaxStatus: 'plain',
    paintLayers: null,
    documentSyncPoint: buffer.getDocumentSyncPoint(),
    changesSinceDocumentSyncPoint: (point, scope) =>
      buffer.changesSinceDocumentSyncPoint(point, scope),
    toVisibleSnapshot: () => null,
  }
}

function lineStartsOf(text: string): number[] {
  const starts = [0]
  for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) {
    starts.push(index + 1)
  }
  return starts
}
