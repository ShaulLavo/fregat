import { filePathsForTabs, filesystemResource } from '@/lib/documents/utils/capabilities'
import { filesystemPath } from '@/lib/documents/utils/identity'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import type { Client } from '@/lib/client'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import type { FileTreeRenameEvent } from '@workspace/tree'
import type { FileTreeModel } from '@workspace/tree'
import { useQueryClient } from '@tanstack/react-query'
import { useRef, useState, useTransition, type RefObject } from 'react'

import { useWorkspaceMutationAllowed } from '@/features/editor/hooks/use-workspace-mutation-allowed'
import { useEditorCommands } from '@/features/editor/hooks/use-editor-commands'
import { useEditorDocumentStoreApi } from '@/features/editor/state/document-state'
import { useEditorWorkspaceStoreApi } from '@/features/editor/state/workspace-state'
import { useOptionalWorkspaceEditService } from '@/features/editor/providers/workspace-edit-context'
import {
  containerContentsLoaded,
  duplicateTreePath,
  newEntryTreePath,
  workspacePathForTreePath,
} from '@/features/workspace/utils/entry-paths'
import { editorPathRenames } from '@/features/workspace/utils/editor-path-renames'
import { expandTreeDirectory } from '@/features/workspace/utils/tree-pane-state'
import { runTreeIntent } from '@/features/workspace/state/tree-intents'
import { setFileSnapshotQueryData } from '@/lib/file-snapshot-query-cache'
import type { FileResult } from '@/lib/file-system-types'
import { fileSystemKeys } from '@/lib/query-keys'
import {
  copyPath,
  createFileContent,
  deletePath,
  ensureFolderPath,
  errorMessage,
  renamePath,
} from '@/lib/file-server'
import { canonicalTreePath, toTreePath } from '@/lib/path-formatters'
import type { TreeModel } from '@/lib/tree-model'

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
  readonly renameEntry: (rowPath: string) => void
  readonly requestDelete: (target: DeleteTarget) => void
}

type DeferredCreate = { containerPath: string; isFolder: boolean }

