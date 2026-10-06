import {
  createEditorTextBuffer,
  createEditorBufferSession,
  type DocumentTextSnapshot,
} from '@singapore-editor/core/document'
import { createEditorDocumentAnalysis } from '@singapore-editor/core/editor'
import type { EditorSyntaxProvider } from '@singapore-editor/core/syntax'

const disposers = new Set<() => void>()
export function disposeSyntaxDocuments() {
  for (const dispose of disposers) dispose()
  disposers.clear()
}
export function createSyntaxDocument(
  provider: EditorSyntaxProvider,
  text: string,
  documentId: string,
  languageId = 'typescript',
) {
  const buffer = createEditorTextBuffer(text)
  const view = createEditorBufferSession(buffer)
  const analysis = createEditorDocumentAnalysis({ buffer, documentId })
  const lease = analysis.borrowStructural({ provider, languageId, syntaxMode: 'full' })
  if (!lease) {
    analysis.dispose()
    return null
  }
  const dispose = () => {
    lease.dispose()
    analysis.dispose()
    disposers.delete(dispose)
  }
  disposers.add(dispose)
  return {
    buffer,
    foldingSupport: lease.foldingSupport,
    dispose,
    refresh: (snapshot: DocumentTextSnapshot) => {
      if (snapshot === buffer.getTextSnapshot()) return lease.refresh(snapshot)
      const next = snapshot.readRange(0, snapshot.length)
      const current = buffer.getTextSnapshot()
      if (current.length !== next.length || current.readRange(0, current.length) !== next)
        view.applyEdits([{ from: 0, to: current.length, text: next }])
      return lease.refresh(buffer.getTextSnapshot())
    },
  }
}
