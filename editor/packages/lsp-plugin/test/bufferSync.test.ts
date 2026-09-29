import { LanguageServerDocumentSyncController } from '../src/documentSyncController'
import { describe, expect, it } from 'vitest'
import {
  createEditorBufferSession,
  createEditorTextBuffer,
  acquireDocumentMutationLease,
  releaseDocumentMutationLease,
  rotateDocumentSyncSegment,
} from '@singapore-editor/core/document'
import { LspWorkspace } from '@singapore-editor/lsp'
import { synchronizeLanguageServerBuffer } from '../src/bufferSync'

describe('synchronizeLanguageServerBuffer', () => {
  it('retains the current identity through repeated URI transitions and edits', () => {
    const workspace = new LspWorkspace()
    const buffer = createEditorTextBuffer('x')
    const session = createEditorBufferSession(buffer)
    const controller = new LanguageServerDocumentSyncController()
    const sync = synchronizeLanguageServerBuffer(
      { workspace, client: {} as never },
      { buffer, uri: 'file:///a.ts', languageId: 'typescript', controller },
    )
    const move = (fromUri: string, toUri: string) => {
      const lease = acquireDocumentMutationLease(
        buffer,
        buffer.getRevision(),
        buffer.getSnapshot(),
        'test',
      )
      if (lease.status !== 'acquired') throw new Error('missing lease')
      const result = rotateDocumentSyncSegment(buffer, buffer.getDocumentSyncPoint(), lease.lease)
      releaseDocumentMutationLease(buffer, lease.lease)
      if (result.status !== 'rotated') throw new Error('missing segment')
      controller.transitionDocumentUri({
        fromUri,
        toUri,
        textSnapshot: buffer.getTextSnapshot(),
        syncPoint: result.syncPoint,
      })
    }
    move('file:///a.ts', 'file:///b.ts')
    session.applyEdits([{ from: 1, to: 1, text: '1' }])
    move('file:///b.ts', 'file:///c.ts')
    session.applyEdits([{ from: 2, to: 2, text: '2' }])
    expect(workspace.documents.map((document) => document.uri)).toEqual(['file:///c.ts'])
    sync.dispose()
  })
  it('retains exact snapshots for dirty cross-file edit provenance and closes its attachment', () => {
    const workspace = new LspWorkspace()
    const buffer = createEditorTextBuffer('saved')
    const session = createEditorBufferSession(buffer)
    const sync = synchronizeLanguageServerBuffer(
      { workspace, client: {} as never },
      { buffer, uri: 'file:///b.ts', languageId: 'typescript' },
    )
    expect(workspace.documents[0]?.textSnapshot).toBe(buffer.getTextSnapshot())
    const version = workspace.documents[0]!.version
    const before = buffer.getTextSnapshot()
    session.applyEdits([{ from: 0, to: 5, text: 'unsaved' }])
    expect(workspace.documents[0]?.textSnapshot).toBe(buffer.getTextSnapshot())
    expect(buffer.getTextSnapshot()).not.toBe(before)
    expect(workspace.documents[0]?.version).toBe(version + 1)
    sync.dispose()
    expect(workspace.documents).toEqual([])
  })
})
