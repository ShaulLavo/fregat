import type {
  WorkspaceEditHistoryEntry,
  WorkspaceEditHistoryLeg,
  WorkspaceEditResult,
  WorkspaceEditState,
} from '@workspace/contracts'
import { fileOperationWriteId, isProvisionalWorkspaceEditState } from '@workspace/contracts'
import { createClientError } from '@workspace/client-core/errors'

import type { FilesystemPath } from '@/lib/documents/utils/types'
import type { WorkspaceEditPrepareRequest } from '@/lib/file-system-types'
import { log } from '@/lib/client-logging'
import type { FileSyncService } from '@/features/editor/state/file-sync-service'
import type {
  DocumentMove,
  FileOperationDocuments,
  FileOperationLeg,
  WorkspaceEditRoot,
} from '@/features/editor/state/workspace-edit-service'
import {
  workspaceDocumentPath,
  workspaceEditRelativePath,
  workspaceEditRequestPath,
} from '@/features/editor/utils/workspace-edit-paths'
import {
  secureOperationId,
  workspaceEditPrepareBody,
} from '@/features/editor/utils/workspace-edit-request'

type FileOperationPorts = {
  /** This window moves its documents itself, so its own events must not move them again. */
  readonly claimEvents: (writeId: string) => void
  readonly documents: FileOperationDocuments
  readonly fileSync: FileSyncService
  readonly root: WorkspaceEditRoot
}

type LocalEffects = {
  readonly moves: readonly DocumentMove[]
  readonly restored: readonly FilesystemPath[]
  readonly vanished: readonly FilesystemPath[]
}

type PersistenceOperation = WorkspaceEditPrepareRequest['operations'][number]

const NEVER_ABORTED = new AbortController().signal

export async function commitFileOperation(
  ports: FileOperationPorts,
  label: string,
  legs: readonly FileOperationLeg[],
): Promise<WorkspaceEditResult> {
  const operations = legs.map((leg, index) => persistenceOperation(ports.root, leg, index))
  const request: WorkspaceEditPrepareRequest = await workspaceEditPrepareBody({
    category: 'file-operation',
    label,
    operationId: secureOperationId(),
    operations,
    origin: 'workspace-edit',
    workspace: workspaceEditRequestPath(ports.root),
  })
  const prepared = await ports.fileSync.prepareWorkspaceMutation(request, NEVER_ABORTED)
  expectState(prepared, 'prepared', label)
  const committed = await commitPrepared(ports.fileSync, prepared, label)
  const effects = localEffects(ports.root, operations.flatMap(historyLeg), 'forward')
  return landLocally(ports, committed, effects, 'finalized', label)
}

export async function reverseFileOperation(
  ports: FileOperationPorts,
  entry: WorkspaceEditHistoryEntry,
  direction: 'redo' | 'undo',
): Promise<WorkspaceEditResult> {
  const provisional =
    direction === 'undo'
      ? await ports.fileSync.undoWorkspaceMutation(entry)
      : await ports.fileSync.redoWorkspaceMutation(entry)
  expectState(provisional, direction === 'undo' ? 'undo-committed' : 'redo-committed', entry.label)
  const effects = localEffects(ports.root, entry.legs, direction === 'undo' ? 'reverse' : 'forward')
  return landLocally(
    ports,
    provisional,
    effects,
    direction === 'undo' ? 'undone' : 'redone',
    entry.label,
  )
}

/** The document paths an operation touches, for evicting language-server history over them. */
export function fileOperationDocumentPaths(
  root: WorkspaceEditRoot,
  legs: readonly WorkspaceEditHistoryLeg[],
): FilesystemPath[] {
  return legs.flatMap(legPaths).flatMap((path) => {
    const documentPath = workspaceDocumentPath(root.path, path)
    return documentPath ? [documentPath] : []
  })
}

export function fileOperationHistoryLegs(
  root: WorkspaceEditRoot,
  legs: readonly FileOperationLeg[],
): WorkspaceEditHistoryLeg[] {
  return legs.map((leg, index) => persistenceOperation(root, leg, index)).flatMap(historyLeg)
}

async function commitPrepared(
  fileSync: FileSyncService,
  prepared: WorkspaceEditResult,
  label: string,
): Promise<WorkspaceEditResult> {
  try {
    const committed = await fileSync.commitWorkspaceMutation(prepared)
    expectState(committed, 'committed', label)
    return committed
  } catch (error) {
    await settleAbandoned(fileSync, prepared.operationId)
    throw error
  }
}

/** The server has moved the files; this window moves its documents, then the server finalizes. */
async function landLocally(
  ports: FileOperationPorts,
  provisional: WorkspaceEditResult,
  effects: LocalEffects,
  landed: WorkspaceEditState,
  label: string,
): Promise<WorkspaceEditResult> {
  let moved = false
  try {
    ports.documents.move(effects.moves)
    moved = true
    // Finalize publishes the events, so claim them first; finalize always bumps the generation once.
    ports.claimEvents(fileOperationWriteId(provisional.operationId, provisional.generation + 1))
    const finalized = await ports.fileSync.finalizeWorkspaceMutation(provisional)
    expectState(finalized, landed, label)
    ports.documents.restore(effects.restored)
    ports.documents.vanish(effects.vanished)
    return finalized
  } catch (error) {
    if (moved) ports.documents.move(effects.moves.map(({ from, to }) => ({ from: to, to: from })))
    await settleAbandoned(ports.fileSync, provisional.operationId)
    throw error
  }
}

