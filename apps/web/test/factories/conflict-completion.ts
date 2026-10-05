import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { filesystemPath } from '@/lib/documents/utils/identity'
import { fetchFile } from '@/lib/file-server'
import { setFileSnapshotQueryData } from '@/lib/file-snapshot-query-cache'
import type { WorkspaceConflictContext } from '@/features/workspace/state/event-conflict-adapter'
import { createObservedInProcessClient } from '../client'
import type { TestServer } from '../server'
import { createAddressTestRuntime } from './address-runtime'

export async function createConflictCompletionFixture(server: TestServer) {
  const entered = Promise.withResolvers<void>()
  const released = Promise.withResolvers<void>()
  let holdRead = false
  let held = false
  const transport = createObservedInProcessClient(server, async (request) => {
    if (!holdRead || held || new URL(request.url).pathname !== '/fs/read') return
    held = true
    entered.resolve()
    await released.promise
  })
  const path = filesystemPath('toast-conflict.txt')
  await writeFile(join(server.root, path), 'remote text')
  const remote = await fetchFile(path, new AbortController().signal, transport)
  const runtime = await createAddressTestRuntime(transport)
  const { documentStore, conflictStore } = runtime.editor
  const queryClient = runtime.application.getSnapshot().queryClient
  const documents = documentStore.getState()
  const destination = documents.ensureLiveEditorDocument(remote)
  setFileSnapshotQueryData(queryClient, remote)
  const context: WorkspaceConflictContext = {
    comparisonScope: { environmentId: runtime.environmentId, rootPath: filesystemPath('') },
    acquireSnapshotComparison: documents.acquireSnapshotComparison,
    signal: new AbortController().signal,
    client: transport,
    conflictStore,
    queryClient,
    discardLiveEditorDocument: runtime.commands.discardLiveEditorDocument,
    ensureUnsyncedEditorDocument: documents.ensureUnsyncedEditorDocument,
    fetchFile: (target, signal) => fetchFile(target, signal, transport),
    forceReplaceLiveEditorDocument: documents.forceReplaceLiveEditorDocument,
    getLiveEditorDocument: documents.getLiveEditorDocument,
    renameLiveEditorDocument: runtime.commands.renameLiveEditorDocument,
    selectContent: runtime.commands.selectContent,
    setFileOrphaned: documents.setFileOrphaned,
  }
  return {
    ...runtime,
    path,
    remote,
    queryClient,
    documents,
    destination,
    context,
    entered,
    released,
    holdRefetch: () => {
      holdRead = true
    },
  }
}
