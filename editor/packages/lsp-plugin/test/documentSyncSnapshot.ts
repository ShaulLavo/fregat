import { createStringTextSnapshot, type DocumentSyncSegment } from '@singapore-editor/core/document'
import type { EditorViewSnapshot } from '@singapore-editor/core/extensions'

type EditorLineStartsView = EditorViewSnapshot['lineStartsView']

const TEST_DOCUMENT_SYNC_SEGMENT = Object.freeze({}) as DocumentSyncSegment
const keyedSegments = new Map<string, DocumentSyncSegment>()

export function documentSyncSnapshotFields(
  textVersion: number,
  segmentKey?: string,
): Pick<EditorViewSnapshot, 'changesSinceDocumentSyncPoint' | 'documentSyncPoint'> {
  const segment = segmentKey ? segmentForKey(segmentKey) : TEST_DOCUMENT_SYNC_SEGMENT
  return {
    changesSinceDocumentSyncPoint: () => null,
    documentSyncPoint: {
      revision: textVersion,
      segment,
      textVersion,
    },
  }
}

export function viewSnapshotStructuralFields(): Pick<
  EditorViewSnapshot,
  | 'gutterLayout'
  | 'gutterWidth'
  | 'initialHighlightStatus'
  | 'syntaxStatus'
  | 'paintLayers'
  | 'toVisibleSnapshot'
> {
  return {
    gutterLayout: { leadingInset: 0, fixedWidth: 0, lanes: [] },
    gutterWidth: 0,
    initialHighlightStatus: 'painted',
    syntaxStatus: 'ready',
    paintLayers: [],
    toVisibleSnapshot() {
      return null
    },
  }
}

function segmentForKey(key: string): DocumentSyncSegment {
  const current = keyedSegments.get(key)
  if (current) return current

  const created = Object.freeze({}) as DocumentSyncSegment
  keyedSegments.set(key, created)
  return created
}

/** A view snapshot's text fields over a string, line starts included. */
export function viewTextFields(
  text: string,
): Pick<EditorViewSnapshot, 'textSnapshot' | 'lineStarts' | 'lineStartsView'> {
  const textSnapshot = createStringTextSnapshot(text)
  const lineStarts = Array.from({ length: textSnapshot.lineCount }, (_, index) =>
    textSnapshot.lineStart(index),
  )
  return { textSnapshot, lineStarts, lineStartsView: arrayLineStartsView(lineStarts) }
}

/** The whole text a fixture snapshot holds; tests read it, production code never does. */
export function viewText(snapshot: Pick<EditorViewSnapshot, 'textSnapshot'>): string {
  return snapshot.textSnapshot.readRange(0, snapshot.textSnapshot.length)
}

function arrayLineStartsView(lineStarts: readonly number[]): EditorLineStartsView {
  const indexForOffset = (offset: number): number => {
    let row = 0
    while (row + 1 < lineStarts.length && (lineStarts[row + 1] ?? 0) <= offset) row += 1
    return row
  }
  return {
    length: lineStarts.length,
    at: (index) => lineStarts[index],
    indexForOffset,
    firstIndexAtOrAfter: (offset) => {
      const index = lineStarts.findIndex((start) => start >= offset)
      return index === -1 ? lineStarts.length : index
    },
    toArray: () => lineStarts,
  }
}
