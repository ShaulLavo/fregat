import { useUnavailableEnvironment } from '@/lib/environments/hooks/use-unavailable-environment'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import type { FileTreeRenameEvent } from '@workspace/tree'
import type { FileTreeModel } from '@workspace/tree'
import { useIsMutating, useQueryClient } from '@tanstack/react-query'
import { useRef, useState, type RefObject } from 'react'

import { useWorkspaceMutationAllowed } from '@/features/editor/hooks/use-workspace-mutation-allowed'
import { useEditorCommands } from '@/features/editor/hooks/use-editor-commands'
import { useEditorDocumentStoreApi } from '@/features/editor/state/document-state'
import { useEditorWorkspaceStoreApi } from '@/features/editor/state/workspace-state'
import { useOptionalWorkspaceEditService } from '@/features/editor/providers/workspace-edit-context'
import type { FileOperationLeg } from '@/features/editor/state/workspace-edit-service'
import {
  containerContentsLoaded,
  duplicateTreePath,
  newEntryTreePath,
  workspacePathForTreePath,
} from '@/features/workspace/utils/entry-paths'
import { expandTreeDirectory } from '@/features/workspace/utils/tree-pane-state'
import {
  fileOperationDocuments,
  runFileOperation,
  type FileOperationRuntime,
} from '@/features/workspace/state/file-operations'
import { runTreeIntent } from '@/features/workspace/state/tree-intents'
import {
  createLabel,
  deleteLabel,
  duplicateLabel,
  moveLabel,
} from '@/features/workspace/utils/file-operation-labels'
import { workspaceMutationKeys } from '@/features/workspace/utils/mutation-keys'
import { clientErrorMessage, toClientError } from '@/lib/client-error-taxonomy'
import { isDirectoryEntry } from '@/lib/file-system-types'
import { fileSystemKeys } from '@/lib/query-keys'
import { deletePath } from '@/lib/file-server'
import { canonicalTreePath, toTreePath } from '@/lib/path-formatters'
import type { TreeModel, TreePathMove } from '@/lib/tree-model'

export type DeleteTarget = {
  readonly isDirectory: boolean
  readonly name: string
  /** Server path. Already resolved, so the dialog can show what will be removed. */
  readonly path: FilesystemPath
}

/**
 * The domain actions the row menu invokes. Everything is expressed in tree
 * paths because that is what the menu has; the server path is derived here.
 */
export type TreeFsActions = {
  readonly mutationsEnabled: boolean
  readonly createEntry: (containerPath: string, isFolder: boolean) => void
  readonly duplicateEntry: (treePath: string, isDirectory: boolean) => void
  readonly moveEntries: (moves: readonly TreePathMove[]) => void
  readonly renameEntry: (rowPath: string) => void
  readonly requestDelete: (target: DeleteTarget) => void
}

type DeferredCreate = { containerPath: string; isFolder: boolean }

/**
 * Owns every filesystem mutation the file tree can start, plus the delete
 * confirmation the menu cannot host itself — the menu unmounts the moment it
 * closes, so the dialog has to outlive it here.
 *
 * Each mutation is one journaled operation: the projected tree shows it at once, open
 * documents follow it, and Ctrl+Z in the tree reverses it.
 */
