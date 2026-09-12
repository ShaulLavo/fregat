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
import type { TextChangePreparation, TextChangeTarget } from '@/lib/workspace-edits/utils/types'

export function createWorkspaceTextChanges(client: Client) {
  const store = createEditorDocumentStore()
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
