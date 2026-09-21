import type { EditorTextBuffer, EditorViewSession } from '@singapore-editor/core/document'
import type { EditorPreparedDocument, EditorScrollPosition } from '@singapore-editor/core/editor'
import type { DocumentKey, DocumentRef } from '@/lib/documents/utils/types'

export type EditorRenderDocument = {
  readonly buffer: EditorTextBuffer
  readonly contentRevision?: string
  readonly editability: 'editable' | 'readonly'
  readonly key: DocumentKey
  readonly target: DocumentRef
  readonly preparedDocument?: EditorPreparedDocument | null
  readonly scrollPosition?: EditorScrollPosition
  readonly view: EditorViewSession
}
