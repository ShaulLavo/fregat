import type {
  EditorPreparedDocument,
  EditorScrollPosition,
  EditorTextBuffer,
  EditorViewSession,
} from '@singapor/core'
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
