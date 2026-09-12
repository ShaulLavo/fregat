import { writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createEditorTextBuffer } from '@singapor/core'
import { createEditorConflictStore } from '@/features/editor/state/conflict-state'
import { createEditorDocumentStore } from '@/features/editor/state/document-state'
import { resolveConflictEditorSnapshot } from '@/features/workspace/utils/conflict-editor-resolution'
import {
  conflictId,
  documentKey,
  fileDocumentKey,
  filesystemPath,
} from '@/lib/documents/utils/identity'
import { fetchFile } from '@/lib/file-server'
import { expect, test } from '../../../../test/fixtures'
import { createTestQueryClient } from '../../../../test/render'

test('resolving a conflict writes its file resource and discards only the resolution document', async ({
  client,
  server,
}) => {
  void client
  const path = filesystemPath('conflict.txt')
  await writeFile(join(server.root, path), 'remote text')
  const remote = await fetchFile(path, new AbortController().signal)
  const documents = createEditorDocumentStore()
  const conflicts = createEditorConflictStore()
  const queryClient = createTestQueryClient()
  const target = { kind: 'conflict', conflictId: conflictId('resolution-test') } as const
  const key = documentKey(target)
  documents.getState().ensureLiveEditorDocument(remote)
  documents.getState().ensureUnsyncedEditorDocument({ target, content: 'resolution draft' })
  conflicts.getState().addConflict({
    id: target.conflictId,
    eventType: 'changed',
    diffDocumentKey: key,
    localPath: path,
    localText: 'local text',
    remotePath: path,
    remoteText: remote.content,
    remoteMtimeMs: remote.mtimeMs,
    remoteSize: remote.size,
    remoteVersion: remote.version,
  })
  const resolving = { current: new Set<string>() }
  try {
    resolveConflictEditorSnapshot(target, createEditorTextBuffer('merged text').getTextSnapshot(), {
      conflictStore: conflicts,
      discardLiveEditorDocument: (document) =>
        documents.getState().deleteLiveEditorDocument(documentKey(document)),
      forceReplaceLiveEditorDocument: documents.getState().forceReplaceLiveEditorDocument,
      renameLiveEditorDocument: documents.getState().renameLiveEditorDocumentPath,
      queryClient,
      resolvingConflictIds: resolving,
    })
    await expect.poll(() => resolving.current.size).toBe(0)
    expect(await readFile(join(server.root, path), 'utf8')).toBe('merged text')
    expect(documents.getState().getLiveEditorDocument(key)).toBeNull()
    const file = documents.getState().getLiveEditorDocument(fileDocumentKey(path))
    expect(file?.target).toEqual({ kind: 'file', resource: { path } })
    expect(file?.buffer.materializeFullText()).toBe('merged text')
    expect(conflicts.getState().conflicts).toEqual({})
  } finally {
    queryClient.clear()
  }
})
