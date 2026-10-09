import { vi } from 'vitest'
import { createEditorTextBuffer, type EditorTextBuffer } from '@singapore-editor/core/document'
import type { DocumentKey, FilesystemPath } from '@/lib/documents/utils/types'
import type { FileOpenIntentPreparedLease } from '@/lib/file-open-intent/state/service'
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

export function preparedLeaseFor(
  document: {
    readonly buffer: EditorTextBuffer
    readonly key: DocumentKey
    readonly localRevision: number
  },
  path: FilesystemPath,
  preparedDocument: EditorPreparedDocument = preparedDocumentLease(),
  fileVersion: string | null = null,
): FileOpenIntentPreparedLease {
  return {
    buffer: document.buffer,
    document: preparedDocument,
    documentKey: document.key,
    fileVersion,
    localRevision: document.localRevision,
    path,
    release: vi.fn(),
    snapshot: document.buffer.getSnapshot(),
  }
}
