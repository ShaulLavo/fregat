import { log } from '@/lib/client-logging'
import { parentFilesystemPath } from '@/lib/path-formatters'
import { supportsTextFile } from '@/features/editor/state/workspace-document-service'
import { FilesystemConflictToast } from '@/features/editor/components/filesystem-conflict-toast'
import {
  conflictId,
  documentKey,
  fileDocument,
  fileDocumentKey,
  fileResource,
  filesystemPath,
} from '@/lib/documents/utils/identity'
import { documentTab } from '@/lib/documents/utils/tabs'
import type {
  DocumentKey,
  DocumentRef,
  FilesystemPath,
  TabContent,
} from '@/lib/documents/utils/types'
import type {
  EditorConflictStoreApi,
  FilesystemConflict,
} from '@/features/editor/state/conflict-state'
import type {
  LiveEditorDocument,
  UnsyncedLiveEditorDocumentInput,
} from '@/features/editor/state/document-state'
import { conflictResolutionMutationOptions } from '@/features/workspace/utils/conflict-resolution-mutation'
import { runMutation } from '@/lib/mutations/run'
import {
  moveFileSnapshotQueryData,
  setFileSnapshotQueryData,
} from '@/lib/file-snapshot-query-cache'
import { createFileContent, ensureFolderPath, writeFileContent } from '@/lib/file-server'
import type { FileResult } from '@/lib/file-system-types'
import { fileSystemKeys } from '@/lib/query-keys'
import type { Client } from '@/lib/client'
import { createMergeConflictDocumentText } from '@singapore-editor/core/editor'
import type { QueryClient } from '@tanstack/react-query'
import { createElement } from 'react'
import { toast } from 'sonner'

export type WorkspaceConflictContext = {
  client: Client
  conflictStore: EditorConflictStoreApi
  discardLiveEditorDocument: (document: DocumentRef) => { wasDirty: boolean }
  ensureUnsyncedEditorDocument: (input: UnsyncedLiveEditorDocumentInput) => void
  fetchFile: (path: FilesystemPath, signal: AbortSignal) => Promise<FileResult>
  forceReplaceLiveEditorDocument: (file: FileResult) => { wasDirty: boolean }
  getLiveEditorDocument: (key: DocumentKey) => LiveEditorDocument | null
  queryClient: QueryClient
  renameLiveEditorDocument: (from: FilesystemPath, to: FilesystemPath) => { wasDirty: boolean }
  setFileOrphaned: (key: DocumentKey, orphaned: boolean) => boolean
  selectContent: (content: TabContent) => void
}

let nextConflictId = 0

export function notifyChangedFilesystemConflict(
  path: FilesystemPath,
  remoteFile: FileResult,
  context: WorkspaceConflictContext,
) {
  notifyFilesystemConflict(changedConflict(path, remoteFile, context), context)
}

export function markDeletedFilesystemDocument(
  path: FilesystemPath,
  context: WorkspaceConflictContext,
) {
  context.setFileOrphaned(fileDocumentKey(path), true)
  const conflict = Object.values(context.conflictStore.getState().conflicts).find(
    (entry) => entry.remotePath === path,
  )
  if (!conflict) return
  notifyFilesystemConflict(
    {
      ...conflict,
      eventType: 'deleted',
      localText: localConflictText(conflict.localPath, context),
      remoteFile: null,
      remoteText: null,
    },
    context,
  )
}

export async function notifyRenamedFilesystemConflict(
  localPath: FilesystemPath,
  remotePath: FilesystemPath,
  context: WorkspaceConflictContext,
) {
  const remoteFile = await context.fetchFile(remotePath, new AbortController().signal)
  notifyFilesystemConflict(
    {
      eventType: 'renamed',
      id: createConflictId(),
      localPath,
      localText: localConflictText(localPath, context),
      remoteFile,
      remotePath,
      remoteText: supportsTextFile(remoteFile) ? remoteFile.content : null,
    },
    context,
  )
}

export function dismissFilesystemConflicts(conflictStore: EditorConflictStoreApi) {
  for (const conflict of Object.values(conflictStore.getState().conflicts)) {
    if (conflict.toastId) toast.dismiss(conflict.toastId)
  }

  conflictStore.getState().clearConflicts()
}

