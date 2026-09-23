import { isCancelledError, queryOptions, type QueryClient } from '@tanstack/react-query'
import type { WorkspaceEditHistoryEntry, WorkspaceEditResult } from '@workspace/contracts'
import { createClientError } from '@workspace/client-core/errors'
import { isSameOrInside } from '@workspace/utils/slash-paths'
import { toast } from 'sonner'

import { reportError, toClientError } from '@/lib/client-error-taxonomy'
import { log } from '@/lib/client-logging'
import { filePathsForTabs, filesystemResource } from '@/lib/documents/utils/capabilities'
import { filesystemPath } from '@/lib/documents/utils/identity'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { setFileSnapshotQueryData } from '@/lib/file-snapshot-query-cache'
import { fetchWorkspaceEditHistory } from '@/lib/file-server'
import type { FileResult } from '@/lib/file-system-types'
import { runMutation } from '@/lib/mutations/run'
import { fileSystemKeys } from '@/lib/query-keys'
import type { EditorDocumentStoreApi } from '@/features/editor/state/document-state'
import type {
  DocumentMove,
  FileOperationDocuments,
  FileOperationLeg,
  WorkspaceEditService,
} from '@/features/editor/state/workspace-edit-service'
import type { EditorWorkspaceStoreApi } from '@/features/editor/state/workspace-state'
import { runTreeIntent } from '@/features/workspace/state/tree-intents'
import { editorPathRenames } from '@/features/workspace/utils/editor-path-renames'
import { invalidateTreeQueries } from '@/features/workspace/utils/invalidate-queries'
import { fileHistoryScope, workspaceMutationKeys } from '@/features/workspace/utils/mutation-keys'
import type { TreePatch } from '@/features/workspace/utils/tree-patch'

/** Everything a tree change, its undo and its toast need, whether the tree is mounted or not. */
export type FileOperationRuntime = {
  readonly documents: FileOperationDocuments
  readonly queryClient: QueryClient
  readonly rootPath: FilesystemPath
  readonly workspaceEdits: Pick<
    WorkspaceEditService,
    'applyFileOperation' | 'discoverRecovery' | 'reverseFileOperation'
  >
}

type DocumentOwners = {
  readonly documentStore: EditorDocumentStoreApi
  readonly queryClient: QueryClient
  readonly renameLiveEditorDocument: (from: FilesystemPath, to: FilesystemPath) => unknown
  readonly workspaceStore: EditorWorkspaceStoreApi
}

export function fileOperationHistoryQuery(queryClient: QueryClient, rootPath: FilesystemPath) {
  return queryOptions({
    queryKey: fileSystemKeys.fileOperationHistory(rootPath),
    queryFn: ({ signal }) =>
      fetchWorkspaceEditHistory(
        rootPath,
        'file-operation',
        signal,
        clientForQueryClient(queryClient),
      ),
    // Another window can undo at any time; a stale head would reverse the wrong operation.
    staleTime: 0,
  })
}

/**
 * Open tabs, editor history, recently closed tabs and live documents follow a moved path; a
 * document orphaned by a delete comes back when the delete is undone.
 */
export function fileOperationDocuments(owners: DocumentOwners): FileOperationDocuments {
  return {
    move: (moves) => {
      for (const move of moves) moveEditorPaths(owners, move)
    },
    restore: (paths) => markEditorPaths(owners, paths, false),
    vanish: (paths) => markEditorPaths(owners, paths, true),
  }
}

