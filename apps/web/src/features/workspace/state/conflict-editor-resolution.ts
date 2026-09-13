import { parseMergeConflicts, type TextSnapshot } from '@singapor/core'
import { decodedAsText } from '@workspace/contracts'
import { Debouncer } from '@tanstack/react-pacer/debouncer'
import type { QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { documentKey, fileDocumentKey, filesystemPath } from '@/lib/documents/utils/identity'
import type { DocumentKey, DocumentRef, FilesystemPath } from '@/lib/documents/utils/types'
import type {
  EditorConflictStoreApi,
  FilesystemConflict,
} from '@/features/editor/state/conflict-state'
import type {
  EditorDocumentStoreApi,
  LiveEditorDocument,
} from '@/features/editor/state/document-state'
import type {
  WorkspaceDocumentTargetStamp,
  WorkspaceDocumentPathReservationRequest,
} from '@/features/editor/state/workspace-document-service'
import type { WorkspaceEditRoot } from '@/features/editor/state/workspace-edit-service'
import { textSnapshotEqualsText } from '@/features/editor/utils/text-snapshot'
import { reportError, toClientError } from '@/lib/client-error-taxonomy'
import { observeClientOperation } from '@/lib/client-logging'
import type { Client } from '@/lib/client'
import { clientLogContext } from '@/lib/environments/state/log-context'
import { setFileSnapshotQueryData } from '@/lib/file-snapshot-query-cache'
import { createFileContent, ensureFolderPath, writeFileContent } from '@/lib/file-server'
import type { FileResult } from '@/lib/file-system-types'
import { fileSystemKeys } from '@/lib/query-keys'

type ConflictTarget = Extract<DocumentRef, { kind: 'conflict' }>
type ResolutionContext = {
  readonly issueWriteId: () => string
  readonly client: Client
  readonly conflictStore: EditorConflictStoreApi
  readonly documentStore: EditorDocumentStoreApi
  readonly queryClient: QueryClient
  readonly getOperationRoot: () => WorkspaceEditRoot | null
  readonly discardLiveEditorDocument: (document: DocumentRef) => { wasDirty: boolean }
  readonly renameLiveEditorDocument: (
    from: FilesystemPath,
    to: FilesystemPath,
  ) => { wasDirty: boolean }
}
type CapturedResolution = {
  readonly conflict: FilesystemConflict
  readonly target: ConflictTarget
  readonly root: WorkspaceEditRoot
  readonly resolution: LiveEditorDocument
  readonly snapshot: ReturnType<LiveEditorDocument['buffer']['getSnapshot']>
  readonly revision: number
  readonly text: string
  readonly destination: WorkspaceDocumentTargetStamp | null
  readonly remoteDestination: WorkspaceDocumentTargetStamp | null
  readonly paths: readonly WorkspaceDocumentPathReservationRequest[]
}
type ResolutionOutcome = 'resolved' | 'retry' | 'stale' | 'unresolved'

export class ConflictEditorResolutionCoordinator {
  private readonly pending = new Map<DocumentKey, Debouncer<() => void>>()
  private readonly resolving = new Set<DocumentKey>()
  private readonly waiting = new Map<DocumentKey, CapturedResolution>()
  private disposed = false

  constructor(private readonly context: ResolutionContext) {}

  connect(): () => void {
    this.disposed = false
    return () => this.dispose()
  }

  readonly schedule = (target: ConflictTarget, textSnapshot: TextSnapshot): void => {
    if (this.disposed) return
    const capture = this.capture(target, textSnapshot)
    if (!capture) return
    const key = documentKey(target)
    this.pending.get(key)?.cancel()
    const debouncer = new Debouncer(
      () => {
        this.pending.delete(key)
        void this.apply(capture)
      },
      { wait: 250 },
    )
    this.pending.set(key, debouncer)
    debouncer.maybeExecute()
  }

  dispose(): void {
    this.disposed = true
    for (const pending of this.pending.values()) pending.cancel()
    this.pending.clear()
    this.waiting.clear()
  }

  private capture(target: ConflictTarget, textSnapshot: TextSnapshot): CapturedResolution | null {
    const { documentStore, conflictStore } = this.context
    const text = textSnapshot.materializeFullText()
    if (parseMergeConflicts(text).length) return null
    const conflict = conflictStore.getState().conflicts[target.conflictId]
    const resolution = documentStore.getState().getLiveEditorDocument(documentKey(target))
    const root = this.context.getOperationRoot()
    if (!conflict || !resolution || !root) return null
    if (!textSnapshotEqualsText(resolution.buffer.getTextSnapshot(), text)) return null
    return {
      conflict,
      target,
      resolution,
      text,
      root: { ...root },
      snapshot: resolution.buffer.getSnapshot(),
      revision: resolution.buffer.getRevision(),
      destination: documentStore
        .getState()
        .prepareWorkspaceDocumentTarget(fileDocumentKey(conflict.localPath)),
      remoteDestination: documentStore
        .getState()
        .prepareWorkspaceDocumentTarget(fileDocumentKey(conflict.remotePath)),
      paths: [conflict.localPath, conflict.remotePath].map((path) =>
        documentStore.getState().prepareWorkspaceDocumentPathReservation(path),
      ),
    }
  }

  private async apply(capture: CapturedResolution): Promise<void> {
    const key = documentKey(capture.target)
    if (this.disposed) return
    if (this.resolving.has(key)) {
      this.waiting.set(key, capture)
      return
    }
    this.resolving.add(key)
    const writeId = this.context.issueWriteId()
    let retry = false
    try {
      const outcome = await observeClientOperation(
        {
          ...clientLogContext(this.context.client),
          action: 'conflict.resolve',
          area: 'fs',
          conflictId: capture.conflict.id,
          path: capture.conflict.remotePath,
          rootGeneration: capture.root.generation,
          sourceRevision: capture.revision,
          writeId,
        },
        () => this.persist(capture, writeId),
        (outcome) => ({ outcome }),
      )
      retry = outcome === 'retry'
      if (outcome === 'unresolved')
        toast.warning('The conflict changed while saving. Review the remaining conflict.')
    } catch (error) {
      reportError(toClientError(error))
    } finally {
      this.resolving.delete(key)
      const waiting = this.waiting.get(key)
      this.waiting.delete(key)
      if (retry && this.rootCurrent(capture)) this.scheduleLatest(capture.target)
      if (!retry && waiting) this.scheduleWaiting(waiting, capture)
    }
  }

  private async persist(capture: CapturedResolution, writeId: string): Promise<ResolutionOutcome> {
    if (!this.isCurrent(capture)) return 'stale'
    const { conflict, text } = capture
    const { client } = this.context
    if (conflict.eventType === 'deleted') {
      await ensureFolderPath(parentPath(conflict.remotePath), client)
      if (!this.isCurrent(capture)) return 'stale'
    }
    const identity = { origin: 'conflict-editor-resolution', writeId }
    const receipt =
      conflict.eventType === 'deleted'
        ? await createFileContent(conflict.remotePath, text, client, identity)
        : await writeFileContent(
            conflict.remotePath,
            text,
            {
              baseVersion: conflict.remoteVersion,
              expectedMtimeMs: conflict.remoteMtimeMs,
              ...identity,
            },
            client,
          )
    const file: FileResult = {
      ...decodedAsText,
      path: conflict.remotePath,
      content: text,
      mtimeMs: receipt.mtimeMs,
      size: receipt.size,
      version: receipt.version,
    }
    return this.complete(capture, file)
  }

  private complete(capture: CapturedResolution, file: FileResult): ResolutionOutcome {
    if (!this.conflictCurrent(capture) || !this.destinationCurrent(capture)) return 'unresolved'
    setFileSnapshotQueryData(this.context.queryClient, file)
    if (!this.resolutionCurrent(capture)) {
      if (!this.rootCurrent(capture)) return 'unresolved'
      this.context.conflictStore.getState().addConflict({
        ...capture.conflict,
        eventType: retryEventType(capture.conflict),
        remoteText: file.content,
        remoteMtimeMs: file.mtimeMs,
        remoteSize: file.size,
        remoteVersion: file.version,
      })
      return 'retry'
    }
    this.replaceDestination(capture.conflict, file)
    this.context.discardLiveEditorDocument(capture.target)
    if (capture.conflict.toastId) toast.dismiss(capture.conflict.toastId)
    this.context.conflictStore.getState().removeConflict(capture.conflict.id)
    return 'resolved'
  }

  private isCurrent(capture: CapturedResolution): boolean {
    return (
      !this.disposed &&
      this.rootCurrent(capture) &&
      this.conflictCurrent(capture) &&
      this.destinationCurrent(capture) &&
      this.resolutionCurrent(capture)
    )
  }

  private rootCurrent(capture: CapturedResolution): boolean {
    const root = this.context.getOperationRoot()
    return root?.generation === capture.root.generation && root.path === capture.root.path
  }

  private conflictCurrent(capture: CapturedResolution): boolean {
    return this.context.conflictStore.getState().conflicts[capture.conflict.id] === capture.conflict
  }

  private resolutionCurrent(capture: CapturedResolution): boolean {
    const current = this.context.documentStore
      .getState()
      .getLiveEditorDocument(documentKey(capture.target))
    return (
      current?.buffer === capture.resolution.buffer &&
      current.buffer.getSnapshot() === capture.snapshot &&
      current.buffer.getRevision() === capture.revision
    )
  }

  private destinationCurrent(capture: CapturedResolution): boolean {
    return (
      capture.paths.every((path) => this.pathCurrent(path)) &&
      this.targetCurrent(capture.conflict.localPath, capture.destination) &&
      this.targetCurrent(capture.conflict.remotePath, capture.remoteDestination)
    )
  }

  private pathCurrent(captured: WorkspaceDocumentPathReservationRequest): boolean {
    const current = this.context.documentStore
      .getState()
      .prepareWorkspaceDocumentPathReservation(captured.canonicalPath)
    return (
      current.expectedDocumentKey === captured.expectedDocumentKey &&
      current.expectedPathOwnershipRevision === captured.expectedPathOwnershipRevision
    )
  }

  private targetCurrent(path: FilesystemPath, stamp: WorkspaceDocumentTargetStamp | null): boolean {
    const documents = this.context.documentStore.getState()
    if (stamp) return documents.isWorkspaceDocumentTargetCurrent(stamp)
    return !documents.hasLiveEditorDocument(fileDocumentKey(path))
  }

  private replaceDestination(conflict: FilesystemConflict, file: FileResult): void {
    if (conflict.localPath !== file.path) {
      this.context.renameLiveEditorDocument(conflict.localPath, file.path)
      this.context.queryClient.removeQueries({
        exact: true,
        queryKey: fileSystemKeys.fileSnapshot(conflict.localPath),
      })
    }
    this.context.documentStore.getState().forceReplaceLiveEditorDocument(file)
  }

  private scheduleLatest(target: ConflictTarget): void {
    const current = this.context.documentStore.getState().getLiveEditorDocument(documentKey(target))
    if (current) this.schedule(target, current.buffer.getTextSnapshot())
  }

  private scheduleWaiting(waiting: CapturedResolution, previous: CapturedResolution): void {
    if (!this.rootCurrent(previous)) return
    if (!this.conflictCurrent(previous) || !this.destinationCurrent(previous)) return
    if (this.isCurrent(waiting)) this.scheduleLatest(waiting.target)
  }
}

function retryEventType(conflict: FilesystemConflict): FilesystemConflict['eventType'] {
  return conflict.eventType === 'deleted' ? 'changed' : conflict.eventType
}

function parentPath(path: FilesystemPath): FilesystemPath {
  const index = path.lastIndexOf('/')
  return filesystemPath(index < 0 ? '' : path.slice(0, index))
}
