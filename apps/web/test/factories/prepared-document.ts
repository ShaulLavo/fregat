import { vi } from 'vitest'
import { createEditorTextBuffer } from '@singapore-editor/core/document'
import {
  createEditorDocumentAnalysis,
  type EditorPreparedDocument,
} from '@singapore-editor/core/editor'

export function preparedDocumentLease(
  runtimeSessionIds: ReturnType<EditorPreparedDocument['runtimeSessionIds']> = {
    highlighter: [],
    structural: [],
  },
): EditorPreparedDocument {
  const analysis = createEditorDocumentAnalysis({
    buffer: createEditorTextBuffer(''),
    documentId: 'prepared-test',
  })
  const contributionOwner = analysis.contributions.pin()
  if (!contributionOwner) throw new TypeError('The prepared fixture must retain its actual source')
  return {
    analysis,
    contributionOwner,
    dispose: vi.fn(() => {
      contributionOwner.dispose()
      analysis.dispose()
    }),
    estimatedBytes: 1,
    fallbackReady: Promise.resolve(true),
    runtimeSessionIds: () => runtimeSessionIds,
    startStage: vi.fn(() => null),
    borrow: vi.fn(() => null),
  }
}