/**
 * Owns every filesystem mutation the file tree can start, plus the delete
 * confirmation the menu cannot host itself — the menu unmounts the moment it
 * closes, so the dialog has to outlive it here.
 *
 * Each mutation is an intent: the projected tree shows it at once, and it
 * disappears from the projection on its own if the server refuses. Nothing
 * here corrects the tree by hand.
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
  const mutationsEnabled = useWorkspaceMutationAllowed()
  const workspaceEdits = useOptionalWorkspaceEditService()
  const documentStore = useEditorDocumentStoreApi()
  const workspaceStore = useEditorWorkspaceStoreApi()
  const { renameLiveEditorDocument } = useEditorCommands()
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleting, startDelete] = useTransition()
  // Set while an inline edit is creating rather than renaming, so the commit
  // handler knows to write a new entry instead of moving an existing one.
  const pendingCreatePathRef = useRef<string | null>(null)
  // Set while a create is waiting on its target directory to finish loading.
  const deferredCreateRef = useRef<DeferredCreate | null>(null)
  const client = () => clientForQueryClient(queryClient)

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

  function runWorkspaceMutation<T>(
    affectedPaths: readonly FilesystemPath[] | 'all',
    operation: () => Promise<T>,
  ) {
    if (!workspaceEdits) return operation()
    return workspaceEdits.runWorkspaceMutation(affectedPaths, operation)
  }

  function renameEditorPaths(from: FilesystemPath, to: FilesystemPath) {
    const workspace = workspaceStore.getState()
    const renames = editorPathRenames(
      [
        ...filePathsForTabs([
          ...workspace.openTabContents,
          ...workspace.editorHistory,
          ...workspace.recentlyClosedTabs,
        ]),
        ...Object.values(documentStore.getState().liveDocumentsByKey).flatMap((document) => {
          const resource = filesystemResource(document.target)
          return resource ? [resource.path] : []
        }),
      ],
      from,
      to,
    )
    for (const rename of renames) {
      const queryKey = fileSystemKeys.fileSnapshot(rename.from)
      const file = queryClient.getQueryData<FileResult>(queryKey)
      if (file) setFileSnapshotQueryData(queryClient, { ...file, path: filesystemPath(rename.to) })
      renameLiveEditorDocument(filesystemPath(rename.from), filesystemPath(rename.to))
      queryClient.removeQueries({ exact: true, queryKey })
    }
    return renames
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
    const path = workspacePathForTreePath(rootPath, treePath)
    void runTreeIntent({
      patch: { kind: 'create', rootPath, treePath, isFolder },
      queryClient,
      perform: () =>
        runWorkspaceMutation([path], () => createEntryOnDisk(path, isFolder, client())),
    })
  }

  function renameOnDisk(from: string, to: string, isFolder: boolean) {
    const fromPath = workspacePathForTreePath(rootPath, from)
    const toPath = workspacePathForTreePath(rootPath, to)
    let renamedEditorPathCount = 0
    void runTreeIntent({
      patch: { kind: 'move', rootPath, moves: [{ fromTreePath: from, toTreePath: to }] },
      queryClient,
      perform: async () => {
        const affectedPaths = isFolder ? 'all' : [fromPath, toPath]
        const entry = await runWorkspaceMutation(affectedPaths, () =>
          renamePath(fromPath, toPath, client()),
        )
        renamedEditorPathCount = renameEditorPaths(fromPath, toPath).length
        return entry
      },
      context: () => ({ from: fromPath, path: toPath, isFolder, renamedEditorPathCount }),
    })
  }

  function duplicateEntry(treePath: string, isDirectory: boolean) {
    if (!mutationsEnabled) return
    const from = canonicalTreePath(treePath)
    const to = duplicateTreePath({
      existingPaths: modelRef.current.entriesByTreePath,
      isDirectory,
      treePath,
    })
    const fromPath = workspacePathForTreePath(rootPath, from)
    const toPath = workspacePathForTreePath(rootPath, to)
    void runTreeIntent({
      patch: { kind: 'duplicate', rootPath, from, to, isFolder: isDirectory },
      queryClient,
      perform: () =>
        runWorkspaceMutation(isDirectory ? 'all' : [toPath], () =>
          copyPath(fromPath, toPath, client()),
        ),
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

    renameOnDisk(event.sourcePath, event.destinationPath, event.isFolder)
  }

  function confirmDelete() {
    const target = deleteTarget
    if (!target || !mutationsEnabled) return

    startDelete(async () => {
      const outcome = await runTreeIntent({
        patch: { kind: 'delete', rootPath, treePath: toTreePath(target.path, rootPath) },
        queryClient,
        perform: () =>
          runWorkspaceMutation(target.isDirectory ? 'all' : [target.path], () =>
            deletePath(target.path, target.isDirectory, client()),
          ),
      })
      if (outcome.ok || outcome.reason !== 'transport') {
        setDeleteError(null)
        setDeleteTarget(null)
        return
      }
      setDeleteError(errorMessage(outcome.error))
    })
  }

  const actions: TreeFsActions = {
    createEntry,
    duplicateEntry,
    mutationsEnabled,
    renameEntry: (rowPath) => {
      if (!mutationsEnabled) return
      treeRef.current?.startRenaming(rowPath)
    },
    requestDelete: (target) => {
      if (!mutationsEnabled) return
      setDeleteError(null)
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
      onCancel: () => setDeleteTarget(null),
      onConfirm: confirmDelete,
      target: deleteTarget,
    },
  }
}

function createEntryOnDisk(path: FilesystemPath, isFolder: boolean, client: Client) {
  if (isFolder) return ensureFolderPath(path, client)

  return createFileContent(path, '', client)
}
