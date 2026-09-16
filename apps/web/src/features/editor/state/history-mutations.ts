import { editorMutationKeys } from '@/features/editor/utils/mutation-keys'
import { notifyHistoryError } from '@/features/editor/utils/notify-history-error'
import type { DocumentKey } from '@/lib/documents/utils/types'
import type { EditorTextBuffer, HistoryNodeId } from '@singapore-editor/core'
import { mutationOptions } from '@tanstack/react-query'

// The buffer change these publish flows into the document store on its own, which is
// where every other consumer reads content revisions and dirty state from.
export function historyRestoreMutationOptions(key: DocumentKey, buffer: EditorTextBuffer) {
  return mutationOptions({
    mutationFn: async (id: HistoryNodeId) => buffer.checkoutHistoryState(id).kind !== 'none',
    mutationKey: editorMutationKeys.historyRestore(key),
    onError: notifyHistoryError,
    scope: { id: `editor-history:${key}` },
  })
}

export function historyClearMutationOptions(key: DocumentKey, buffer: EditorTextBuffer) {
  return mutationOptions({
    mutationFn: async () => buffer.clearHistory().kind !== 'none',
    mutationKey: editorMutationKeys.historyClear(key),
    onError: notifyHistoryError,
    scope: { id: `editor-history:${key}` },
  })
}
