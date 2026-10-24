import type { LanguageServerDocumentSnapshot } from './types'
import type { LspTextDocumentSnapshot } from '@singapore-editor/lsp'

/** The view's text and line-start index as an LSP document snapshot, so nothing rescans the text. */
export function viewDocumentSnapshot(
  snapshot: LanguageServerDocumentSnapshot,
): LspTextDocumentSnapshot {
  return {
    textSnapshot: snapshot.textSnapshot,
    lineStarts: snapshot.lineStartsView,
  }
}