export async function runFileOperation(
  runtime: FileOperationRuntime,
  {
    announce = false,
    label,
    legs,
    patch,
    rendersError,
  }: {
    /** Offer an Undo toast, for changes that happen away from where the user is looking. */
    readonly announce?: boolean
    readonly label: string
    readonly legs: readonly FileOperationLeg[]
    readonly patch: TreePatch
    readonly rendersError?: (error: unknown) => boolean
  },
) {
  let landed: WorkspaceEditResult | null = null
  const outcome = await runTreeIntent({
    patch,
    queryClient: runtime.queryClient,
    // Scoped with undo and redo, so a Ctrl+Z pressed mid-operation queues behind it.
    perform: () =>
      runMutation(
        runtime.queryClient,
        {
          mutationKey: workspaceMutationKeys.fileOperation(runtime.rootPath),
          scope: { id: fileHistoryScope(runtime.rootPath) },
          mutationFn: async () => {
            try {
              landed = await runtime.workspaceEdits.applyFileOperation(
                label,
                legs,
                runtime.documents,
              )
              return landed
            } finally {
              await invalidateFileHistory(runtime)
            }
          },
        },
        undefined,
      ),
    context: () => ({ label, legCount: legs.length, operationId: landed?.operationId ?? null }),
    rendersError,
  })
  if (outcome.ok && announce) announceOperation(runtime, label, outcome.result.operationId)
  return outcome
}

/**
 * Reverses the head of the shared history. With `operationId`, only that operation: a toast's
 * Undo must never reach past a newer change to an older one.
 */
export async function reverseLatestFileOperation(
  runtime: FileOperationRuntime,
  direction: 'redo' | 'undo',
  operationId?: string,
): Promise<boolean> {
  try {
    const entry = await runMutation(
      runtime.queryClient,
      {
        mutationKey: workspaceMutationKeys.fileHistory(direction, runtime.rootPath),
        scope: { id: fileHistoryScope(runtime.rootPath) },
        mutationFn: () => reverseHead(runtime, direction, operationId),
      },
      undefined,
    )
    if (!entry) return false
    announceReversal(runtime, entry, direction)
    return true
  } catch (error) {
    const clientError = toClientError(error)
    reportError(clientError)
    if (clientError.code === 'workspace-edit-recovery-required') {
      void runtime.workspaceEdits.discoverRecovery()
    }
    return false
  }
}

async function reverseHead(
  runtime: FileOperationRuntime,
  direction: 'redo' | 'undo',
  operationId: string | undefined,
): Promise<WorkspaceEditHistoryEntry | null> {
  try {
    const history = await readHistory(runtime)
    const [source, reversed] =
      direction === 'undo' ? [history.undo, history.redo] : [history.redo, history.undo]
    const entry = source[0]
    // A toast can outlive its operation: another window reversed it, or a later edit evicted it.
    if (operationId && entry?.operationId !== operationId) {
      if (reversed.some((candidate) => candidate.operationId === operationId)) return null
      throw staleToastError(source, operationId, direction)
    }
    if (!entry) return null
    await runtime.workspaceEdits.reverseFileOperation(entry, direction, runtime.documents)
    log.info({
      action: 'file-operation.reverse',
      area: 'file-tree',
      direction,
      label: entry.label,
      operationId: entry.operationId,
    })
    return entry
  } finally {
    invalidateTreeQueries(runtime.queryClient)
    await invalidateFileHistory(runtime)
  }
}

/** An event-driven invalidation cancels a read in flight; join the fresher one it started. */
async function readHistory(runtime: FileOperationRuntime) {
  const query = fileOperationHistoryQuery(runtime.queryClient, runtime.rootPath)
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await runtime.queryClient.fetchQuery(query)
    } catch (error) {
      if (!isCancelledError(error) || attempt === 3) throw error
    }
  }
}

function announceOperation(runtime: FileOperationRuntime, label: string, operationId: string) {
  toast(label, {
    action: {
      label: 'Undo',
      onClick: () => void reverseLatestFileOperation(runtime, 'undo', operationId),
    },
    id: `file-operation:${operationId}`,
  })
}