export function useFsActions({
  modelRef,
  rootPath,
  treeRef,
}: {
  modelRef: RefObject<TreeModel>
  rootPath: FilesystemPath
  treeRef: RefObject<FileTreeModel | null>
}) {
  const queryClient = useQueryClient()
  const unavailable = useUnavailableEnvironment()
  const workspaceMutationAllowed = useWorkspaceMutationAllowed()
  const workspaceEdits = useOptionalWorkspaceEditService()
  const mutationsEnabled =
    !unavailable &&
    workspaceMutationAllowed &&
    workspaceEdits !== null &&
    Boolean(queryClient.getQueryData(fileSystemKeys.tree(rootPath)))
  const documentStore = useEditorDocumentStoreApi()
  const workspaceStore = useEditorWorkspaceStoreApi()
  const { renameLiveEditorDocument } = useEditorCommands()
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  // Set once the journal has refused to keep this delete for undo.
  const [deletePermanently, setDeletePermanently] = useState(false)
  const deleting =
    useIsMutating({ mutationKey: workspaceMutationKeys.tree('delete', rootPath) }) > 0
  // Set while an inline edit is creating rather than renaming, so the commit
  // handler knows to write a new entry instead of moving an existing one.
  const pendingCreatePathRef = useRef<string | null>(null)
  // Set while a create is waiting on its target directory to finish loading.
  const deferredCreateRef = useRef<DeferredCreate | null>(null)

  function fileOperations(): FileOperationRuntime | null {
    if (!workspaceEdits) return null
    return {
      documents: fileOperationDocuments({
        documentStore,
        queryClient,
        renameLiveEditorDocument,
        workspaceStore,
      }),
      queryClient,
      rootPath,
      workspaceEdits,
    }
  }

  function createEntry(containerPath: string, isFolder: boolean) {
    if (!mutationsEnabled) return
    const tree = treeRef.current
    if (!tree) return
    if (containerContentsLoaded(modelRef.current.loadedDirectoryPaths, containerPath)) {
      startInlineCreate(tree, containerPath, isFolder)
      return
    }

    // Right-clicking a collapsed directory is the common way in, and its
    // children are still on the wire. Expand to kick the load off and let
    // `resumeDeferredCreate` start the edit once they have landed.
    deferredCreateRef.current = { containerPath, isFolder }
    expandTreeDirectory(tree, containerPath)
  }

  /** Called by the pane after each model sync, once per settled tree. */
  function resumeDeferredCreate() {
    const request = deferredCreateRef.current
    const tree = treeRef.current
    if (!request || !tree) return
    if (!containerContentsLoaded(modelRef.current.loadedDirectoryPaths, request.containerPath)) {
      return
    }

    deferredCreateRef.current = null
    startInlineCreate(tree, request.containerPath, request.isFolder)
  }

  function startInlineCreate(tree: FileTreeModel, containerPath: string, isFolder: boolean) {
    const placeholderPath = newEntryTreePath({
      containerPath,
      existingPaths: modelRef.current.entriesByTreePath,
      isFolder,
    })
    tree.add(placeholderPath)
    pendingCreatePathRef.current = canonicalTreePath(placeholderPath)
    tree.startRenaming(placeholderPath, { removeIfCanceled: true })
  }

  function createOnDisk(treePath: string, isFolder: boolean) {
    const runtime = fileOperations()
    if (!runtime) return
    const path = workspacePathForTreePath(rootPath, treePath)
    void runFileOperation(runtime, {
      label: createLabel(path, isFolder),
      legs: [{ folder: isFolder, kind: 'create', path }],
      patch: { kind: 'create', rootPath, treePath, isFolder },
    })
  }

  function moveEntries(moves: readonly TreePathMove[], announce = true) {
    const runtime = fileOperations()
    if (!runtime || moves.length === 0) return
    const legs = moves.map((move) => moveLeg(move, modelRef.current, rootPath))
    void runFileOperation(runtime, {
      announce,
      label: moveLabel(
        legs.map((leg) => ({ from: leg.from, to: leg.to })),
        rootPath,
      ),
      legs,
      patch: { kind: 'move', rootPath, moves },
    })
  }

  function duplicateEntry(treePath: string, isDirectory: boolean) {
    const runtime = fileOperations()
    if (!mutationsEnabled || !runtime) return
    const from = canonicalTreePath(treePath)
    const to = duplicateTreePath({
      existingPaths: modelRef.current.entriesByTreePath,
      isDirectory,
      treePath,
    })
    const fromPath = workspacePathForTreePath(rootPath, from)
    void runFileOperation(runtime, {
      label: duplicateLabel(fromPath),
      legs: [
        {
          from: fromPath,
          kind: 'copy',
          to: workspacePathForTreePath(rootPath, to),
          type: isDirectory ? 'directory' : 'file',
        },
      ],
      patch: { kind: 'duplicate', rootPath, from, to, isFolder: isDirectory },
    })
  }

  /** Wired into `useFileTree`'s `renaming.onRename`; paths carry no trailing slash. */
  function completeRename(event: FileTreeRenameEvent) {
    if (!mutationsEnabled) return
    const pendingCreatePath = pendingCreatePathRef.current
    pendingCreatePathRef.current = null
    if (pendingCreatePath === event.sourcePath) {
      createOnDisk(event.destinationPath, event.isFolder)
      return
    }

    // An inline rename happens where the user is looking; only a drag needs the toast.
    moveEntries([{ fromTreePath: event.sourcePath, toTreePath: event.destinationPath }], false)
  }

  function closeDeleteDialog() {
    setDeleteError(null)
    setDeletePermanently(false)
    setDeleteTarget(null)
  }

  async function deleteJournaled(target: DeleteTarget, runtime: FileOperationRuntime) {
    const outcome = await runFileOperation(runtime, {
      announce: true,
      label: deleteLabel(target.path),
      legs: [
        { kind: 'delete', path: target.path, type: target.isDirectory ? 'directory' : 'file' },
      ],
      patch: { kind: 'delete', rootPath, treePath: toTreePath(target.path, rootPath) },
      rendersError: isQuotaError,
    })
    if (outcome.ok || outcome.reason !== 'transport') {
      closeDeleteDialog()
      return
    }
    if (isQuotaError(outcome.error)) {
      setDeletePermanently(true)
      return
    }
    setDeleteError(clientErrorMessage(outcome.error))
  }

  /** Only after the dialog has said so: the journal cannot hold this delete. */
  async function deleteForever(target: DeleteTarget) {
    const outcome = await runTreeIntent({
      patch: { kind: 'delete', rootPath, treePath: toTreePath(target.path, rootPath) },
      queryClient,
      perform: () => {
        const remove = () =>
          deletePath(target.path, target.isDirectory, clientForQueryClient(queryClient))
        if (!workspaceEdits) return remove()
        return workspaceEdits.runWorkspaceMutation([target.path], remove)
      },
    })
    if (outcome.ok || outcome.reason !== 'transport') {
      closeDeleteDialog()
      return
    }
    setDeleteError(clientErrorMessage(outcome.error))
  }

  function confirmDelete() {
    const target = deleteTarget
    const runtime = fileOperations()
    if (!target || !mutationsEnabled || !runtime) return

    if (deletePermanently) {
      void deleteForever(target)
      return
    }
    void deleteJournaled(target, runtime)
  }

  const actions: TreeFsActions = {
    createEntry,
    duplicateEntry,
    moveEntries: (moves) => {
      if (mutationsEnabled) moveEntries(moves)
    },
    mutationsEnabled,
    renameEntry: (rowPath) => {
      if (!mutationsEnabled) return
      treeRef.current?.startRenaming(rowPath)
    },
    requestDelete: (target) => {
      if (!mutationsEnabled) return
      setDeleteError(null)
      setDeletePermanently(false)
      setDeleteTarget(target)
    },
  }

  return {
    actions,
    completeRename,
    resumeDeferredCreate,
    deleteDialog: {
      deleting,
      mutationsEnabled,
      error: deleteError,
      onCancel: closeDeleteDialog,
      onConfirm: confirmDelete,
      permanent: deletePermanently,
      target: deleteTarget,
    },
  }
}

function moveLeg(
  move: TreePathMove,
  model: TreeModel,
  rootPath: FilesystemPath,
): Extract<FileOperationLeg, { kind: 'rename' }> {
  const entry = model.entriesByTreePath.get(canonicalTreePath(move.fromTreePath))
  return {
    from: workspacePathForTreePath(rootPath, move.fromTreePath),
    kind: 'rename',
    to: workspacePathForTreePath(rootPath, move.toTreePath),
    type: entry && isDirectoryEntry(entry) ? 'directory' : 'file',
  }
}

function isQuotaError(error: unknown) {
  return toClientError(error).code === 'WORKSPACE_EDIT_QUOTA'
}
