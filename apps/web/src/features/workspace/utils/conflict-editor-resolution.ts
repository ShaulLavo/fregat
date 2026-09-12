import type { RefObject } from 'react'

import { conflictId, filesystemPath } from '@/lib/documents/utils/identity'
import type { DocumentKey, DocumentRef, FilesystemPath } from '@/lib/documents/utils/types'
import type {
  EditorConflictStoreApi,
  FilesystemConflict,
} from '@/features/editor/state/conflict-state'
import { parseMergeConflicts, type TextSnapshot } from '@singapor/core'
import { Debouncer } from '@tanstack/react-pacer/debouncer'
import type { QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { reportError, toClientError } from '@/lib/client-error-taxonomy'
import { setFileSnapshotQueryData } from '@/lib/file-snapshot-query-cache'
import { createFileContent, ensureFolderPath, fetchFile, writeFileContent } from '@/lib/file-server'
import type { FileResult } from '@/lib/file-system-types'
import { fileSystemKeys } from '@/lib/query-keys'

const CONFLICT_RESOLUTION_DEBOUNCE_MS = 250

export function resolveConflictEditorSnapshot(
  conflictDiff: Extract<DocumentRef, { kind: 'conflict' }>,
  textSnapshot: TextSnapshot,
  context: ConflictEditorResolutionContext & {
    resolvingConflictIds: RefObject<Set<string>>
  },
) {
  const text = textSnapshot.materializeFullText()
  if (parseMergeConflicts(text).length > 0) return

  const conflict = context.conflictStore.getState().conflicts[conflictDiff.conflictId]
  if (!conflict) return
  if (context.resolvingConflictIds.current.has(conflict.id)) return

  context.resolvingConflictIds.current.add(conflict.id)
  void applyConflictEditorResolution(conflict, text, context)
    .catch((error: unknown) => {
      reportError(toClientError(error))
    })
    .finally(() => {
      context.resolvingConflictIds.current.delete(conflict.id)
    })
}

export type ConflictResolutionDebouncers = Map<
  DocumentKey,
  Debouncer<(resolve: () => void) => void>
>

export function scheduleConflictResolution(
  debouncers: ConflictResolutionDebouncers,
  key: DocumentKey,
  resolve: () => void,
) {
  const current = debouncers.get(key)
  if (current) {
    current.maybeExecute(resolve)
    return
  }

  const debouncer = new Debouncer((run: () => void) => run(), {
    wait: CONFLICT_RESOLUTION_DEBOUNCE_MS,
  })
  debouncers.set(key, debouncer)
  debouncer.maybeExecute(resolve)
}

export function cancelConflictResolutions(debouncers: ConflictResolutionDebouncers) {
  for (const debouncer of debouncers.values()) {
    debouncer.cancel()
  }

  debouncers.clear()
}

async function applyConflictEditorResolution(
  conflict: FilesystemConflict,
  resolvedText: string,
  context: ConflictEditorResolutionContext,
) {
  if (conflict.eventType === 'deleted') {
    await ensureFolderPath(parentPath(conflict.remotePath))
    await createFileContent(conflict.remotePath, resolvedText)
  } else {
    await writeFileContent(conflict.remotePath, resolvedText, {
      baseVersion: conflict.remoteVersion,
      expectedMtimeMs: conflict.remoteMtimeMs,
      origin: 'conflict-editor-resolution',
    })
  }

  const file = await fetchFile(conflict.remotePath, new AbortController().signal)
  replaceResolvedConflictFile(conflict.localPath, file, context)
  finishEditorResolvedConflict(conflict, context)
}

type ConflictEditorResolutionContext = {
  conflictStore: EditorConflictStoreApi
  discardLiveEditorDocument: (document: DocumentRef) => { wasDirty: boolean }
  forceReplaceLiveEditorDocument: (file: FileResult) => { wasDirty: boolean }
  queryClient: QueryClient
  renameLiveEditorDocument: (from: FilesystemPath, to: FilesystemPath) => { wasDirty: boolean }
}

function replaceResolvedConflictFile(
  localPath: FilesystemPath,
  file: FileResult,
  context: ConflictEditorResolutionContext,
) {
  if (localPath !== file.path) {
    context.renameLiveEditorDocument(localPath, file.path)
    moveFileQueryData(context.queryClient, localPath, file.path)
  }

  setFileSnapshotQueryData(context.queryClient, file)
  context.forceReplaceLiveEditorDocument(file)
}

function finishEditorResolvedConflict(
  conflict: FilesystemConflict,
  context: ConflictEditorResolutionContext,
) {
  if (conflict.diffDocumentKey) {
    context.discardLiveEditorDocument({ kind: 'conflict', conflictId: conflictId(conflict.id) })
  }
  if (conflict.toastId) toast.dismiss(conflict.toastId)

  context.conflictStore.getState().removeConflict(conflict.id)
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

function parentPath(path: FilesystemPath) {
  const index = path.lastIndexOf('/')
  if (index < 0) return filesystemPath('')

  return filesystemPath(path.slice(0, index))
}
