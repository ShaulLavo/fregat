import type { EditorTextBuffer, EditorViewSession } from '@singapore-editor/core/document'
import type {
  EditorDocumentAnalysis,
  EditorPreparedDocument,
  EditorScrollPosition,
} from '@singapore-editor/core/editor'
import type { DocumentKey, DocumentRef } from '@/lib/documents/utils/types'

export type EditorRenderDocument = {
  readonly analysis?: EditorDocumentAnalysis | null
  readonly buffer: EditorTextBuffer
  readonly contentRevision?: string
  readonly editability: 'editable' | 'readonly'
  readonly key: DocumentKey
  readonly target: DocumentRef
  readonly preparedDocument?: EditorPreparedDocument | null
  readonly scrollPosition?: EditorScrollPosition
  readonly view: EditorViewSession
}
