import { expect, it } from 'vitest'
import {
  acquireDocumentMutationLease,
  createEditorTextBuffer,
  releaseDocumentMutationLease,
  rotateDocumentSyncSegment,
} from '../src/documentSession'
import {
  createEditorDocumentAnalysis,
  setRetainedSyntaxDisplayDemand,
} from '../src/editor/documentAnalysis'
import { createEditorStructuralOperation } from '../src/editor/operationDefinitions'
import { createEmptySyntaxResult } from '../src/syntax/session'

it('rejects outgoing range contributors after a same-revision segment rotation', async () => {
  const buffer = createEditorTextBuffer('same source')
  const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'range-rotation' })
  const provider = {
    operation: createEditorStructuralOperation(() => ({
      analyze: async () => createEmptySyntaxResult(),
      queryRange: async () => createEmptySyntaxResult(),
      foldingSupport: 'unsupported',
      getResult: createEmptySyntaxResult,
      getTokens: () => [],
      getSnapshotVersion: () => 0,
      dispose() {},
    })),
  }
  const lease = analysis.borrowStructural({ provider, languageId: 'fixture' })!
  const range = { startIndex: 0, endIndex: 4 }
  const snapshot = buffer.getTextSnapshot()
  const oldResult = await lease.queryRange(range)
  const frame = { kind: 'frame', snapshot, ranges: [range] } as const
  setRetainedSyntaxDisplayDemand(lease, frame, [{ range, result: oldResult }])
  const acquired = acquireDocumentMutationLease(
    buffer,
    buffer.getRevision(),
    buffer.getSnapshot(),
    'range-rotation',
  )
  if (acquired.status !== 'acquired') expect.unreachable('Expected mutation lease')
  try {
    const point = buffer.getDocumentSyncPoint()
    expect(rotateDocumentSyncSegment(buffer, point, acquired.lease).status).toBe('rotated')
    expect(buffer.getDocumentSyncPoint().revision).toBe(point.revision)
    await lease.refresh(snapshot)
    setRetainedSyntaxDisplayDemand(lease, frame, [{ range, result: oldResult }])
    const currentRead = lease.read(range)
    if (currentRead.kind === 'ready') expect(currentRead.result).not.toBe(oldResult)
    const current = await lease.queryRange(range)
    expect(current).not.toBe(oldResult)
    expect(lease.read(range)).toMatchObject({ kind: 'ready', result: current })
  } finally {
    releaseDocumentMutationLease(buffer, acquired.lease)
    lease.dispose()
    analysis.dispose()
  }
})
