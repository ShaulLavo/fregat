import { testScopedStorage } from './scoped-storage'
import { onTestFinished } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { createEditorDocumentStore } from '@/features/editor/state/document-state'
import { FileSyncService } from '@/features/editor/state/file-sync-service'
import {
  WorkspaceEditService,
  type WorkspaceEditRoot,
} from '@/features/editor/state/workspace-edit-service'
import { createFileSyncPorts } from '@/features/editor/utils/file-sync-ports'
import type { Client } from '@/lib/client'
import { clientLogContext } from '@/lib/environments/state/log-context'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { fetchFile } from '@/lib/file-server'
import {
  createEditorBufferSession,
  createDocumentLogicalRevisionScope,
} from '@singapore-editor/core/document'
import type { TextChangePreparation, TextChangeTarget } from '@/lib/workspace-edits/utils/types'

export function createWorkspaceTextChanges(client: Client) {
  const store = createEditorDocumentStore({ environmentId: testScopedStorage.environmentId })
  const queryClient = new QueryClient()
  const fileSync = new FileSyncService(store, queryClient, createFileSyncPorts(client))
  let root: WorkspaceEditRoot = {
    generation: 1,
    path: filesystemPath(''),
    uriPath: filesystemPath('/'),
  }
  const service = new WorkspaceEditService({
    owner: clientLogContext(client),
    documentStore: store,
    fileSync,
    getRoot: () => root,
  })
  onTestFinished(() => {
    service.dispose()
    queryClient.clear()
  })
  return {
    store,
    service,
    fileSync,
    setRoot: (next: WorkspaceEditRoot) => {
      root = next
    },
  }
}

export function prepareTextTarget(
  operation: TextChangePreparation,
  path = 'first.ts',
): Promise<TextChangeTarget> {
  return operation
    .readText(filesystemPath(path))
    .then((source) => ({ source, edits: [{ from: 0, to: 6, text: 'pin' }] }))
}

export async function textChangePreview(service: WorkspaceEditService): Promise<string> {
  if (service.getSnapshot().preview) return service.getSnapshot().preview!.operationId
  return new Promise((resolve) => {
    const unsubscribe = service.subscribe(() => {
      const preview = service.getSnapshot().preview
      if (!preview) return
      unsubscribe()
      resolve(preview.operationId)
    })
  })
}

export async function createWorkspaceTextComparison(client: Client, path: string) {
  const fixture = createWorkspaceTextChanges(client)
  const target = filesystemPath(path)
  const file = await fetchFile(target, new AbortController().signal, client)
  const document = fixture.store.getState().ensureLiveEditorDocument(file)
  createEditorBufferSession(document.buffer).applyEdits([{ from: 0, to: 0, text: '// captured\n' }])
  const pending = fixture.service.applyTextChange({
    source: 'search-replace',
    signal: new AbortController().signal,
    prepare: async (operation) => ({
      label: 'Replace captured text',
      requireConfirmation: true,
      targets: [
        {
          source: await operation.readText(target),
          edits: [{ from: 3, to: 11, text: 'presented' }],
        },
      ],
    }),
  })
  const operationId = await textChangePreview(fixture.service)
  const preview = fixture.service.getSnapshot().preview
  const row = preview?.rows[0]
  const read = row?.comparison
  if (!preview || !row || read?.kind !== 'ready' || read.input.kind !== 'operation' || !row.file)
    throw new RangeError('Actual captured WorkspaceEdit comparison required')
  return {
    ...fixture,
    document,
    pending,
    operationId,
    preview,
    read,
    input: read.input,
    file: row.file,
  }
}

export async function createWorkspaceResourcePreview(client: Client) {
  const fixture = createWorkspaceTextChanges(client)
  const pending = fixture.service.onApplyWorkspaceEdit({
    guard: { documents: [], isCurrent: (uri) => uri === 'file:///origin.ts' },
    label: 'Create a resource',
    logicalRevisionScope: createDocumentLogicalRevisionScope(),
    originUri: 'file:///origin.ts',
    originVersion: 1,
    plan: {
      annotations: new Map(),
      operations: [
        { kind: 'create', uri: 'file:///created.ts', overwrite: false, ignoreIfExists: false },
      ],
    },
    serverId: 'fixture',
    signal: new AbortController().signal,
    source: 'code-action',
  })
  const operationId = await textChangePreview(fixture.service)
  return { ...fixture, operationId, pending }
}
