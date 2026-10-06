import { createAddressTestRuntime } from './address-runtime'
import { captureFilesystemLocal } from '@/lib/snapshot-comparison'
import { retainFilesystemConflict } from '@/features/workspace/state/event-conflict-adapter'
import { streamWorkspaceEvents } from '@/features/workspace/state/event-stream'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createEditorBufferSession } from '@singapore-editor/core'
import { FileSyncService } from '@/features/editor/state/file-sync-service'
import { applyWorkspaceEvents, type FilesystemEvent } from '@/features/workspace/hooks/use-events'
import { createWideEventScope } from '@/lib/wide-event-scope'
import { ConflictEditorResolutionCoordinator } from '@/features/workspace/state/conflict-editor-resolution'
import {
  conflictId,
  documentKey,
  fileDocumentKey,
  filesystemPath,
} from '@/lib/documents/utils/identity'
import { fetchFile } from '@/lib/file-server'
import type { TestServer } from '../server'
import { createGatedMutationClient } from './gated-mutation-client'

export async function createConflictResolutionFixture(
  server: TestServer,
  deleted = false,
  gatePath?: string,
  filePath = 'conflict.txt',
) {
  const path = filesystemPath(filePath)
  await mkdir(dirname(join(server.root, path)), { recursive: true })
  await writeFile(join(server.root, path), 'remote text')
  const transport = createGatedMutationClient(
    server,
    gatePath ?? (deleted ? '/fs/create-file' : '/fs/write'),
  )
  const remote = await fetchFile(path, new AbortController().signal, transport.client)
  const runtime = await createAddressTestRuntime(transport.client)
  const { documentStore, conflictStore } = runtime.editor
  const queryClient = runtime.application.getSnapshot().queryClient
  const environmentId = runtime.environmentId
  const target = {
    kind: 'conflict',
    conflictId: conflictId('resolution-test'),
    path,
  } as const
  const key = documentKey(target)
  const destination = documentStore.getState().ensureLiveEditorDocument(remote)
  const resolution = documentStore
    .getState()
    .ensureUnsyncedEditorDocument({ target, content: 'merged text' })
  let generation = 1
  const conflict = retainFilesystemConflict(
    {
      id: target.conflictId,
      eventType: deleted ? 'deleted' : 'changed',
      diffDocumentKey: key,
      localPath: path,
      localText: 'local text',
      remotePath: path,
      remoteFile: deleted ? null : remote,
      remoteText: deleted ? null : remote.content,
    },
    {
      comparisonScope: { environmentId, rootPath: filesystemPath('') },
      acquireSnapshotComparison: documentStore.getState().acquireSnapshotComparison,
      signal: new AbortController().signal,
    },
    captureFilesystemLocal(path, destination.buffer),
  )
  const seedLease = documentStore.getState().acquireSnapshotComparison({
    input: conflict.latest.input,
    signal: new AbortController().signal,
  })
  conflictStore.getState().addConflict({
    ...conflict,
    seed: {
      resolutionKey: key,
      buffer: resolution.buffer,
      comparison: { input: conflict.latest.input, lease: seedLease },
    },
  })
  const fileSync = new FileSyncService(documentStore, queryClient)
  const coordinator = new ConflictEditorResolutionCoordinator({
    issueWriteId: fileSync.issueWriteId,
    client: transport.client,
    documentStore,
    conflictStore,
    queryClient,
    getOperationRoot: () => ({ path: filesystemPath(''), generation }),
    discardLiveEditorDocument: (document) =>
      documentStore.getState().deleteLiveEditorDocument(documentKey(document)),
    renameLiveEditorDocument: documentStore.getState().renameLiveEditorDocumentPath,
  })
  return {
    path,
    key,
    target,
    remote,
    documentStore,
    conflictStore,
    queryClient,
    transport,
    resolution,
    destination,
    coordinator,
    isOwnEvent: fileSync.isOwnWriteEvent,
    schedule: () => coordinator.schedule(target, resolution.buffer.getTextSnapshot()),
    editResolution: () => createEditorBufferSession(resolution.buffer).applyText('new '),
    editDestination: () => createEditorBufferSession(destination.buffer).applyText('new '),
    resetRoot: () => {
      generation += 2
    },
    destinationText: () =>
      documentStore
        .getState()
        .getLiveEditorDocument(fileDocumentKey(path))
        ?.buffer.materializeFullText(),
    dispose: () => {
      coordinator.dispose()
      transport.release()
      conflictStore.getState().clearConflicts()
      documentStore.getState().disposeEditorDocuments()
      queryClient.clear()
    },
  }
}

export async function watchConflictResolutionEvents(
  fixture: Awaited<ReturnType<typeof createConflictResolutionFixture>>,
) {
  const controller = new AbortController()
  const ready = Promise.withResolvers<void>()
  const events: FilesystemEvent[] = []
  const scope = createWideEventScope({
    action: 'test.conflict-events',
    area: 'fs',
  })
  let gitInvalidations = 0
  const streaming = streamWorkspaceEvents(
    fixture.transport.client,
    '',
    controller.signal,
    (event) => {
      if (event.type === 'ready') ready.resolve()
      if (
        event.type === 'changed' ||
        event.type === 'created' ||
        event.type === 'deleted' ||
        event.type === 'renamed'
      ) {
        events.push(event)
      }
    },
  ).catch((error) => {
    if (!controller.signal.aborted) ready.reject(error)
  })
  await ready.promise
  return {
    events,
    gitInvalidations: () => gitInvalidations,
    async flush() {
      const documents = fixture.documentStore.getState()
      await applyWorkspaceEvents({
        conflictStore: fixture.conflictStore,
        acquireSnapshotComparison: documents.acquireSnapshotComparison,
        discardLiveEditorDocument: (document) =>
          documents.deleteLiveEditorDocument(documentKey(document)),
        dirtyDocumentKeys: documents.dirtyDocumentKeys,
        ensureUnsyncedEditorDocument: documents.ensureUnsyncedEditorDocument,
        events: events.splice(0),
        forceReplaceLiveEditorDocument: documents.forceReplaceLiveEditorDocument,
        setFileOrphaned: documents.setFileOrphaned,
        getLiveEditorDocument: documents.getLiveEditorDocument,
        isOwnWorkspaceEditEvent: fixture.isOwnEvent,
        openFilePaths: [fixture.path],
        queryClient: fixture.queryClient,
        renameLiveEditorDocument: documents.renameLiveEditorDocumentPath,
        rootPath: '',
        scheduleGitInvalidation: () => {
          gitInvalidations += 1
        },
        selectContent: () => undefined,
        signal: controller.signal,
        scope,
      })
    },
    async stop() {
      controller.abort()
      await streaming
      scope.end()
    },
  }
}
