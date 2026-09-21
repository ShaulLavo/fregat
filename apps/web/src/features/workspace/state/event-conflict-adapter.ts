import { parentFilesystemPath } from '@/lib/path-formatters'
import { decodedAsText } from '@workspace/contracts'
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
import { setFileSnapshotQueryData } from '@/lib/file-snapshot-query-cache'
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

export function notifyDeletedFilesystemConflict(
  path: FilesystemPath,
  context: WorkspaceConflictContext,
) {
  notifyFilesystemConflict(deletedConflict(path, context), context)
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
      remoteMtimeMs: remoteFile.mtimeMs,
      remotePath,
      remoteSize: remoteFile.size,
      remoteText: remoteFile.content,
      remoteVersion: remoteFile.version,
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
    remoteMtimeMs: remoteFile.mtimeMs,
    remotePath: path,
    remoteSize: remoteFile.size,
    remoteText: remoteFile.content,
    remoteVersion: remoteFile.version,
  }
}

function deletedConflict(
  path: FilesystemPath,
  context: WorkspaceConflictContext,
): FilesystemConflict {
  return {
    eventType: 'deleted',
    id: createConflictId(),
    localPath: path,
    localText: localConflictText(path, context),
    remoteMtimeMs: null,
    remotePath: path,
    remoteSize: null,
    remoteText: null,
    remoteVersion: null,
  }
}

function notifyFilesystemConflict(conflict: FilesystemConflict, context: WorkspaceConflictContext) {
  const current = matchingConflict(conflict, context)
  const next = current ? refreshedConflict(current, conflict) : conflict
  context.conflictStore.getState().addConflict(next)
  if (current?.toastId) return

  const toastId = toast.custom(
    () =>
      createElement(FilesystemConflictToast, {
        conflict: next,
        onOpenDiff: () => openConflictDiff(next.id, context),
        onOverrideLocal: () => void resolveConflict(next.id, 'local', context),
        onOverrideRemote: () => void resolveConflict(next.id, 'remote', context),
        queryClient: context.queryClient,
      }),
    { dismissible: false, duration: Infinity },
  )
  context.conflictStore.getState().updateConflict(next.id, { toastId })
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
    conflictResolutionMutationOptions(id, (source) => applyResolvedConflict(id, source, context)),
    resolution,
  ).catch(() => undefined)
}

async function applyResolvedConflict(
  id: string,
  resolution: 'editor' | 'local' | 'remote',
  context: WorkspaceConflictContext,
) {
  const conflict = context.conflictStore.getState().conflicts[id]
  if (!conflict) return

  if (resolution === 'local') await applyLocalConflict(conflict, context)
  if (resolution === 'remote') await applyRemoteConflict(conflict, context)
  finishConflict(conflict, context)
}

async function applyLocalConflict(conflict: FilesystemConflict, context: WorkspaceConflictContext) {
  if (conflict.eventType === 'deleted') {
    await restoreDeletedLocalConflict(conflict, context.client)
  } else {
    await writeFileContent(
      conflict.remotePath,
      conflict.localText,
      {
        baseVersion: conflict.remoteVersion,
        expectedMtimeMs: conflict.remoteMtimeMs,
        origin: 'conflict-resolution',
      },
      context.client,
    )
  }

  const file = await context.fetchFile(conflict.remotePath, new AbortController().signal)
  replaceResolvedEditorFile(conflict.localPath, file, context)
}

async function restoreDeletedLocalConflict(conflict: FilesystemConflict, client: Client) {
  await ensureFolderPath(parentFilesystemPath(conflict.remotePath, filesystemPath('')), client)
  await createFileContent(conflict.remotePath, conflict.localText, client)
}

async function applyRemoteConflict(
  conflict: FilesystemConflict,
  context: WorkspaceConflictContext,
) {
  if (conflict.remoteText === null) {
    discardResolvedEditorFile(conflict.localPath, context)
    return
  }

  replaceResolvedEditorFile(conflict.localPath, remoteFileResult(conflict), context)
}

function replaceResolvedEditorFile(
  localPath: FilesystemPath,
  file: FileResult,
  context: WorkspaceConflictContext,
) {
  if (localPath !== file.path) {
    context.renameLiveEditorDocument(localPath, file.path)
    moveFileQueryData(context.queryClient, localPath, file.path)
  }

  setFileSnapshotQueryData(context.queryClient, file)
  context.forceReplaceLiveEditorDocument(file)
}

function discardResolvedEditorFile(path: FilesystemPath, context: WorkspaceConflictContext) {
  context.discardLiveEditorDocument(fileDocument(fileResource(path)))
  context.queryClient.removeQueries({
    exact: true,
    queryKey: fileSystemKeys.fileSnapshot(path),
  })
}

function finishConflict(conflict: FilesystemConflict, context: WorkspaceConflictContext) {
  if (conflict.diffDocumentKey) {
    context.discardLiveEditorDocument({
      kind: 'conflict',
      conflictId: conflictId(conflict.id),
      path: conflict.remotePath,
    })
  }
  if (conflict.toastId) toast.dismiss(conflict.toastId)

  context.conflictStore.getState().removeConflict(conflict.id)
}

function remoteFileResult(conflict: FilesystemConflict): FileResult {
  return {
    ...decodedAsText,
    content: conflict.remoteText ?? '',
    mtimeMs: conflict.remoteMtimeMs ?? Date.now(),
    path: conflict.remotePath,
    size: conflict.remoteSize ?? conflict.remoteText?.length ?? 0,
    version:
      conflict.remoteVersion ??
      syntheticFileVersion(conflict.remoteMtimeMs ?? Date.now(), conflict.remoteSize ?? 0),
  }
}

function localConflictText(path: FilesystemPath, context: WorkspaceConflictContext) {
  return context.getLiveEditorDocument(fileDocumentKey(path))?.buffer.materializeFullText() ?? ''
}

function createConflictId() {
  nextConflictId += 1
  return `${Date.now().toString(36)}-${nextConflictId.toString(36)}`
}

function syntheticFileVersion(mtimeMs: number, size: number) {
  return `synthetic:${mtimeMs}:${size}`
}

function moveFileQueryData(queryClient: QueryClient, from: FilesystemPath, to: FilesystemPath) {
  const file = queryClient.getQueryData<FileResult>(fileSystemKeys.fileSnapshot(from))
  queryClient.removeQueries({
    exact: true,
    queryKey: fileSystemKeys.fileSnapshot(from),
  })
  if (!file) return

  setFileSnapshotQueryData(queryClient, { ...file, path: to })
}
