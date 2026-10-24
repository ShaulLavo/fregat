import { createEditorTextBuffer } from '../../src/documentSession'
import type {
  DocumentChangesSinceSyncPoint,
  DocumentLogicalRevisionScope,
  DocumentSyncPoint,
} from '../../src/editor/editChain'

const buffer = createEditorTextBuffer('')

export const TEST_DOCUMENT_SYNC_POINT = buffer.getDocumentSyncPoint()

export function unchangedChangesSinceDocumentSyncPoint(
  point: DocumentSyncPoint,
  _scope: DocumentLogicalRevisionScope | null,
): DocumentChangesSinceSyncPoint | null {
  if (point !== TEST_DOCUMENT_SYNC_POINT) return null
  return {
    edits: [],
    logicalRevisionCount: 0,
    revisionAfter: point.revision,
    syncPointAfter: point,
  }
}
