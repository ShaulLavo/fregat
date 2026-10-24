import { createEditorTextBuffer } from '@singapore-editor/core/document'
import { createEditorDocumentAnalysis } from '@singapore-editor/core/editor'
import type { EditorHighlighterProvider } from '@singapore-editor/core/extensions'

export function retainHighlighter(provider: EditorHighlighterProvider, text: string) {
  const buffer = createEditorTextBuffer(text)
  const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'doc.ts' })
  const session = analysis.borrowHighlighter({ provider, languageId: 'typescript' })
  if (!session) {
    analysis.dispose()
    throw new TypeError('The highlighter operation must admit the document')
  }
  return {
    buffer,
    session,
    dispose: () => {
      session.dispose()
      analysis.dispose()
    },
  }
}
