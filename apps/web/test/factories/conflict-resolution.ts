import { streamWorkspaceEvents } from '@/features/workspace/state/event-stream'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createEditorBufferSession } from '@singapore-editor/core'
import { createEditorConflictStore } from '@/features/editor/state/conflict-state'
import { createEditorDocumentStore } from '@/features/editor/state/document-state'
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
import {
  registerEnvironmentQueryClient,
  originForQueryClient,
} from '@/lib/environments/state/query-clients'
import { fetchFile } from '@/lib/file-server'
import { createTestQueryClient } from '../render'
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
  const documentStore = createEditorDocumentStore()
  const conflictStore = createEditorConflictStore()
  const queryClient = createTestQueryClient()
  registerEnvironmentQueryClient(queryClient, originForQueryClient(queryClient), transport.client)
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
  conflictStore.getState().addConflict({
    id: target.conflictId,
    eventType: deleted ? 'deleted' : 'changed',
    diffDocumentKey: key,
    localPath: path,
    localText: 'local text',
    remotePath: path,
    remoteText: deleted ? null : remote.content,
    remoteMtimeMs: deleted ? null : remote.mtimeMs,
    remoteSize: deleted ? null : remote.size,
    remoteVersion: deleted ? null : remote.version,
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
        discardLiveEditorDocument: (document) =>
          documents.deleteLiveEditorDocument(documentKey(document)),
        dirtyDocumentKeys: documents.dirtyDocumentKeys,
        ensureUnsyncedEditorDocument: documents.ensureUnsyncedEditorDocument,
        events: events.splice(0),
        forceReplaceLiveEditorDocument: documents.forceReplaceLiveEditorDocument,
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
