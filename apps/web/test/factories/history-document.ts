import {
  commitPreparedDocumentTransaction,
  createEditorBufferSession,
  prepareDocumentTransaction,
  type EditorTextBuffer,
  type TextEdit,
} from '@singapore-editor/core'
import type { EditorDocumentStoreApi } from '@/features/editor/state/document-state'
import type { FilesystemPath } from '@/lib/documents/utils/types'

export function historyDocument({
  store,
  path,
  content,
  cursorOffset = content.length,
  insertions = [],
}: {
  store: EditorDocumentStoreApi
  path: FilesystemPath
  content: string
  cursorOffset?: number
  insertions?: readonly string[]
}) {
  const document = store.getState().ensureLiveEditorDocument({
    content,
    mtimeMs: 1,
    path,
    size: content.length,
    version: 'v1',
  })
  const session = createEditorBufferSession(document.buffer)
  session.setSelection(cursorOffset)
  for (const text of insertions) {
    session.applyText(text)
    session.breakTypingRun()
  }
  return document
}

export function commitHistoryBarrier(buffer: EditorTextBuffer, edits: readonly TextEdit[]) {
  return commitPreparedDocumentTransaction(
    { buffer, sourceView: null },
    prepareDocumentTransaction(buffer, edits, 2, null),
    { history: { groupId: 'rename', kind: 'external-barrier' } },
  )
}