function changedConflict(
  path: FilesystemPath,
  remoteFile: FileResult,
  context: WorkspaceConflictContext,
): FilesystemConflict {
  return {
    eventType: 'changed',
    id: createConflictId(),
    localPath: path,
    localText: localConflictText(path, context),
    remoteFile,
    remotePath: path,
    remoteText: supportsTextFile(remoteFile) ? remoteFile.content : null,
  }
}

function notifyFilesystemConflict(conflict: FilesystemConflict, context: WorkspaceConflictContext) {
  const current = matchingConflict(conflict, context)
  const next = current ? refreshedConflict(current, conflict) : conflict
  context.conflictStore.getState().addConflict(next)

  const toastId = toast(
    () =>
      createElement(FilesystemConflictToast, {
        conflict: next,
        onOpenDiff: () => openConflictDiff(next.id, context),
        onOverrideLocal: () => void resolveConflict(next.id, 'local', context),
        onOverrideRemote: () => void resolveConflict(next.id, 'remote', context),
        queryClient: context.queryClient,
      }),
    { id: current?.toastId, duration: Infinity },
  )
  context.conflictStore.getState().updateConflict(next.id, { toastId })
  log.info({
    action: 'conflict.notify',
    area: 'fs',
    conflictId: next.id,
    eventType: next.eventType,
    path: next.remotePath,
    refreshed: current !== undefined,
    toastId: String(toastId),
  })
}

function matchingConflict(conflict: FilesystemConflict, context: WorkspaceConflictContext) {
  const conflicts = Object.values(context.conflictStore.getState().conflicts)
  return conflicts.find(
    (current) =>
      current.localPath === conflict.localPath && current.remotePath === conflict.remotePath,
  )
}

function refreshedConflict(
  current: FilesystemConflict,
  next: FilesystemConflict,
): FilesystemConflict {
  return {
    ...next,
    diffDocumentKey: current.diffDocumentKey,
    id: current.id,
    toastId: current.toastId,
  }
}

function openConflictDiff(id: string, context: WorkspaceConflictContext) {
  const conflict = context.conflictStore.getState().conflicts[id]
  if (!conflict) return
  if (conflict.remoteFile && !supportsTextFile(conflict.remoteFile)) {
    setFileSnapshotQueryData(context.queryClient, conflict.remoteFile)
    context.selectContent(documentTab(fileDocument(fileResource(conflict.remotePath))))
    return
  }

  const target = {
    kind: 'conflict',
    conflictId: conflictId(id),
    path: conflict.remotePath,
  } as const
  const key = documentKey(target)
  ensureConflictEditorDocument(target, conflict, context)
  context.conflictStore.getState().updateConflict(id, { diffDocumentKey: key })
  context.selectContent(documentTab(target))
}

function ensureConflictEditorDocument(
  target: Extract<DocumentRef, { kind: 'conflict' }>,
  conflict: FilesystemConflict,
  context: WorkspaceConflictContext,
) {
  if (context.getLiveEditorDocument(documentKey(target))) return
  const content = createMergeConflictDocumentText(conflict)
  context.ensureUnsyncedEditorDocument({ content, target })
}

function resolveConflict(
  id: string,
  resolution: 'local' | 'remote',
  context: WorkspaceConflictContext,
): Promise<void> {
  return runMutation(
    context.queryClient,
    conflictResolutionMutationOptions(id, () => applyResolvedConflict(id, resolution, context)),
    resolution,
  ).catch(() => undefined)
}

async function applyResolvedConflict(
  id: string,
  resolution: 'local' | 'remote',
  context: WorkspaceConflictContext,
) {
  const conflict = context.conflictStore.getState().conflicts[id]
  if (!conflict) return

  const isCurrent = captureConflictCompletion(conflict, context)
  const isResolutionCurrent = conflict.diffDocumentKey
    ? captureLiveDocument(conflict.diffDocumentKey, context)
    : () => true
  const file =
    resolution === 'local' ? await applyLocalConflict(conflict, context) : conflict.remoteFile
  const canComplete =
    isCurrent() && (!file || adoptFilesystemSnapshot(conflict.localPath, file, context))
  if (!canComplete) {
    await context.queryClient.invalidateQueries({
      exact: true,
      queryKey: fileSystemKeys.fileSnapshot(conflict.remotePath),
    })
    return
  }
  if (!file) discardResolvedEditorFile(conflict.localPath, context)
  finishConflict(conflict, isResolutionCurrent, context)
}

