import { createEditorTextBuffer } from '@singapor/core/document'
import type { EditorViewSnapshot } from '@singapor/core/extensions'

export function languageServerSnapshot(
  documentId: string,
  languageId: EditorViewSnapshot['languageId'] = 'typescript',
): EditorViewSnapshot {
  const buffer = createEditorTextBuffer('const value = 1')
  const view = {
    documentId,
    languageId,
    fullText: buffer.materializeFullText(),
    textVersion: 0,
    initialHighlightStatus: 'plain' as const,
    lineStarts: [0],
    lineCount: 1,
    tokens: [],
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
    toJSON: () => ({ ...view, kind: 'editor-view', schemaVersion: 1, theme: null }),
    toVisibleSnapshot: () => null,
  }
}