function announceReversal(
  runtime: FileOperationRuntime,
  entry: WorkspaceEditHistoryEntry,
  direction: 'redo' | 'undo',
) {
  const opposite = direction === 'undo' ? 'redo' : 'undo'
  toast(`${direction === 'undo' ? 'Undid' : 'Redid'} ${entry.label}`, {
    action: {
      label: direction === 'undo' ? 'Redo' : 'Undo',
      onClick: () => void reverseLatestFileOperation(runtime, opposite, entry.operationId),
    },
    id: `file-operation:${entry.operationId}`,
  })
}

function invalidateFileHistory(runtime: FileOperationRuntime) {
  return runtime.queryClient.invalidateQueries({
    queryKey: fileSystemKeys.fileOperationHistory(runtime.rootPath),
  })
}

function moveEditorPaths(owners: DocumentOwners, move: DocumentMove) {
  const workspace = owners.workspaceStore.getState()
  const renames = editorPathRenames(
    [
      ...filePathsForTabs([
        ...workspace.openTabContents,
        ...workspace.editorHistory,
        ...workspace.recentlyClosedTabs,
      ]),
      ...liveDocumentPaths(owners.documentStore),
    ],
    move.from,
    move.to,
  )
  for (const rename of renames) {
    const queryKey = fileSystemKeys.fileSnapshot(rename.from)
    const file = owners.queryClient.getQueryData<FileResult>(queryKey)
    if (file) {
      setFileSnapshotQueryData(owners.queryClient, { ...file, path: filesystemPath(rename.to) })
    }
    owners.renameLiveEditorDocument(filesystemPath(rename.from), filesystemPath(rename.to))
    owners.queryClient.removeQueries({ exact: true, queryKey })
  }
}

/** Sets the orphaned mark to match the disk and refetches, so every view sees the change. */
function markEditorPaths(
  owners: DocumentOwners,
  paths: readonly FilesystemPath[],
  orphaned: boolean,
) {
  if (paths.length === 0) return
  const documents = owners.documentStore.getState()
  for (const document of Object.values(documents.liveDocumentsByKey)) {
    const resource = filesystemResource(document.target)
    if (!resource || !paths.some((path) => isSameOrInside(resource.path, path))) continue
    if (document.sync.kind === 'file' && document.sync.orphaned !== orphaned) {
      documents.setFileOrphaned(document.key, orphaned)
    }
    void owners.queryClient.invalidateQueries({
      exact: true,
      queryKey: fileSystemKeys.fileSnapshot(resource.path),
    })
  }
}

function liveDocumentPaths(documentStore: EditorDocumentStoreApi): FilesystemPath[] {
  return Object.values(documentStore.getState().liveDocumentsByKey).flatMap((document) => {
    const resource = filesystemResource(document.target)
    return resource ? [resource.path] : []
  })
}

function staleToastError(
  source: readonly WorkspaceEditHistoryEntry[],
  operationId: string,
  direction: 'redo' | 'undo',
) {
  const head = source[0]
  const queued = source.some((candidate) => candidate.operationId === operationId)
  if (head && queued) return newerOperationError(head, direction)

  return createClientError({
    code: 'file-operation-unavailable',
    fix: 'Nothing to do: the files are as they are now.',
    internal: { direction, operationId },
    message: `This operation can no longer be ${direction === 'undo' ? 'undone' : 'redone'}`,
    status: 409,
    why: 'A later change touched the same files, or the undo history expired.',
  })
}

function newerOperationError(entry: WorkspaceEditHistoryEntry, direction: 'redo' | 'undo') {
  return createClientError({
    code: 'file-operation-not-head',
    fix: `Press ${direction === 'undo' ? 'Ctrl+Z' : 'Ctrl+Shift+Z'} in the file tree to ${direction} "${entry.label}" first.`,
    internal: { headOperationId: entry.operationId },
    message: `"${entry.label}" is newer and has to be ${direction === 'undo' ? 'undone' : 'redone'} first`,
    status: 409,
    why: 'File operations reverse newest first, so an older one never runs under a newer change.',
  })
}