function captureConflictCompletion(
  conflict: FilesystemConflict,
  context: WorkspaceConflictContext,
) {
  const keys = [fileDocumentKey(conflict.localPath), fileDocumentKey(conflict.remotePath)]
  if (conflict.diffDocumentKey) keys.push(conflict.diffDocumentKey)
  const documentsCurrent = keys.map((key) => captureLiveDocument(key, context))
  return () =>
    context.conflictStore.getState().conflicts[conflict.id] === conflict &&
    documentsCurrent.every((isCurrent) => isCurrent())
}

function captureLiveDocument(key: DocumentKey, context: WorkspaceConflictContext) {
  const document = context.getLiveEditorDocument(key)
  const snapshot = document?.buffer.getSnapshot()
  const revision = document?.buffer.getRevision()
  const dirty = document?.buffer.isDirty()
  return () => {
    const current = context.getLiveEditorDocument(key)
    return (
      current === document &&
      current?.buffer.getSnapshot() === snapshot &&
      current?.buffer.getRevision() === revision &&
      current?.buffer.isDirty() === dirty
    )
  }
}

async function applyLocalConflict(conflict: FilesystemConflict, context: WorkspaceConflictContext) {
  if (conflict.eventType === 'deleted') {
    await restoreDeletedLocalConflict(conflict, context.client)
  } else {
    await writeFileContent(
      conflict.remotePath,
      conflict.localText,
      {
        baseVersion: conflict.remoteFile?.version ?? null,
        expectedMtimeMs: conflict.remoteFile?.mtimeMs ?? null,
        origin: 'conflict-resolution',
      },
      context.client,
    )
  }

  return context.fetchFile(conflict.remotePath, new AbortController().signal)
}

async function restoreDeletedLocalConflict(conflict: FilesystemConflict, client: Client) {
  await ensureFolderPath(parentFilesystemPath(conflict.remotePath, filesystemPath('')), client)
  await createFileContent(conflict.remotePath, conflict.localText, client)
}

export function adoptFilesystemSnapshot(
  localPath: FilesystemPath,
  file: FileResult,
  context: WorkspaceConflictContext,
) {
  if (!supportsTextFile(file)) {
    context.discardLiveEditorDocument(fileDocument(fileResource(localPath)))
    if (localPath !== file.path) {
      context.queryClient.removeQueries({
        exact: true,
        queryKey: fileSystemKeys.fileSnapshot(localPath),
      })
    }
    setFileSnapshotQueryData(context.queryClient, file)
    context.selectContent(documentTab(fileDocument(fileResource(file.path))))
    return true
  }
  if (localPath !== file.path) {
    context.renameLiveEditorDocument(localPath, file.path)
  }

  const isDestinationCurrent = captureLiveDocument(fileDocumentKey(file.path), context)
  if (localPath !== file.path) moveFileSnapshotQueryData(context.queryClient, localPath, file.path)
  setFileSnapshotQueryData(context.queryClient, file)
  if (!isDestinationCurrent()) return false
  context.forceReplaceLiveEditorDocument(file)
  return true
}

function discardResolvedEditorFile(path: FilesystemPath, context: WorkspaceConflictContext) {
  context.discardLiveEditorDocument(fileDocument(fileResource(path)))
  context.queryClient.removeQueries({
    exact: true,
    queryKey: fileSystemKeys.fileSnapshot(path),
  })
}

function finishConflict(
  conflict: FilesystemConflict,
  isResolutionCurrent: () => boolean,
  context: WorkspaceConflictContext,
) {
  if (context.conflictStore.getState().conflicts[conflict.id] !== conflict) return
  if (!isResolutionCurrent()) return
  if (conflict.diffDocumentKey) {
    context.discardLiveEditorDocument({
      kind: 'conflict',
      conflictId: conflictId(conflict.id),
      path: conflict.remotePath,
    })
  }
  if (context.conflictStore.getState().conflicts[conflict.id] !== conflict) return
  if (conflict.toastId) toast.dismiss(conflict.toastId)

  context.conflictStore.getState().removeConflict(conflict.id)
}

function localConflictText(path: FilesystemPath, context: WorkspaceConflictContext) {
  return context.getLiveEditorDocument(fileDocumentKey(path))?.buffer.materializeFullText() ?? ''
}

function createConflictId() {
  nextConflictId += 1
  return `${Date.now().toString(36)}-${nextConflictId.toString(36)}`
}