/** Puts a half-done transition back where it started; the server keeps a partial one for recovery. */
async function settleAbandoned(fileSync: FileSyncService, operationId: string): Promise<void> {
  try {
    const status = await fileSync.statusWorkspaceMutation(operationId)
    if (!status.found) return
    const current = status.result
    if (current.state === 'prepared') {
      await fileSync.abortWorkspaceMutation(operationId, current.generation)
      return
    }
    if (!isProvisionalWorkspaceEditState(current.state)) return
    await fileSync.rollbackWorkspaceMutation(current)
  } catch (error) {
    log.warn({ action: 'file-operation.settle', area: 'file-tree', error, operationId })
  }
}

function persistenceOperation(
  root: WorkspaceEditRoot,
  leg: FileOperationLeg,
  index: number,
): PersistenceOperation {
  if (leg.kind === 'create') {
    return {
      destination: { kind: 'missing' },
      folder: leg.folder,
      ignoreIfExists: false,
      index,
      kind: 'create',
      overwrite: false,
      path: relativePath(root, leg.path),
    }
  }
  if (leg.kind === 'delete') {
    return {
      expected: { kind: 'present', type: leg.type },
      ignoreIfNotExists: false,
      index,
      kind: 'delete',
      path: relativePath(root, leg.path),
      recursive: leg.type === 'directory',
    }
  }
  if (leg.kind === 'copy') {
    return {
      destination: { kind: 'missing' },
      index,
      kind: 'copy',
      newPath: relativePath(root, leg.to),
      oldPath: relativePath(root, leg.from),
      source: { kind: 'present', type: leg.type },
    }
  }

  return {
    destination: { kind: 'missing' },
    ignoreIfExists: false,
    index,
    kind: 'rename',
    newPath: relativePath(root, leg.to),
    oldPath: relativePath(root, leg.from),
    overwrite: false,
    source: { kind: 'present', type: leg.type },
  }
}

function historyLeg(operation: PersistenceOperation): WorkspaceEditHistoryLeg[] {
  if (operation.kind === 'create') {
    return [{ folder: operation.folder ?? false, kind: 'create', path: operation.path }]
  }
  if (operation.kind === 'delete') return [{ kind: 'delete', path: operation.path }]
  if (operation.kind === 'copy') {
    return [{ kind: 'copy', newPath: operation.newPath, oldPath: operation.oldPath }]
  }
  if (operation.kind === 'rename') {
    return [{ kind: 'rename', newPath: operation.newPath, oldPath: operation.oldPath }]
  }

  return [{ kind: 'write', path: operation.path }]
}

/**
 * Moves follow the files. What reappears on disk — a deleted folder undone, a create redone —
 * brings back any document the disappearance orphaned; what disappears orphans them.
 */
function localEffects(
  root: WorkspaceEditRoot,
  legs: readonly WorkspaceEditHistoryLeg[],
  direction: 'forward' | 'reverse',
): LocalEffects {
  const ordered = direction === 'forward' ? legs : legs.toReversed()
  const moves: DocumentMove[] = []
  const restored: FilesystemPath[] = []
  const vanished: FilesystemPath[] = []
  for (const leg of ordered) {
    if (leg.kind === 'rename') {
      const from = direction === 'forward' ? leg.oldPath : leg.newPath
      const to = direction === 'forward' ? leg.newPath : leg.oldPath
      moves.push({ from: documentPath(root, from), to: documentPath(root, to) })
      continue
    }
    const changed = changedPath(leg)
    if (!changed) continue
    const appears = (leg.kind === 'delete') === (direction === 'reverse')
    ;(appears ? restored : vanished).push(documentPath(root, changed))
  }

  return { moves, restored, vanished }
}

/** The path a delete, create or copy makes vanish or appear; which one depends on the direction. */
function changedPath(leg: WorkspaceEditHistoryLeg) {
  if (leg.kind === 'delete' || leg.kind === 'create') return leg.path
  if (leg.kind === 'copy') return leg.newPath

  return null
}

function legPaths(leg: WorkspaceEditHistoryLeg): string[] {
  if (leg.kind === 'rename' || leg.kind === 'copy') return [leg.oldPath, leg.newPath]
  return [leg.path]
}

function relativePath(root: WorkspaceEditRoot, path: FilesystemPath): FilesystemPath {
  const relative = workspaceEditRelativePath(root.path, path)
  if (relative && relative !== '.') return relative
  throw fileOperationError('outside-workspace', `${path} is not inside the open workspace`)
}

function documentPath(root: WorkspaceEditRoot, relative: string): FilesystemPath {
  const path = workspaceDocumentPath(root.path, relative)
  if (path) return path
  throw fileOperationError('outside-workspace', `${relative} is not inside the open workspace`)
}

function expectState(result: WorkspaceEditResult, expected: WorkspaceEditState, label: string) {
  if (result.state === expected) return
  if (result.state === 'partial') {
    throw createClientError({
      code: 'workspace-edit-recovery-required',
      fix: 'Open the recovery prompt to finish or discard the interrupted change.',
      internal: { expected, operationId: result.operationId, state: result.state },
      message: `${label} was interrupted part way`,
      status: 409,
      why: 'The disk changed while the operation ran, so not every file could be put back.',
    })
  }
  throw fileOperationError(
    'workspace-edit-rolled-back',
    `${label} could not be applied and nothing was changed`,
    { expected, operationId: result.operationId, state: result.state },
  )
}

function fileOperationError(code: string, message: string, internal?: Record<string, unknown>) {
  return createClientError({
    code,
    fix: 'Refresh the file tree and try again.',
    internal,
    message,
    status: 409,
    why: 'The files changed on disk while the operation ran.',
  })
}
